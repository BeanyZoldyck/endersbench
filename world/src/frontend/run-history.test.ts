import { describe, expect, it } from 'vitest';
import { savedRecordings } from './run-history';
import { initialStudioState, transitionStudio } from './model';

describe('run history', () => {
  it('orders the archive by recording date, newest first', () => {
    const runs = savedRecordings('all');
    expect(runs).toHaveLength(7);
    expect(runs[0].id).toBe('clearing-charter-v8-admission');
    expect(runs.map(run => Date.parse(run.recordedAt))).toEqual(runs.map(run => Date.parse(run.recordedAt)).sort((a,b) => b-a));
  });
  it('does not attribute ChatGPT recordings to other models', () => {
    expect(savedRecordings('ChatGPT')).toEqual(savedRecordings('all'));
    for (const model of ['Ender', 'Grok', 'Claude'] as const) expect(savedRecordings(model)).toEqual([]);
  });
  it('keeps history filtering independent of model selection and across replay navigation', () => {
    let state = initialStudioState('?studio=compare');
    state = transitionStudio(state, { type: 'history-model', model: 'Claude' });
    expect(state.draftModel).toBe('ChatGPT');
    state = transitionStudio(state, { type: 'select-run', runId: 'clearing-charter-v8-rescued' });
    state = transitionStudio(state, { type: 'navigate', screen: 'monitor', timeMs: 0 });
    state = transitionStudio(state, { type: 'navigate', screen: 'compare' });
    expect(state.historyModel).toBe('Claude');
  });
});
