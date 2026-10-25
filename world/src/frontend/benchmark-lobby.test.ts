import { describe, expect, it } from 'vitest';
import { benchmarkBlocker, rosterEntries, rosterLabel, type BenchmarkConfig } from './benchmark-client';
import { initialStudioState, rosterSize, transitionStudio, type BenchmarkRoster, type StudioModel } from './model';

const connected: BenchmarkConfig = {
  ready: true,
  models: ['Ender', 'Grok', 'Claude', 'ChatGPT', 'Abliterated'].map(model => ({ id: model as StudioModel, modelId: `${model}-configured`, available: true })),
  scenarios: [{ id: 'clearing-charter', name: 'The Clearing', description: 'Share supplies.' }, { id: 'ledger', name: 'Ledger', description: 'Review permitted financial evidence.', available: false, reason: 'Ledger is not connected.' }],
};
const empty: BenchmarkRoster = { Ender: 0, Grok: 0, Claude: 0, ChatGPT: 0, Abliterated: 0 };

describe('benchmark lobby lineup', () => {
  it('defaults to four ChatGPT agents and the existing supported scenario', () => {
    const state = initialStudioState('');
    expect(state.draftRoster).toEqual({ ...empty, ChatGPT: 4 });
    expect(state.draftScenario).toBe('clearing-charter');
  });
  it('enforces a shared maximum and zero floor across repeated additions and removals', () => {
    let state = initialStudioState('');
    const full = transitionStudio(state, { type: 'adjust-draft-count', model: 'Claude', delta: 1 });
    expect(full).toBe(state);
    for (let index = 0; index < 10; index++) state = transitionStudio(state, { type: 'adjust-draft-count', model: 'ChatGPT', delta: -1 });
    expect(rosterSize(state.draftRoster)).toBe(0);
    for (const model of ['Claude', 'Grok', 'Ender', 'ChatGPT', 'Claude'] as const) state = transitionStudio(state, { type: 'adjust-draft-count', model, delta: 1 });
    expect(state.draftRoster).toEqual({ Ender: 1, Grok: 1, Claude: 1, ChatGPT: 1, Abliterated: 0 });
    expect(rosterSize(state.draftRoster)).toBe(4);
  });
  it.each([1, 2, 3, 4])('allows a connected lineup of %i agents', count => {
    expect(benchmarkBlocker(connected, { ...empty, ChatGPT: count }, 'clearing-charter')).toBeNull();
  });
  it('preserves lineup and scenario when navigating away and back', () => {
    let state = initialStudioState('');
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'ChatGPT', delta: -1 });
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'Claude', delta: 1 });
    state = transitionStudio(state, { type: 'select-draft-scenario', scenario: 'ledger' });
    state = transitionStudio(state, { type: 'navigate', screen: 'setup' });
    state = transitionStudio(state, { type: 'navigate', screen: 'briefing' });
    state = transitionStudio(state, { type: 'back' });
    expect(state.draftRoster).toEqual({ ...empty, ChatGPT: 3, Claude: 1 });
    expect(state.draftScenario).toBe('ledger');
  });
  it('serializes only positive entries and labels mixed counts truthfully', () => {
    const entries = rosterEntries({ ...empty, Ender: 1, ChatGPT: 2 });
    expect(entries).toEqual([{ model: 'Ender', count: 1 }, { model: 'ChatGPT', count: 2 }]);
    expect(rosterLabel(entries)).toBe('1 Ender + 2 ChatGPT');
    expect(rosterLabel([])).toBe('No agents selected');
  });
  it('allows adding unavailable models while blocking launch with an actionable connection message', () => {
    const config = { ...connected, models: connected.models.map(model => model.id === 'Claude' ? { ...model, available: false, reason: 'Claude connection missing.' } : model) };
    let state = initialStudioState('');
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'ChatGPT', delta: -1 });
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'Claude', delta: 1 });
    expect(state.draftRoster.Claude).toBe(1);
    expect(benchmarkBlocker(config, state.draftRoster, 'clearing-charter')).toBe('Connect Claude before starting.');
  });
  it('blocks missing, unavailable, empty, oversized, and malformed selections', () => {
    expect(benchmarkBlocker(null, { ...empty, ChatGPT: 1 }, 'clearing-charter')).toContain('Connect');
    expect(benchmarkBlocker(connected, empty, 'clearing-charter')).toContain('at least one');
    expect(benchmarkBlocker(connected, { ...empty, ChatGPT: 4, Claude: 1 }, 'clearing-charter')).toContain('four');
    expect(benchmarkBlocker(connected, { ...empty, ChatGPT: 1.5 }, 'clearing-charter')).toContain('four');
    expect(benchmarkBlocker(connected, { ...empty, ChatGPT: 1 }, 'not-supported')).toContain('supported scenario');
    expect(benchmarkBlocker(connected, { ...empty, ChatGPT: 1 }, 'ledger')).toBe('Ledger is not connected.');
  });
});
