import { ReplayRecorder } from './recording.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../src/module_bindings/index.js';
import { brainFor, type Brain, type Tool } from '../brains.js';
import { promptVersion, systemPrompt } from '../prompt.js';
import { buildReport, type Rows } from '../report.js';
import { failureCode } from './failure.js';
import { canSubmitDecision, hasIncompleteDecisions, hasCompleteRoster, rosterHasFinished } from './completion.js';
import { assignmentForDecision, expandRoster, isResolvedRoster, type AgentAssignment } from './roster.js';
import { SCENARIO_ID, type BenchmarkRosterEntry } from './types.js';
import { answerDeskRequest } from '../finance/desk.js';
import { ledgerAssignment, ledgerTurn, LEDGER_CASE_ID, LEDGER_VARIANT } from './ledger.js';

const [id, dbName, rawOptions] = process.argv.slice(2);
if (!id || !/^[-a-f0-9]{36}$/.test(id) || dbName !== `endersbench-run-${id}` || !rawOptions) process.exit(1);
let options: { roster: BenchmarkRosterEntry[]; scenario: string };
try {
  options = JSON.parse(rawOptions) as typeof options;
  if (!options || Object.keys(options).sort().join(',') !== 'roster,scenario'
    || !isResolvedRoster(options.roster) || ![SCENARIO_ID, 'ledger'].includes(options.scenario)) throw new Error('Invalid worker options.');
} catch { process.exit(1); }
const host = 'ws://localhost:3000';
const roster = expandRoster(options.roster);
const assignments = new Map<bigint, AgentAssignment>();
const deskAssignments = new Map<bigint, AgentAssignment>();
const isLedger = options.scenario === 'ledger';
const prompt = systemPrompt('charter');
const brains = new Map<string, Brain>(roster.map(agent => [agent.modelId, brainFor(agent.modelId, process.env)]));
const inFlight = new Set<bigint>();
let failures = 0;
let closing = false;
let ready = false;
let fresh = false;
let claimed = false;
let interval: ReturnType<typeof setInterval> | undefined;
let captureInterval: ReturnType<typeof setInterval> | undefined;
let recorder: ReplayRecorder | undefined;
const runsDir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'runs');
const runDirectory = path.join(runsDir, id);

function capture(): void {
  if (!recorder || !conn) return;
  recorder.capture([
    ['world', [...conn.db.world.iter()]], ['agent', [...conn.db.agent.iter()]],
    ['resource_node', [...conn.db.resourceNode.iter()]], ['container', [...conn.db.container.iter()]],
    ['item', [...conn.db.item.iter()]], ['structure', [...conn.db.structure.iter()]],
    ['mob', [...conn.db.mob.iter()]], ['hazard', [...conn.db.hazard.iter()]],
    ['message', [...conn.db.message.iter()]], ['memory', [...conn.db.memory.iter()]],
    ['score', [...conn.db.score.iter()]], ['ethics_event', [...conn.db.ethicsEvent.iter()]],
    ['temptation', [...conn.db.temptation.iter()]], ['record', [...conn.db.record.iter()]],
    ['discovery', [...conn.db.discovery.iter()]], ['explored', [...conn.db.explored.iter()]],
    ['meta', [...conn.db.meta.iter()]],
    ['finance_case', [...conn.db.financeCase.iter()]], ['finance_step', [...conn.db.financeStep.iter()]],
    ['finance_verdict', [...conn.db.financeVerdict.iter()]],
  ], conn.db.world.id.find(0)?.gameTimeMs ?? 0);
}
function captureSafely(): void {
  try { capture(); } catch { fail(); }
}

let conn: DbConnection;
const startupTimer = setTimeout(() => { if (!ready) fail(); }, 60_000);

async function pauseAndExit(): Promise<void> {
  closing = true;
  clearTimeout(startupTimer);
  if (interval) clearInterval(interval);
  if (captureInterval) clearInterval(captureInterval);
  if (conn && fresh) {
    await Promise.race([
      (async () => {
        if (!claimed) await conn.reducers.claimHarness({});
        await conn.reducers.setRunning({ running: false });
      })().catch(() => undefined),
      new Promise<void>(resolve => setTimeout(resolve, 2_000)),
    ]);
  }
  try { capture(); } catch { /* Preserve frames already written if storage fails. */ }
  conn?.disconnect();
  process.exit(1);
}

function fail(): void {
  if (closing) return;
  void pauseAndExit();
}

