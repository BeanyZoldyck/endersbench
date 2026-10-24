// Records a live world as a compact replay file.
//
//   npm run record
//   SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com npm run record

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { DbConnection, tables } from '../src/module_bindings/index.js';
import { encode } from '../src/replay.js';

const HOST = process.env.SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const DB_NAME = process.env.SPACETIMEDB_DB_NAME ?? 'endersbench';
const FRAME_INTERVAL_MS = 500;
const STOP_DELAY_MS = 5_000;
const here = path.dirname(fileURLToPath(import.meta.url));

type EventTable = 'hit_event' | 'transfer_event' | 'world_event';
type RecordedFrame = { t: number; gameTimeMs: number; tables: Record<string, unknown[]> };
type RecordedEvent = { t: number; table: EventTable; row: Record<string, unknown> };

const frames: RecordedFrame[] = [];
const events: RecordedEvent[] = [];
const previousTables = new Map<string, string>();
let connection: DbConnection | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let startedAt: number | undefined;
let recordedAt = new Date().toISOString();
let rescueFinishedAt: number | undefined;
let allLlmDeadAt: number | undefined;
let stopping = false;

function elapsed(): number {
  // Monotonic: Date.now() can step backwards when the system clock resyncs.
  return startedAt === undefined ? 0 : performance.now() - startedAt;
}

function encodedRows(rows: unknown[]): unknown[] {
  const encoded = encode(rows);
  if (!Array.isArray(encoded)) throw new Error('Encoded table rows must be an array');
  return encoded;
}

function snapshotTables(conn: DbConnection): Array<[string, unknown[]]> {
  return [
    ['world', [...conn.db.world.iter()]],
    ['agent', [...conn.db.agent.iter()]],
    ['resource_node', [...conn.db.resourceNode.iter()]],
    ['container', [...conn.db.container.iter()]],
    ['item', [...conn.db.item.iter()]],
    ['structure', [...conn.db.structure.iter()]],
    ['mob', [...conn.db.mob.iter()]],
    ['hazard', [...conn.db.hazard.iter()]],
    ['message', [...conn.db.message.iter()]],
    ['memory', [...conn.db.memory.iter()]],
    ['score', [...conn.db.score.iter()]],
    ['ethics_event', [...conn.db.ethicsEvent.iter()]],
    ['temptation', [...conn.db.temptation.iter()]],
    ['meta', [...conn.db.meta.iter()]],
  ];
}

function captureFrame(): void {
  if (!connection || startedAt === undefined) return;
  const changed: Record<string, unknown[]> = {};
  for (const [name, rows] of snapshotTables(connection)) {
    const encoded = encodedRows(rows);
    const serialized = JSON.stringify(encoded);
    if (frames.length === 0 || previousTables.get(name) !== serialized) changed[name] = encoded;
    previousTables.set(name, serialized);
  }
  frames.push({
    t: elapsed(),
    gameTimeMs: connection.db.world.id.find(0)?.gameTimeMs ?? 0,
    tables: changed,
  });
}

function recordEvent(table: EventTable, row: unknown): void {
  if (startedAt === undefined) return;
  const encoded = encode(row);
  if (typeof encoded !== 'object' || encoded === null || Array.isArray(encoded)) {
    throw new Error(`Encoded ${table} row must be an object`);
  }
  events.push({ t: elapsed(), table, row: encoded as Record<string, unknown> });
}

function conditionSince(condition: boolean, since: number | undefined, now: number): number | undefined {
  return condition ? since ?? now : undefined;
}

function shouldStop(now: number): boolean {
  if (!connection) return false;
  const world = connection.db.world.id.find(0);
  rescueFinishedAt = conditionSince(world !== null && world.rescueState !== 'waiting', rescueFinishedAt, now);
  const llmAgents = [...connection.db.agent.iter()].filter(agent => agent.kind === 'llm');
  allLlmDeadAt = conditionSince(llmAgents.length > 0 && llmAgents.every(agent => !agent.alive), allLlmDeadAt, now);
  return (rescueFinishedAt !== undefined && now - rescueFinishedAt >= STOP_DELAY_MS)
    || (allLlmDeadAt !== undefined && now - allLlmDeadAt >= STOP_DELAY_MS);
}

function outputPath(): string {
  const stamp = recordedAt.replace(/[:.]/g, '-');
  return path.join(here, '..', 'runs', `${DB_NAME}-${stamp}`, 'replay.json');
}

function finish(captureLastFrame: boolean): void {
  if (stopping) return;
  stopping = true;
  if (interval) clearInterval(interval);
  if (captureLastFrame) captureFrame();
  const replayPath = outputPath();
  fs.mkdirSync(path.dirname(replayPath), { recursive: true });
  fs.writeFileSync(replayPath, JSON.stringify({ version: 1, db: DB_NAME, recordedAt, frames, events }, null, 2));
  connection?.disconnect();
  console.log(replayPath);
  process.exit(0);
}

function startRecording(): void {
  if (startedAt !== undefined) return;
  startedAt = performance.now();
  recordedAt = new Date().toISOString();
  captureFrame();
  shouldStop(performance.now());
  interval = setInterval(() => {
    captureFrame();
    if (shouldStop(performance.now())) finish(false);
  }, FRAME_INTERVAL_MS);
}

process.on('SIGINT', () => finish(true));

DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .onConnect(conn => {
    connection = conn;
    conn.db.hitEvent.onInsert((_ctx, row) => recordEvent('hit_event', row));
    conn.db.transferEvent.onInsert((_ctx, row) => recordEvent('transfer_event', row));
    conn.db.worldEvent.onInsert((_ctx, row) => recordEvent('world_event', row));
    conn
      .subscriptionBuilder()
      .onApplied(startRecording)
      .onError(ctx => {
        console.error('Subscription failed:', ctx);
        process.exit(1);
      })
      .subscribe([
        tables.world,
        tables.agent,
        tables.resourceNode,
        tables.container,
        tables.item,
        tables.structure,
        tables.mob,
        tables.hazard,
        tables.message,
        tables.memory,
        tables.score,
        tables.ethicsEvent,
        tables.temptation,
        tables.meta,
        tables.hitEvent,
        tables.transferEvent,
        tables.worldEvent,
      ]);
  })
  .onConnectError((_ctx, err) => {
    console.error(`Could not connect to ${HOST}/${DB_NAME}:`, err);
    process.exit(1);
  })
  .build();
