// Operator-side finance runner. The viewer only subscribes; all case state and
// scoring live in SpacetimeDB. With no FINANCE_MODELS this uses labelled test
// scripts, incurs no model calls, and exercises the same live request path.
// CRS tools are answered by the live CRS sandbox (crslive.ts), so the offices
// show real CRS calls; FINANCE_CRS=snapshot answers from the Oct 24 cards instead.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../src/module_bindings/index.js';
import { crsClientFromEnv, liveCrs } from './crslive.js';
import { answerDeskRequest, isDeskRequest } from './desk.js';
import { financeControl } from './control.js';
import { HEADLINE_VARIANT } from '../../spacetimedb/src/finance/prompt';
import { FINANCE_BENCHMARK_VERSION, SCENARIOS } from '../../spacetimedb/src/finance/scenarios';

const host = process.env.SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const database = process.env.SPACETIMEDB_DB_NAME ?? 'endersbench';
const models = [...new Set((process.env.FINANCE_MODELS ?? 'script:policy,script:pleaser,script:revenue,script:escalate-all').split(',').map(s => s.trim()).filter(Boolean))];
const variant = process.env.FINANCE_VARIANT ?? HEADLINE_VARIANT;
const selectedCases = process.env.FINANCE_CASES ?? 'lend-old-checklist,lend-credit-freeze,collect-chapter13,lend-subprime-pushback,lend-no-file-new-evidence,lend-hide-from-audit,vendor-genuine-change';
const repeat = Number(process.env.FINANCE_REPEAT ?? 1);
const pace = Math.max(0, Number(process.env.FINANCE_PACE_MS ?? 900));
const tokenFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', `.harness-token-${host.replace(/[^a-z0-9]+/gi, '_')}-${database}`);
if (!models.length || !Number.isInteger(repeat) || repeat < 1 || repeat > 10) throw new Error('Use at least one FINANCE_MODELS entry and FINANCE_REPEAT between 1 and 10');
const crsMode = process.env.FINANCE_CRS ?? 'live';
if (crsMode !== 'live' && crsMode !== 'snapshot') throw new Error('FINANCE_CRS is live (the default) or snapshot');
// One CRS login before any case is answered. A failed login stops the worker
// and is never retried: repeated failures disable the sandbox account.
const crs = crsMode === 'live' ? crsClientFromEnv() : undefined;
if (crs) await crs.login();
const live = crs ? liveCrs(crs) : undefined;
let ready = false;
let control: ReturnType<typeof financeControl> | undefined;
const pending = new Set<bigint>();
function route(conn: DbConnection, req: { id: bigint; agentId: bigint; modelId: string; observation: string; status: string }) {
  if (conn.db.meta.key.find('finance_benchmark_version')?.value !== String(FINANCE_BENCHMARK_VERSION)) return;
  if (!ready || req.status !== 'pending' || !isDeskRequest(req) || !models.includes(req.modelId) || pending.has(req.id)) return;
  pending.add(req.id);
  void (async () => {
    try {
      // Pace scripts for a readable demo. Real model calls are never delayed.
      if (req.modelId.startsWith('script:') && pace) await new Promise(resolve => setTimeout(resolve, pace));
      if (conn.db.decisionRequest.id.find(req.id)?.status === 'pending') await answerDeskRequest(conn, req, { live });
    } finally { pending.delete(req.id); }
  })().catch(error => console.error('Finance request failed:', error));
}
const conn = DbConnection.builder().withUri(host).withDatabaseName(database)
  .withToken(fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : undefined)
  .withAutomaticReconnect()
  .onConnect((_connection, _identity, token) => fs.writeFileSync(tokenFile, token, { mode: 0o600 }))
  .onConnectError((_ctx, error) => { console.error(error); process.exitCode = 1; }).build();
conn.db.decisionRequest.onInsert((_ctx, request) => route(conn, request));
let starting = false;
conn.subscriptionBuilder().onApplied(() => {
  if (ready) { for (const req of conn.db.decisionRequest.iter()) route(conn, req); return; }
  if (starting) return;
  starting = true;
  void (async () => {
    await conn.reducers.claimHarness({});
    for (let n = 0; n < 20 && conn.db.meta.key.find('finance_benchmark_version')?.value !== String(FINANCE_BENCHMARK_VERSION); n++) await new Promise(r => setTimeout(r, 50));
    if (conn.db.meta.key.find('finance_benchmark_version')?.value !== String(FINANCE_BENCHMARK_VERSION)) throw new Error('Worker/module benchmark versions differ. Publish the matching module before running.');
    ready = true;
    if (process.env.FINANCE_CONTROL_PORT) {
      control = financeControl({ host, database, models, repeat, cases: selectedCases ? selectedCases.split(',').map(s => s.trim()).filter(Boolean) : SCENARIOS.map(s => s.id),
        rows: () => conn.db.financeCase.iter(), ready: () => ready && conn.isActive && conn.db.meta.key.find('finance_benchmark_version')?.value === String(FINANCE_BENCHMARK_VERSION),
        queue: args => conn.reducers.queueFinanceRun(args) });
      await new Promise<void>((resolve, reject) => { control!.once('error', reject); control!.listen(Number(process.env.FINANCE_CONTROL_PORT), '127.0.0.1', resolve); });
      console.log(`Finance viewer controls: 127.0.0.1:${process.env.FINANCE_CONTROL_PORT}`);
    }
    for (const req of conn.db.decisionRequest.iter()) route(conn, req);
    if (process.env.FINANCE_RESUME !== '1') {
      for (const modelId of models) await conn.reducers.queueFinanceRun({ modelId, variant, repeat, cases: selectedCases });
    }
    console.log(`Finance live: ${models.join(', ')} · ${variant} · ${selectedCases || 'all cases'} · ${database} · CRS: ${live ? 'live sandbox' : 'Oct 24 snapshot'}`);
  })().catch(error => { console.error(error); process.exitCode = 1; conn.disconnect(); });
}).subscribe([tables.meta, tables.financeCase, tables.decisionRequest.where(r => r.agentId.eq(0n))]);
process.on('SIGINT', () => { control?.close(); conn.disconnect(); process.exit(0); });
