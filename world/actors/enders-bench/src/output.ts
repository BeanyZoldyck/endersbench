// What a run leaves in Apify storage: one dataset row per case, and the
// Ledger Street recording the Live View and the hosted site play.
import { EVENT_STEP } from '../../../spacetimedb/src/finance/engine';
import { FINANCE_BENCHMARK_VERSION } from '../../../spacetimedb/src/finance/scenarios';
import { type Driver, type Scored, savedRecord, summarize } from '../../../harness/finance/bench';
import { recordingFromRun } from '../../../harness/finance/recording';
import type { Plan } from './input';
import { queuedCases } from './queued';

const big = (n: number) => ({ $big: String(n) });
type Big = { $big: string };

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

export { queuedRecording } from './queued';
