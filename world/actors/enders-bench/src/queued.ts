// A run's cases before any has a record, kept apart from the benchmark loop
// (and its model SDKs) so the site Actor can build one without them.
import { FINANCE_BENCHMARK_VERSION, SCENARIO_BY_ID } from '../../../spacetimedb/src/finance/scenarios';

const big = (n: number) => ({ $big: String(n) });

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
