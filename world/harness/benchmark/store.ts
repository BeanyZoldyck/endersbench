import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Replay } from '../../src/replay.js';
import { ledgerRecording } from './ledger-recording.js';
import { MODEL_IDS, type BenchmarkJob, type ModelName, type BenchmarkRosterEntry } from './types.js';
import { isResolvedRoster, rosterLabel } from './roster.js';
import { BENCHMARK_SCENARIOS } from './scenarios.js';
import { workerAlive } from './worker-lifecycle.js';
import { finalizeRecording } from './recording.js';

export const validJobId = (id: string): boolean => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export type SavedRecording = {
  id: string; model: ModelName; modelId: string; scenario: string; roster?: BenchmarkRosterEntry[];
  label: string; recordedAt: string; durationMs: number; status: 'completed' | 'partial'; replayUrl: string;
};
function atomicJson(file: string, value: unknown): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
}

export class BenchmarkStore {
  constructor(private readonly root: string) { mkdirSync(root, { recursive: true }); }
  private directory(id: string): string {
    if (!validJobId(id)) throw new Error('Invalid benchmark ID.');
    return path.join(this.root, id);
  }
  save(job: BenchmarkJob): void {
    const directory = this.directory(job.id);
    mkdirSync(directory, { recursive: true });
    atomicJson(path.join(directory, 'job.json'), job);
  }
  archive(job: BenchmarkJob): void {
    const directory = this.directory(job.id);
    const info = finalizeRecording(directory);
    if (!info) {
      if (job.status === 'completed') throw new Error('Completed run has no recording.');
      return;
    }
    const recording: SavedRecording = {
      id: job.id, model: job.model, modelId: job.modelId, scenario: job.scenario,
      ...(job.roster ? { roster: job.roster } : {}),
      label: `${job.roster ? rosterLabel(job.roster) : job.model} · ${BENCHMARK_SCENARIOS.find(scenario => scenario.id === job.scenario)?.name ?? job.scenario}`, ...info,
      status: job.status === 'completed' ? 'completed' : 'partial',
      replayUrl: `/api/benchmarks/${job.id}/replay`,
    };
    atomicJson(path.join(directory, 'recording.json'), recording);
  }
  load(): BenchmarkJob[] {
    const jobs: BenchmarkJob[] = [];
    for (const id of readdirSync(this.root).filter(validJobId)) {
      try {
        const file = path.join(this.directory(id), 'job.json');
        const job = JSON.parse(readFileSync(file, 'utf8')) as BenchmarkJob;
        if (job.id !== id || !MODEL_IDS.includes(job.model) || typeof job.modelId !== 'string'
          || !BENCHMARK_SCENARIOS.some(scenario => scenario.id === job.scenario)
          || job.roster !== undefined && (!isResolvedRoster(job.roster) || job.roster[0].model !== job.model || job.roster[0].modelId !== job.modelId)
          || job.dbName !== `endersbench-run-${id}`
          || !['starting', 'running', 'completed', 'failed'].includes(job.status)) continue;
        this.recover(job);
        jobs.push(job);
      } catch { process.stderr.write(`Could not restore benchmark ${id}.\n`); }
    }
    return jobs.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }
  recover(job: BenchmarkJob): void {
    const directory = this.directory(job.id);
    const interrupted = job.status === 'starting' || job.status === 'running';
    if (interrupted && workerAlive(directory)) return;
    if (interrupted) {
      job.status = 'failed';
      job.error = 'Runner stopped before completion. Any captured replay is saved as partial.';
    }
    try {
      if (interrupted || !existsSync(path.join(directory, 'recording.json'))) this.archive(job);
    } catch {
      job.error = 'The run is saved, but its recording could not be recovered. Check local disk space and runner logs.';
    }
    // Job restoration remains available even if the journal is corrupt or disk writes fail.
    try { this.save(job); } catch { process.stderr.write(`Could not persist benchmark ${job.id}.\n`); }
  }
  history(): SavedRecording[] {
    const recordings: SavedRecording[] = [];
    for (const id of readdirSync(this.root).filter(validJobId)) {
      try {
        const directory = this.directory(id);
        const entry = JSON.parse(readFileSync(path.join(directory, 'recording.json'), 'utf8')) as SavedRecording;
        if (entry.id === id && existsSync(path.join(directory, 'replay.json.gz'))) recordings.push(entry);
      } catch { /* An active or failed-before-capture job has no recording yet. */ }
    }
    return recordings.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  }
  replay(id: string): Buffer | null {
    const directory = this.directory(id);
    if (!existsSync(path.join(directory, 'recording.json'))) return null;
    try {
      const bytes = readFileSync(path.join(directory, 'replay.json.gz'));
      const recording = JSON.parse(readFileSync(path.join(directory, 'recording.json'), 'utf8')) as SavedRecording;
      return recording.scenario === 'ledger'
        ? Buffer.from(JSON.stringify(ledgerRecording(JSON.parse(gunzipSync(bytes).toString('utf8')) as Replay)))
        : bytes;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
}
