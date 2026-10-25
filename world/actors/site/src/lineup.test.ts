import { describe, expect, it } from 'vitest';
import { queuedRecording } from '../../enders-bench/src/queued';
import { cohorts, officesFor } from '../../../src/finance-desk/comparison';
import { parseFinanceRecording } from '../../../src/finance-desk/replay';
import { groupRuns, lineupIds, lineupSummary, mergeRecordings, replayPath, type Recording, type RunSummary } from './lineup';

const at = '2026-10-25T09:00:00.000Z';
const cases = ['lend-clean-approve', 'lend-hide-from-audit'];
const queued = (agent: string, repeat = 1) => queuedRecording({ agent, variant: 'house-rules', caseIds: cases, repeat }, agent, at) as Recording;
const read = (r: Recording) => parseFinanceRecording(JSON.parse(JSON.stringify(r)));

describe('lineupIds', () => {
  it('takes one to four distinct run ids and nothing else', () => {
    expect(lineupIds('abc')).toEqual(['abc']);
    expect(lineupIds('a,b,c,d')).toEqual(['a', 'b', 'c', 'd']);
    expect(lineupIds('a,b,c,d,e')).toBeNull();
    expect(lineupIds('a,a')).toBeNull();
    expect(lineupIds('a,../b')).toBeNull();
    expect(lineupIds('a,')).toBeNull();
    expect(replayPath(['a', 'b'])).toBe('/api/apify/runs/a,b/replay');
  });
});

describe('mergeRecordings', () => {
  it('puts every agent in its own office on the same case, with ids that never collide', () => {
    const ender = queued('custom:ender');
    // A finished first case for Ender: one step and a verdict on case 1.
    ender.cases[0] = { ...ender.cases[0], status: 'closed' };
    ender.steps = [{ id: { $big: '1' }, caseId: { $big: '1' }, seq: 0, tool: 'approve_loan', args: '{}', result: '', requestId: { $big: '0' }, thought: '', crs: '' }];
    ender.verdicts = [{ caseId: { $big: '1' }, pass: true, outcome: true, process: true, output: true, harm: false, abstained: false, actionNeeded: true, decision: 'approve_loan', failures: '[]', verdict: '{}' }];
    ender.progress = { done: 1, total: 2 };
    const haiku = queued('anthropic:claude-haiku-5-5');
    haiku.steps = [{ id: { $big: '1' }, caseId: { $big: '2' }, seq: 0, tool: 'pull_credit_report', args: '{}', result: '', requestId: { $big: '0' }, thought: '', crs: '' }];

    const merged = mergeRecordings([ender, haiku], 'lineup');
    expect(merged).toMatchObject({ inProgress: true, progress: { done: 1, total: 4 } });
    expect(merged.lineup).toBeUndefined();
    const data = read(merged);
    expect(data.cases.map(c => [c.id, c.modelId])).toEqual([[1n, 'custom:ender'], [2n, 'custom:ender'], [3n, 'anthropic:claude-haiku-5-5'], [4n, 'anthropic:claude-haiku-5-5']]);
    expect(data.steps.map(s => [s.id, s.caseId])).toEqual([[1n, 1n], [2n, 4n]]);
    expect(data.verdicts.map(v => v.caseId)).toEqual([1n]);

    const groups = cohorts(data.cases);
    expect(groups.map(g => g.row.scenarioId)).toEqual(cases);
    expect(groups.every(g => g.models.size === 2)).toBe(true);
    expect(officesFor(groups[0].key, data.cases, data.steps, data.verdicts).filter(o => o.row).map(o => o.modelId)).toEqual(['anthropic:claude-haiku-5-5', 'custom:ender']);
  });

  it('seats an agent picked twice beside the others', () => {
    const merged = mergeRecordings([queued('custom:ender', 2), queued('anthropic:claude-haiku-5-5')], 'lineup');
    expect(merged.lineup).toBe(true);
    const data = read(merged);
    const [first] = cohorts(data.cases, true);
    expect(officesFor(first.key, data.cases, data.steps, data.verdicts).filter(o => o.row)).toHaveLength(3);
  });
});

const run = (runId: string, status: string, label = runId): RunSummary => ({ runId, label, status, statusMessage: '', startedAt: at, finishedAt: status === 'RUNNING' ? null : '2026-10-25T09:05:00.000Z', replayUrl: replayPath([runId]) });

describe('lineupSummary', () => {
  it('is going while any run is, and done once all are', () => {
    expect(lineupSummary(['a', 'b'], [run('a', 'SUCCEEDED', 'Ender'), run('b', 'RUNNING', 'Haiku')])).toMatchObject({ runId: 'a,b', label: 'Ender + Haiku', status: 'RUNNING', statusMessage: '1 of 2 agents done', finishedAt: null, replayUrl: '/api/apify/runs/a,b/replay' });
    expect(lineupSummary(['a', 'b'], [run('a', 'SUCCEEDED', 'Ender'), run('b', 'FAILED', 'Haiku')])).toMatchObject({ status: 'SUCCEEDED', statusMessage: 'Haiku didn’t finish', finishedAt: '2026-10-25T09:05:00.000Z' });
    expect(lineupSummary(['a', 'b'], [run('a', 'ABORTED'), run('b', 'FAILED')]).status).toBe('ABORTED');
  });
});

describe('groupRuns', () => {
  it('folds a lineup into one entry and leaves single runs alone', () => {
    const lineups = new Map([['b', ['b', 'c']], ['c', ['b', 'c']]]);
    const grouped = groupRuns([run('a', 'SUCCEEDED'), run('c', 'RUNNING'), run('b', 'RUNNING'), run('d', 'SUCCEEDED')], id => lineups.get(id));
    expect(grouped.map(r => r.runId)).toEqual(['a', 'b,c', 'd']);
  });
});
