// What a run leaves in Apify storage: one dataset row per case, and the
// Ledger Street recording the Live View and the hosted site play.
import { EVENT_STEP } from '../../../spacetimedb/src/finance/engine';
import { FINANCE_BENCHMARK_VERSION } from '../../../spacetimedb/src/finance/scenarios';
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

// The cases finished so far, in run order, as a viewer recording. inProgress
// tells the viewer to keep reloading it.
export function progressRecording(plan: Plan, finished: Scored[], source: string, startedAt: string, inProgress: boolean, total: number) {
  const driver: Driver = plan.driver;
  const record = savedRecord(plan.opts, [{ driver, summary: summarize(finished, plan.opts.model, plan.opts.live), runs: finished }]);
  return { ...recordingFromRun(record, source, startedAt), inProgress, progress: { done: finished.length, total } };
}
