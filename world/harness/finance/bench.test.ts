import { describe, expect, it } from 'vitest';
import { SCENARIOS, SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import { policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { type BenchOptions, benchRunCase, runCases, savedRecord, summarize } from './bench';
import type { RunCase } from './drivers';

const options = (ids: string[], extra: Partial<BenchOptions> = {}): BenchOptions => ({
  variant: 'house-rules', provider: 'script', model: 'policy', cases: ids.map(id => SCENARIO_BY_ID[id]), concurrency: 3, repeat: 1, raw: false, live: false, ...extra,
});
const twins = SCENARIOS.filter(s => s.pairId === 'twin-P02').map(s => s.id);

describe('runCases', () => {
  it('reports each case once, in run order, with the same scores as the script', async () => {
    const opts = options(['lend-clean-approve', 'lend-hide-from-audit', 'vendor-genuine-change'], { repeat: 2 });
    const seen: number[] = [];
    const scored = await runCases(benchRunCase('script', opts, null), opts, { onCase: (_c, i) => { seen.push(i); } });
    expect(scored.map(c => `${c.scenario.id}#${c.sample}`)).toEqual([
      'lend-clean-approve#0', 'lend-hide-from-audit#0', 'vendor-genuine-change#0',
      'lend-clean-approve#1', 'lend-hide-from-audit#1', 'vendor-genuine-change#1',
    ]);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(scored.every(c => c.gate.pass)).toBe(true);
  });

  it('holds a pair\'s second case until its first has finished, then compares them', async () => {
    const [first, second] = twins;
    const opts = options([first, second], { concurrency: 2 });
    const order: string[] = [];
    let releaseFirst = () => {};
    const firstDone = new Promise<void>(resolve => { releaseFirst = resolve; });
    // The second twin finishes first; it must not be reported before the first.
    const runCase: RunCase = async scenario => {
      if (scenario.id === first) await firstDone;
      else setTimeout(releaseFirst, 20);
      return { steps: runBrain(policyFollower, scenario), notes: [], stalls: 0, usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    };
    const scored = await runCases(runCase, opts, { onCase: c => { order.push(c.scenario.id); } });
    expect(order).toEqual([first, second]);
    expect(scored[1].pair).toEqual([]);
  });

  it('scores a case that throws as no decision and carries on', async () => {
    const opts = options(['lend-clean-approve', 'lend-hide-from-audit']);
    const errors: string[] = [];
    const runCase: RunCase = async scenario => {
      if (scenario.id === 'lend-clean-approve') throw new Error('provider down');
      return { steps: runBrain(policyFollower, scenario), notes: [], stalls: 0, usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    };
    const scored = await runCases(runCase, opts, { onError: (s, m) => errors.push(`${s.id}: ${m}`) });
    expect(errors).toEqual(['lend-clean-approve: provider down']);
    expect(scored[0].verdict.outcome).toBe('no_decision');
    expect(scored[0].run.stopped).toBe('error: provider down');
    expect(scored[1].gate.pass).toBe(true);
  });
});

describe('savedRecord', () => {
  it('writes the run file finance:bench always has', async () => {
    const opts = options(['lend-clean-approve']);
    const runs = await runCases(benchRunCase('script', opts, null), opts);
    const record = savedRecord(opts, [{ driver: 'script', summary: summarize(runs, opts.model, false), runs }]);
    expect(record.config).toMatchObject({ provider: 'script', model: 'policy', effort: 'default', variant: 'house-rules', crsFormat: 'card', crsSource: 'snapshot', cases: ['lend-clean-approve'], repeat: 1 });
    expect(record.results[0].cases[0]).toMatchObject({ id: 'lend-clean-approve', sample: 0 });
    expect(record.results[0].summary.cases).toBe(1);
  });
});
