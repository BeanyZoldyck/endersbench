import { describe, expect, it } from 'vitest';
import { initialStudioState, replayEventIndex, transitionStudio, type StudioAction, type StudioState } from './model';

function journey(...actions: StudioAction[]): StudioState {
  return actions.reduce(transitionStudio, initialStudioState(''));
}

describe('Observation Studio navigation contracts', () => {
  it.each(['models', 'setup', 'single', 'briefing', 'monitor', 'follow', 'outcome', 'lending', 'compare', 'context', 'method'])('supports direct %s entry', screen => {
    expect(initialStudioState(`?studio=${screen}`).screen).toBe(screen);
  });
  it('falls back safely for an unknown screen', () => {
    expect(initialStudioState('?studio=unknown').screen).toBe('landing');
  });
  it.each(['?replay=/demo/clearing-charter-v8-admission.json.gz', '?live=1'])('opens observation for %s', query => {
    expect(initialStudioState(query).screen).toBe('monitor');
  });
  it('draft changes never relabel the selected saved run', () => {
    const initial = initialStudioState('');
    const result = transitionStudio(initial, { type: 'select-draft-model', model: 'Claude' });
    expect(result.runId).toBe(initial.runId);
    expect(result.draftModel).toBe('Claude');
  });
  it('retains draft model through single-agent preview and return', () => {
    const result = journey(
      { type: 'select-draft-model', model: 'Grok' },
      { type: 'select-draft-mode', mode: 'single' },
      { type: 'navigate', screen: 'briefing' },
      { type: 'back' },
    );
    expect(result).toMatchObject({ screen: 'single', draftMode: 'single', draftModel: 'Grok' });
  });
  it('switches agents without moving the replay or changing the run', () => {
    const result = journey(
      { type: 'navigate', screen: 'follow' },
      { type: 'select-agent', agentId: '1' },
      { type: 'select-event', index: 3 },
      { type: 'select-agent', agentId: '2' },
    );
    expect(result).toMatchObject({ screen: 'follow', selectedAgentId: '2', eventIndex: 3, runId: 'clearing-charter-v8-admission' });
  });
  it('nested evidence and method Back restore the exact caller selection', () => {
    const origin = journey(
      { type: 'navigate', screen: 'follow' },
      { type: 'select-agent', agentId: '2' },
      { type: 'select-event', index: 4 },
    );
    const context = transitionStudio(origin, { type: 'navigate', screen: 'context' });
    const method = transitionStudio(context, { type: 'navigate', screen: 'method' });
    const backContext = transitionStudio(method, { type: 'back' });
    const backFollow = transitionStudio(backContext, { type: 'back' });
    expect(backContext.screen).toBe('context');
    expect(backFollow).toEqual({ ...origin, restoreNonce: backFollow.restoreNonce });
    expect(backFollow.restoreNonce).toBeGreaterThan(origin.restoreNonce);
  });
  it('direct context entry has a safe back destination', () => {
    expect(transitionStudio(initialStudioState('?studio=context'), { type: 'back' }).screen).toBe('compare');
  });
  it('leaving a playback screen pauses playback', () => {
    const playing = journey({ type: 'navigate', screen: 'monitor' }, { type: 'replay', command: 'play', count: 5 });
    expect(transitionStudio(playing, { type: 'navigate', screen: 'method' }).playing).toBe(false);
  });
  it('selecting a new run clears stale agent and event state', () => {
    expect(journey({ type: 'select-agent', agentId: '1' }, { type: 'select-event', index: 9 }, { type: 'select-run', runId: 'clearing-reward-v8' }))
      .toMatchObject({ runId: 'clearing-reward-v8', selectedAgentId: null, eventIndex: 0, playing: false });
  });
  it('cancel leaves the applied comparison untouched', () => {
    const result = journey({ type: 'begin-model-change' }, { type: 'pending-model', slot: 1, model: 'Claude' }, { type: 'cancel-model-change' });
    expect(result.comparePair).toEqual(['Ender', 'Grok']);
    expect(result.pendingComparePair).toBeNull();
  });
  it('applies a distinct comparison only on Apply', () => {
    const pending = journey({ type: 'begin-model-change' }, { type: 'pending-model', slot: 1, model: 'Claude' });
    expect(pending.comparePair).toEqual(['Ender', 'Grok']);
    expect(transitionStudio(pending, { type: 'apply-model-change' }).comparePair).toEqual(['Ender', 'Claude']);
  });
  it('rejects duplicate model comparisons at the state boundary', () => {
    const duplicate = journey({ type: 'begin-model-change' }, { type: 'pending-model', slot: 1, model: 'Ender' });
    expect(transitionStudio(duplicate, { type: 'apply-model-change' }).comparePair).toEqual(['Ender', 'Grok']);
  });
  it('restores comparison filter and pair after evidence', () => {
    const result = journey({ type: 'navigate', screen: 'compare' }, { type: 'compare-scenario', scenario: 'lending' }, { type: 'navigate', screen: 'context' }, { type: 'navigate', screen: 'method' }, { type: 'back' }, { type: 'back' });
    expect(result).toMatchObject({ screen: 'compare', compareScenario: 'lending', comparePair: ['Ender', 'Grok'] });
  });
  it('keeps Lending context scoped through nested navigation', () => {
    const result = journey({ type: 'select-briefing-scenario', scenario: 'lending' }, { type: 'navigate', screen: 'lending' }, { type: 'navigate', screen: 'context' }, { type: 'back' });
    expect(result).toMatchObject({ screen: 'lending', briefingScenario: 'lending' });
  });
  it('preserves landing section when returning from the studio', () => {
    const result = journey({ type: 'landing-section', section: 'evidence' }, { type: 'navigate', screen: 'setup' }, { type: 'back' });
    expect(result).toMatchObject({ screen: 'landing', landingSection: 'evidence' });
  });
  it('restores an exact playback position between events through nested Back', () => {
    const result = journey(
      { type: 'navigate', screen: 'follow' },
      { type: 'select-agent', agentId: '3' },
      { type: 'navigate', screen: 'context', timeMs: 135_123 },
      { type: 'select-event', index: 8 },
      { type: 'navigate', screen: 'method', timeMs: 290_456 },
      { type: 'back' },
    );
    expect(result).toMatchObject({ screen: 'context', replayTimeMs: 290_456, selectedAgentId: '3' });
    expect(transitionStudio(result, { type: 'back' })).toMatchObject({ screen: 'follow', replayTimeMs: 135_123, selectedAgentId: '3', eventIndex: 0 });
  });
  it('keeps an explicitly supplied legacy replay link on that recording', () => {
    expect(initialStudioState('?replay=/demo/clearing-reward-v8.json.gz&t=0:12'))
      .toMatchObject({ runId: 'clearing-reward-v8', screen: 'monitor' });
  });
});

describe('replay boundaries', () => {
  it.each([
    [0, 0, 'previous', 0], [0, 0, 'next', 0], [1, 0, 'next', 0],
    [4, 0, 'previous', 0], [4, 3, 'next', 3], [4, 2, 'previous', 1],
    [4, 2, 'next', 3], [4, 3, 'stop', 0], [4, -5, 'previous', 0],
    [4, 99, 'next', 3],
  ] as const)('%i records at %i, %s -> %i', (count, index, command, expected) => {
    expect(replayEventIndex(count, index, command)).toBe(expected);
  });
  it('play at the last event restarts the sequence', () => {
    expect(journey({ type: 'select-event', index: 3 }, { type: 'replay', command: 'play', count: 4 })).toMatchObject({ eventIndex: 0, playing: true });
  });
  it('stop resets to the first event and pauses', () => {
    expect(journey({ type: 'select-event', index: 2 }, { type: 'replay', command: 'play', count: 4 }, { type: 'replay', command: 'stop', count: 4 })).toMatchObject({ eventIndex: 0, playing: false });
  });
  it('does not claim playback started for an empty sequence', () => {
    expect(journey({ type: 'replay', command: 'play', count: 0 }).playing).toBe(false);
  });
});
