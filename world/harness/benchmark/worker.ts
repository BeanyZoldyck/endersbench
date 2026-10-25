import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../src/module_bindings/index.js';
import { brainFor, type Brain, type Tool } from '../brains.js';
import { promptVersion, systemPrompt } from '../prompt.js';
import { buildReport, type Rows } from '../report.js';
import { failureCode } from './failure.js';

const [id, dbName, modelId] = process.argv.slice(2);
if (!id || !/^[-a-f0-9]{36}$/.test(id) || dbName !== `endersbench-run-${id}` || !modelId) process.exit(1);
const host = 'ws://localhost:3000';
const names = ['Ada', 'Bo', 'Cy', 'Di'];
const prompt = systemPrompt('charter');
const brain: Brain = brainFor(modelId, process.env);
const inFlight = new Set<bigint>();
let failures = 0;
let closing = false;
let ready = false;
let fresh = false;
let claimed = false;
let interval: ReturnType<typeof setInterval> | undefined;
let conn: DbConnection;
const startupTimer = setTimeout(() => { if (!ready) fail(); }, 60_000);

async function pauseAndExit(): Promise<void> {
  closing = true;
  clearTimeout(startupTimer);
  if (interval) clearInterval(interval);
  if (conn && fresh) {
    await Promise.race([
      (async () => {
        if (!claimed) await conn.reducers.claimHarness({});
        await conn.reducers.setRunning({ running: false });
      })().catch(() => undefined),
      new Promise<void>(resolve => setTimeout(resolve, 2_000)),
    ]);
  }
  conn?.disconnect();
  process.exit(1);
}

function fail(): void {
  if (closing) return;
  void pauseAndExit();
}

process.on('SIGTERM', () => { void pauseAndExit(); });
process.on('SIGINT', () => { void pauseAndExit(); });

function snapshot(): Rows {
  const world = conn.db.world.id.find(0);
  const parseRun = (value?: string): Record<string, unknown> => {
    try { return value ? JSON.parse(value) as Record<string, unknown> : {}; } catch { return {}; }
  };
  return {
    world: { gameTimeMs: world?.gameTimeMs ?? 0, phase: world?.phase ?? '', timeScale: world?.timeScale ?? 1, rescueState: world?.rescueState },
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

async function answer(request: { id: bigint; agentId: bigint; modelId: string; observation: string }): Promise<void> {
  if (!ready || inFlight.has(request.id)) return;
  inFlight.add(request.id);
  const start = performance.now();
  try {
    if (request.modelId !== modelId) throw new Error('Unexpected model in fresh world.');
    const toolsValue = conn.db.meta.key.find('tools')?.value;
    if (!toolsValue) throw new Error('Missing tool catalog.');
    const tools = JSON.parse(toolsValue) as Tool[];
    const agentName = conn.db.agent.id.find(request.agentId)?.name;
    if (!agentName) throw new Error('Unknown agent.');
    const decision = await Promise.race([
      brain.decide({ agentName, observation: JSON.parse(request.observation), tools, system: prompt }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Decision timed out.')), 20_000)),
    ]);
    await conn.reducers.submitDecision({
      requestId: request.id,
      action: JSON.stringify(decision.action),
      thought: decision.thought,
      latencyMs: Math.max(0, Math.round(performance.now() - start)),
    });
  } catch (error) {
    process.stdout.write(`BENCHMARK_ERROR:${failureCode(error)}\n`);
    failures++;
    await conn.reducers.failDecision({
      requestId: request.id, error: 'Model decision failed.',
      latencyMs: Math.max(0, Math.round(performance.now() - start)),
    }).catch(() => undefined);
    fail();
  } finally { inFlight.delete(request.id); }
}

async function finish(): Promise<void> {
  if (closing) return;
  closing = true;
  if (interval) clearInterval(interval);
  try {
    await conn.reducers.setRunning({ running: false });
    await new Promise(resolve => setTimeout(resolve, 500));
    const rows = snapshot();
    const llms = rows.agents.filter(agent => agent.kind === 'llm');
    if (failures || llms.length !== names.length || rows.decisions.filter(decision => decision.status === 'done').length === 0
      || rows.decisions.some(decision => decision.status === 'failed' || decision.status === 'pending' || decision.status === 'expired' && !/^(superseded:|knocked out$|agent is a ghost$|agent died$)/.test(decision.error ?? ''))
      || llms.some(agent => !rows.scores.some(score => score.agentId === agent.id))) throw new Error('Incomplete run.');
    const report = buildReport(rows);
    const runsDir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'runs');
    const dir = path.join(runsDir, id);
    await mkdir(runsDir, { recursive: true });
    await mkdir(dir, { recursive: false });
    await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    conn.disconnect();
    process.exit(0);
  } catch { await pauseAndExit(); }
}

function checkCompletion(): void {
  if (!ready || closing) return;
  const world = conn.db.world.id.find(0);
  const llms = [...conn.db.agent.iter()].filter(agent => agent.kind === 'llm');
  const complete = (world !== null && world.rescueState !== 'waiting') || llms.length === names.length && llms.every(agent => !agent.alive);
  if (complete && llms.length === names.length && inFlight.size === 0) void finish();
}

async function initialize(): Promise<void> {
  try {
    if ([...conn.db.agent.iter()].length > 0 || conn.db.meta.key.find('run')) throw new Error('Database is not fresh.');
    fresh = true;
    await conn.reducers.claimHarness({});
    claimed = true;
    await conn.reducers.setRunning({ running: false });
    for (const name of names) await conn.reducers.spawnAgent({ name, modelId });
    // The module starts ticking at publish time. Reseed only this verified fresh
    // database so the selected roster begins together at game time zero.
    await conn.reducers.resetExperiment({});
    await conn.reducers.setRunning({ running: false });
    await conn.reducers.setRunInfo({ info: JSON.stringify({ scenario: 'clearing-charter', promptVariant: 'charter', promptVersion: promptVersion(), systemPrompt: prompt, roster: names.map(name => ({ name, modelId })), timeScale: 1, startedAt: new Date().toISOString() }) });
    ready = true;
    clearTimeout(startupTimer);
    await conn.reducers.setRunning({ running: true });
    process.stdout.write('BENCHMARK_RUNNING\n');
    for (const request of conn.db.decisionRequest.iter()) if (request.status === 'pending') void answer(request);
    interval = setInterval(checkCompletion, 1_000);
  } catch { fail(); }
}

conn = DbConnection.builder()
  .withUri(host)
  .withDatabaseName(dbName)
  .onConnect(connection => {
    conn = connection;
    conn.db.decisionRequest.onInsert((_ctx, request) => { if (request.status === 'pending') void answer(request); });
    conn.subscriptionBuilder().onApplied(() => { void initialize(); }).onError(() => fail()).subscribe([
      tables.world, tables.agent, tables.score, tables.temptation, tables.ethicsEvent,
      tables.decisionRequest, tables.meta, tables.record, tables.discovery,
    ]);
  })
  .onConnectError(() => fail())
  .build();
