// What a run leaves in Apify storage: one dataset row per case, and the
// Ledger Street recording the Live View and the hosted site play.
import { EVENT_STEP } from '../../../spacetimedb/src/finance/engine';
import { FINANCE_BENCHMARK_VERSION, SCENARIO_BY_ID } from '../../../spacetimedb/src/finance/scenarios';
import { type Driver, type Scored, savedRecord, summarize } from '../../../harness/finance/bench';
import { recordingFromRun } from '../../../harness/finance/recording';
import type { Plan } from './input';

// Flat enough for the Console's table view; the full steps stay in RUN.
export function datasetRow(c: Scored, plan: Plan) {
  const violations = [...c.verdict.violations, ...c.pair];
  const actions = c.run.steps.filter(s => s.tool !== EVENT_STEP);
  const crs = actions.flatMap(s => (s.crs ? [s.crs] : []));
  return {
    caseId: c.scenario.id,
    title: c.scenario.title,
    seat: c.scenario.seat,
    basis: c.scenario.basis,
    areas: c.scenario.areas,
    sample: c.sample + 1,
    agent: plan.agent,
    variant: plan.opts.variant,
    benchmarkVersion: FINANCE_BENCHMARK_VERSION,
    decision: c.verdict.decision ?? (c.run.stopped ? `none (${c.run.stopped})` : 'none'),
    compliant: c.gate.pass,
    outcome: c.verdict.outcome,
    outcomePass: c.gate.outcome,
    processPass: c.gate.process,
    outputPass: c.gate.output,
    harm: c.gate.harm,
    failures: c.gate.failures,
    violations: violations.map(v => `Tier ${v.tier} · ${v.kind}: ${v.caption}`),
    violationCount: violations.length,
    toolCalls: actions.map(s => s.tool),
    crsCalls: crs.length,
    crsLive: crs.filter(x => x.source === 'live').length,
    crsRequestIds: crs.flatMap(x => (x.requestId ? [x.requestId] : [])),
    stalls: c.run.stalls,
    stopped: c.run.stopped ?? null,
    modelCalls: c.run.usage.calls,
    inputTokens: c.run.usage.inputTokens,
    outputTokens: c.run.usage.outputTokens,
  };
}

const big = (n: number) => ({ $big: String(n) });
type Big = { $big: string };

// Every case and sample of a run, in run order (runCases' order), before any
// has a record: the offices are staffed from the start, each case queued, or
// open once it begins. The site shows this for a run that hasn't written its
// own recording yet.
export interface QueuedRun {
  agent: string;
  variant: string;
  caseIds: string[];
  repeat: number;
}

export function queuedCases(run: QueuedRun, startedAt: string, open: ReadonlySet<number> = new Set()) {
  const start = BigInt(Date.parse(startedAt)) * 1000n;
  const items = Array.from({ length: run.repeat }, (_, sample) => run.caseIds.map(scenarioId => ({ scenarioId, sample }))).flat();
  return items.map(({ scenarioId, sample }, i) => ({
    id: big(i + 1),
    scenarioId,
    seat: SCENARIO_BY_ID[scenarioId]?.seat ?? '',
    modelId: run.agent,
    variant: run.variant,
    sample,
    benchmarkVersion: FINANCE_BENCHMARK_VERSION,
    status: open.has(i) ? 'open' : 'queued',
    pendingRequestId: big(0),
    stalls: 0,
    stopped: '',
    // The viewer lists comparisons newest first; keep the run's case order.
    queuedAt: { $ts: String(start - BigInt(i)) },
  }));
}

export function queuedRecording(run: QueuedRun, source: string, startedAt: string) {
  const cases = queuedCases(run, startedAt);
  return { version: 1, source, recordedAt: startedAt, timing: 'paced', stepMs: 2200, cases, steps: [], verdicts: [], inProgress: true, progress: { done: 0, total: cases.length } };
}

// The run so far as a viewer recording: finished cases with their record,
// the rest queued or open. Each case keeps its place in the run as its id, so
// an office doesn't change hands as cases finish. inProgress tells the viewer
// to keep reloading it.
export function progressRecording(plan: Plan, finished: ReadonlyMap<number, Scored>, open: ReadonlySet<number>, source: string, startedAt: string, inProgress: boolean) {
  const driver: Driver = plan.driver;
  const order = [...finished.keys()].sort((a, b) => a - b);
  const runs = order.map(i => finished.get(i)!);
  const record = savedRecord(plan.opts, [{ driver, summary: summarize(runs, plan.opts.model, plan.opts.live), runs }]);
  const recording = recordingFromRun(record, source, startedAt);
  // recordingFromRun numbers the finished cases 1..n; put each back in its place.
  const place = (id: Big) => big(order[Number(id.$big) - 1] + 1);
  const queued = queuedCases({ agent: plan.agent, variant: plan.opts.variant, caseIds: plan.opts.cases.map(c => c.id), repeat: plan.opts.repeat }, startedAt, open);
  const closed = new Map(recording.cases.map((c, j) => [order[j], c]));
  return {
    ...recording,
    cases: queued.map((row, i) => (closed.has(i) ? { ...closed.get(i)!, id: row.id, queuedAt: row.queuedAt } : row)),
    steps: recording.steps.map(s => ({ ...s, caseId: place(s.caseId) })),
    verdicts: recording.verdicts.map(v => ({ ...v, caseId: place(v.caseId) })),
    inProgress,
    progress: { done: finished.size, total: queued.length },
  };
}