function parentDisconnected(): void {
  // This deadline also applies if normal finish() is already awaiting a reducer or disk I/O.
  setTimeout(() => process.exit(1), 2_500).unref();
  void pauseAndExit();
}
process.on('disconnect', parentDisconnected);
if (!process.connected) parentDisconnected();

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
    const assignment = isLedger
      ? ledgerAssignment(deskAssignments, [...conn.db.financeCase.iter()], request)
      : assignmentForDecision(assignments, request, conn.db.agent.id.find(request.agentId));
    const brain = brains.get(assignment.modelId);
    if (!brain) throw new Error('Missing assigned model brain.');
    if (isLedger) {
      const result = await answerDeskRequest({ db: { meta: { key: { find: key => conn.db.meta.key.find(key) ?? undefined } }, financeCase: conn.db.financeCase }, reducers: conn.reducers }, request, { turnFor: () => ledgerTurn(brain, 'Ledger analyst') });
      if (!result || 'error' in result) {
        process.stdout.write(`BENCHMARK_ERROR:${failureCode(new Error(result && 'error' in result ? result.error : 'No desk answer.'))}\n`);
        failures++;
        fail();
      }
      return;
    }
    const toolsValue = conn.db.meta.key.find('tools')?.value;
    if (!toolsValue) throw new Error('Missing tool catalog.');
    const tools = JSON.parse(toolsValue) as Tool[];
    const agentName = assignment.name;
    const decision = await Promise.race([
      brain.decide({ agentName, observation: JSON.parse(request.observation), tools, system: prompt }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Decision timed out.')), 20_000)),
    ]);
    if (!canSubmitDecision(closing, conn.db.decisionRequest.id.find(request.id))) return;
    await conn.reducers.submitDecision({
      requestId: request.id,
      action: JSON.stringify(decision.action),
      thought: decision.thought,
      latencyMs: Math.max(0, Math.round(performance.now() - start)),
    });
  } catch (error) {
    // Knockout/death can expire a request while the provider is responding,
    // including between the local check and reducer execution.
    if (!canSubmitDecision(closing, conn.db.decisionRequest.id.find(request.id))) return;
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
  if (captureInterval) clearInterval(captureInterval);
  try {
    await conn.reducers.setRunning({ running: false });
    await new Promise(resolve => setTimeout(resolve, 500));
    if (isLedger) {
      const cases = [...conn.db.financeCase.iter()];
      const verdicts = [...conn.db.financeVerdict.iter()];
      if (failures || deskAssignments.size !== roster.length || cases.length !== roster.length
        || cases.some(entry => entry.status !== 'closed' || entry.stopped || !deskAssignments.has(entry.id) || !verdicts.some(verdict => verdict.caseId === entry.id))) throw new Error('Incomplete Ledger run.');
      const models = [...new Set(roster.map(entry => entry.modelId))].map(modelId => {
        const selected = cases.filter(entry => entry.modelId === modelId);
        const passed = selected.filter(entry => verdicts.some(verdict => verdict.caseId === entry.id && verdict.pass)).length;
        return { modelId, cases: selected.length, passed, compliantCompletion: passed / selected.length };
      });
      capture();
      await writeFile(path.join(runDirectory, 'report.json'), JSON.stringify({ scenario: 'ledger', caseId: LEDGER_CASE_ID, variant: LEDGER_VARIANT, models, cases: cases.map(entry => ({ ...entry, slot: deskAssignments.get(entry.id), verdict: verdicts.find(verdict => verdict.caseId === entry.id) })) }, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value, 2), { flag: 'wx' });
      conn.disconnect();
      process.exit(0);
    }
    const rows = snapshot();
    const llms = rows.agents.filter(agent => agent.kind === 'llm');
    if (failures || !hasCompleteRoster(llms, assignments) || rows.decisions.filter(decision => decision.status === 'done').length === 0
      || hasIncompleteDecisions(rows.decisions)
      || llms.some(agent => !rows.scores.some(score => score.agentId === agent.id))) throw new Error('Incomplete run.');
    const report = buildReport(rows);
    capture();
    await writeFile(path.join(runDirectory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    conn.disconnect();
    process.exit(0);
  } catch { await pauseAndExit(); }
}

function checkCompletion(): void {
  if (!ready || closing) return;
  if (isLedger) {
    const cases = [...conn.db.financeCase.iter()];
    if (deskAssignments.size === roster.length && cases.length === roster.length && cases.every(entry => entry.status === 'closed') && inFlight.size === 0) void finish();
    return;
  }
  const world = conn.db.world.id.find(0);
  const llms = [...conn.db.agent.iter()].filter(agent => agent.kind === 'llm');
  if (rosterHasFinished(world?.rescueState, llms, assignments) && inFlight.size === 0) void finish();
}

async function initialize(): Promise<void> {
  try {
    if (closing) return;
    if ([...conn.db.agent.iter()].length > 0 || conn.db.meta.key.find('run')) throw new Error('Database is not fresh.');
    fresh = true;
    await conn.reducers.claimHarness({});
    claimed = true;
    await conn.reducers.setRunning({ running: false });
    if (isLedger) {
      if ([...conn.db.financeCase.iter()].length) throw new Error('Desk database is not fresh.');
      let slot = 0;
      for (const entry of options.roster) {
        const previous = new Set([...conn.db.financeCase.iter()].map(row => row.id));
        await conn.reducers.queueFinanceRun({ modelId: entry.modelId, variant: LEDGER_VARIANT, repeat: entry.count, cases: LEDGER_CASE_ID });
        const deadline = Date.now() + 5_000;
        let added = [...conn.db.financeCase.iter()].filter(row => !previous.has(row.id));
        while (added.length !== entry.count && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 20));
          added = [...conn.db.financeCase.iter()].filter(row => !previous.has(row.id));
        }
        if (added.length !== entry.count || added.some(row => row.modelId !== entry.modelId || row.scenarioId !== LEDGER_CASE_ID || row.variant !== LEDGER_VARIANT)) throw new Error('Queued desk roster could not be verified.');
        for (const row of added.sort((a, b) => a.sample - b.sample)) deskAssignments.set(row.id, roster[slot++]);
      }
      await conn.reducers.setRunInfo({ info: JSON.stringify({ scenario: 'ledger', caseId: LEDGER_CASE_ID, promptVariant: LEDGER_VARIANT, roster, caseSlots: [...deskAssignments].map(([caseId, assignment]) => ({ caseId: caseId.toString(), ...assignment })), startedAt: new Date().toISOString() }) });
      await mkdir(runDirectory, { recursive: true });
      recorder = new ReplayRecorder(runDirectory, dbName);
      capture();
      captureInterval = setInterval(captureSafely, 500);
      ready = true;
      clearTimeout(startupTimer);
      process.stdout.write('BENCHMARK_RUNNING\n');
      for (const request of conn.db.decisionRequest.iter()) if (request.status === 'pending') void answer(request);
      interval = setInterval(checkCompletion, 1_000);
      return;
    }
    for (const { name, modelId } of roster) await conn.reducers.spawnAgent({ name, modelId });
    // The module starts ticking at publish time. Reseed only this verified fresh
    // database so the selected roster begins together at game time zero.
    await conn.reducers.resetExperiment({});
    await conn.reducers.setRunning({ running: false });
    // Reducer acknowledgement can precede subscription replay. Bind the actual
    // persisted IDs before answering any request, rather than trusting model IDs.
    const deadline = Date.now() + 5_000;
    while ([...conn.db.agent.iter()].filter(agent => agent.kind === 'llm').length !== roster.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    for (const assignment of roster) {
      const matches = [...conn.db.agent.iter()].filter(agent => agent.kind === 'llm' && agent.name === assignment.name && agent.modelId === assignment.modelId);
      if (matches.length !== 1) throw new Error('Spawned roster could not be verified.');
      assignments.set(matches[0].id, assignment);
    }
    if (!hasCompleteRoster([...conn.db.agent.iter()].filter(agent => agent.kind === 'llm'), assignments)) throw new Error('Unexpected survivor roster.');
    await conn.reducers.setRunInfo({ info: JSON.stringify({ scenario: options.scenario, promptVariant: 'charter', promptVersion: promptVersion(), systemPrompt: prompt, roster, timeScale: 1, startedAt: new Date().toISOString() }) });
    await mkdir(runDirectory, { recursive: true });
    recorder = new ReplayRecorder(runDirectory, dbName);
    capture();
    captureInterval = setInterval(captureSafely, 500);
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
    for (const [table, source] of [
      ['hit_event', conn.db.hitEvent], ['transfer_event', conn.db.transferEvent], ['world_event', conn.db.worldEvent],
    ] as const) source.onInsert((_ctx, row) => {
      try { recorder?.event(table, row); } catch { fail(); }
    });
    conn.db.decisionRequest.onInsert((_ctx, request) => { if (request.status === 'pending') void answer(request); });
    conn.subscriptionBuilder().onApplied(() => { void initialize(); }).onError(() => fail()).subscribe([
      tables.world, tables.agent, tables.score, tables.temptation, tables.ethicsEvent,
      tables.decisionRequest, tables.meta, tables.record, tables.discovery,
      tables.financeCase, tables.financeStep, tables.financeVerdict,
      tables.resourceNode, tables.container, tables.item, tables.structure, tables.mob, tables.hazard,
      tables.message, tables.memory, tables.explored, tables.hitEvent, tables.transferEvent, tables.worldEvent,
    ]);
  })
  .onConnectError(() => fail())
  .build();
