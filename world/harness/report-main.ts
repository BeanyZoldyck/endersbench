// Snapshots a world and writes the run's report and labelled decisions.
//
//   npm run report                                   # local world
//   SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com npm run report
//
// Writes runs/<db>-<timestamp>/report.json, report.md and decisions.jsonl.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { DbConnection, tables } from '../src/module_bindings/index.js';
import { buildReport, labelDecisions, renderMarkdown, type Rows } from './report.js';

const HOST = process.env.SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const DB_NAME = process.env.SPACETIMEDB_DB_NAME ?? 'endersbench';
const here = path.dirname(fileURLToPath(import.meta.url));

function snapshot(conn: DbConnection): Rows {
  const w = conn.db.world.id.find(0);
  return {
    world: { gameTimeMs: w?.gameTimeMs ?? 0, phase: w?.phase ?? '', timeScale: w?.timeScale ?? 1, rescueState: w?.rescueState },
    agents: [...conn.db.agent.iter()],
    scores: [...conn.db.score.iter()],
    temptations: [...conn.db.temptation.iter()],
    events: [...conn.db.ethicsEvent.iter()],
    decisions: [...conn.db.decisionRequest.iter()],
    records: [...conn.db.record.iter()],
    discoveries: [...conn.db.discovery.iter()],
    run: { ...parseRun(conn.db.meta.key.find('run')?.value), scenario: parseRun(conn.db.meta.key.find('scenario')?.value) },
  };
}

function parseRun(value?: string) {
  try {
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

function write(rows: Rows) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(here, '..', 'runs', `${DB_NAME}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const report = buildReport(rows);
  const markdown = renderMarkdown(report);
  const labels = labelDecisions(rows);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'report.md'), markdown);
  fs.writeFileSync(path.join(dir, 'decisions.jsonl'), labels.map(l => JSON.stringify(l)).join('\n') + (labels.length ? '\n' : ''));
  console.log(markdown);
  console.log(`Wrote ${dir} (${labels.length} labelled decisions, ${labels.filter(l => l.violated).length} followed by a violation)`);
}

DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .onConnect(conn => {
    conn
      .subscriptionBuilder()
      .onApplied(() => {
        write(snapshot(conn));
        conn.disconnect();
        process.exit(0);
      })
      .onError(ctx => {
        console.error('Subscription failed:', ctx);
        process.exit(1);
      })
      .subscribe([tables.world, tables.agent, tables.score, tables.temptation, tables.ethicsEvent, tables.decisionRequest, tables.meta, tables.record, tables.discovery]);
  })
  .onConnectError((_ctx, err) => {
    console.error(`Could not connect to ${HOST}/${DB_NAME}:`, err);
    process.exit(1);
  })
  .build();
