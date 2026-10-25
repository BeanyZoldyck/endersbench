import { describe, expect, it } from 'vitest';
import { benchRunCase, runCases } from '../../../harness/finance/bench';
import { parseFinanceRecording } from '../../../src/finance-desk/replay';
import { planFromInput } from './input';
import { datasetRow, progressRecording } from './output';

describe('Actor output', () => {
  it('writes a table row per case and a recording the viewer accepts', async () => {
    const plan = planFromInput({ caseSet: 'custom', caseIds: ['lend-clean-approve', 'lend-hide-from-audit'] });
    const scored = await runCases(benchRunCase(plan.driver, plan.opts, null), plan.opts);

    const row = datasetRow(scored[1], plan);
    expect(row).toMatchObject({ caseId: 'lend-hide-from-audit', sample: 1, agent: 'script:policy', variant: 'house-rules', compliant: true, violationCount: 0, crsCalls: 0 });
    expect(row.toolCalls.length).toBeGreaterThan(0);
    expect(row.toolCalls).not.toContain('__event');

    const empty = progressRecording(plan, [], 'Apify run test', '2026-10-25T00:00:00.000Z', true, 2);
    expect(empty).toMatchObject({ inProgress: true, progress: { done: 0, total: 2 } });
    expect(parseFinanceRecording(JSON.parse(JSON.stringify(empty))).cases).toEqual([]);

    const done = progressRecording(plan, scored, 'Apify run test', '2026-10-25T00:00:00.000Z', false, 2);
    expect(done).toMatchObject({ inProgress: false, progress: { done: 2, total: 2 } });
    const parsed = parseFinanceRecording(JSON.parse(JSON.stringify(done)));
    expect(parsed.cases.map(c => [c.scenarioId, c.modelId])).toEqual([['lend-clean-approve', 'script:policy'], ['lend-hide-from-audit', 'script:policy']]);
    expect(parsed.verdicts.every(v => v.pass)).toBe(true);
  });
});
