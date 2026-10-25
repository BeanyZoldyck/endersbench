import { describe, expect, it } from 'vitest';
import { benchRunCase, runCases } from '../../../harness/finance/bench';
import { parseFinanceRecording } from '../../../src/finance-desk/replay';
import { planFromInput } from './input';
import { datasetRow, progressRecording, queuedRecording } from './output';

describe('Actor output', () => {
  it('writes a table row per case and a recording the viewer accepts', async () => {
    const plan = planFromInput({ caseSet: 'custom', caseIds: ['lend-clean-approve', 'lend-hide-from-audit'] });
    const scored = await runCases(benchRunCase(plan.driver, plan.opts, null), plan.opts);

    const row = datasetRow(scored[1], plan);
    expect(row).toMatchObject({ caseId: 'lend-hide-from-audit', sample: 1, agent: 'script:policy', variant: 'house-rules', compliant: true, violationCount: 0, crsCalls: 0 });
    expect(row.toolCalls.length).toBeGreaterThan(0);
    expect(row.toolCalls).not.toContain('__event');

    const at = '2026-10-25T00:00:00.000Z';
    const read = (r: unknown) => parseFinanceRecording(JSON.parse(JSON.stringify(r)));
    const empty = progressRecording(plan, new Map(), new Set(), 'Apify run test', at, true);
    expect(empty).toMatchObject({ inProgress: true, progress: { done: 0, total: 2 } });
    expect(read(empty).cases.map(c => [c.scenarioId, c.modelId, c.status])).toEqual([['lend-clean-approve', 'script:policy', 'queued'], ['lend-hide-from-audit', 'script:policy', 'queued']]);

    // The second case finishes first: it keeps its place and id, and the first stays open.
    const half = read(progressRecording(plan, new Map([[1, scored[1]]]), new Set([0]), 'Apify run test', at, true));
    expect(half.cases.map(c => [c.id, c.scenarioId, c.status])).toEqual([[1n, 'lend-clean-approve', 'open'], [2n, 'lend-hide-from-audit', 'closed']]);
    expect(half.steps.length).toBeGreaterThan(0);
    expect(half.steps.every(s => s.caseId === 2n)).toBe(true);
    expect(half.verdicts.map(v => v.caseId)).toEqual([2n]);

    const done = progressRecording(plan, new Map(scored.map((c, i) => [i, c])), new Set(), 'Apify run test', at, false);
    expect(done).toMatchObject({ inProgress: false, progress: { done: 2, total: 2 } });
    const parsed = read(done);
    expect(parsed.cases.map(c => [c.scenarioId, c.modelId, c.status])).toEqual([['lend-clean-approve', 'script:policy', 'closed'], ['lend-hide-from-audit', 'script:policy', 'closed']]);
    expect(parsed.verdicts.every(v => v.pass)).toBe(true);
  });

  it('queues every case and sample of a run that has no recording yet', () => {
    const queued = parseFinanceRecording(JSON.parse(JSON.stringify(queuedRecording({ agent: 'custom:ender', variant: 'house-rules', caseIds: ['lend-clean-approve', 'lend-hide-from-audit'], repeat: 2 }, 'starting', '2026-10-25T00:00:00.000Z'))));
    expect(queued.cases.map(c => [c.scenarioId, c.sample, c.status, c.modelId])).toEqual([
      ['lend-clean-approve', 0, 'queued', 'custom:ender'], ['lend-hide-from-audit', 0, 'queued', 'custom:ender'],
      ['lend-clean-approve', 1, 'queued', 'custom:ender'], ['lend-hide-from-audit', 1, 'queued', 'custom:ender'],
    ]);
    expect(queued.steps).toEqual([]);
  });
});
