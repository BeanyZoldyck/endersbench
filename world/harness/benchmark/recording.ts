import { appendFileSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { encode } from '../../src/replay.js';
import type { ReplayEvent, ReplayFrame } from '../../src/replay.js';

/** Append-only capture survives worker/service exits without retaining the whole run in RAM. */
export class ReplayRecorder {
  private readonly previous = new Map<string, string>();
  private readonly started = performance.now();
  private readonly file: string;
  constructor(directory: string, db: string, recordedAt = new Date().toISOString()) {
    this.file = path.join(directory, 'recording.ndjson');
    writeFileSync(this.file, JSON.stringify({ kind: 'header', db, recordedAt }) + '\n', { flag: 'wx' });
  }
  capture(tables: Array<[string, unknown[]]>, gameTimeMs: number): void {
    const changed: Record<string, unknown> = {};
    for (const [name, rows] of tables) {
      const value = encode(rows);
      const serialized = JSON.stringify(value);
      if (this.previous.get(name) !== serialized) changed[name] = value;
      this.previous.set(name, serialized);
    }
    appendFileSync(this.file, JSON.stringify({ kind: 'frame', t: performance.now() - this.started, gameTimeMs, tables: changed }) + '\n');
  }
  event(table: ReplayEvent['table'], row: unknown): void {
    appendFileSync(this.file, JSON.stringify({ kind: 'event', t: performance.now() - this.started, table, row: encode(row) }) + '\n');
  }
}

export function finalizeRecording(directory: string): { recordedAt: string; durationMs: number } | null {
  let text: string;
  try { text = readFileSync(path.join(directory, 'recording.ndjson'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const lines = text.split('\n');
  // Only newline-terminated writes are committed. A killed process can leave a partial last line.
  lines.pop();
  if (!lines.length) return null;
  const header = JSON.parse(lines.shift()!) as { kind: string; db: string; recordedAt: string };
  if (header.kind !== 'header' || !Number.isFinite(Date.parse(header.recordedAt))) throw new Error('Invalid recording header.');
  const frames: ReplayFrame[] = [];
  const events: ReplayEvent[] = [];
  for (const line of lines) {
    const entry = JSON.parse(line) as { kind: string } & ReplayFrame & ReplayEvent;
    if (entry.kind === 'frame') frames.push({ t: entry.t, gameTimeMs: entry.gameTimeMs, tables: entry.tables });
    else if (entry.kind === 'event') events.push({ t: entry.t, table: entry.table, row: entry.row });
  }
  if (!frames.length) return null;
  const replay = { version: 1, db: header.db, recordedAt: header.recordedAt, frames, events };
  const temporary = path.join(directory, 'replay.json.gz.tmp');
  writeFileSync(temporary, gzipSync(JSON.stringify(replay)));
  renameSync(temporary, path.join(directory, 'replay.json.gz'));
  return { recordedAt: header.recordedAt, durationMs: frames[frames.length - 1].t };
}
