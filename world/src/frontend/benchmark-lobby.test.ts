import { describe, expect, it } from 'vitest';
import { benchmarkBlocker, rosterEntries, rosterLabel, type BenchmarkConfig } from './benchmark-client';
import { initialStudioState, rosterSize, transitionStudio, type BenchmarkRoster, type StudioModel } from './model';

const connected: BenchmarkConfig = {
  ready: true,
  models: ['Ender', 'GLM 5.3', 'Claude 5.5', 'GPT-6 Luna'].map(model => ({ id: model as StudioModel, modelId: `${model}-configured`, available: true })),
  scenarios: [{ id: 'clearing-charter', name: 'The Clearing', description: 'Share supplies.' }, { id: 'ledger', name: 'Ledger', description: 'Review permitted financial evidence.', available: false, reason: 'Ledger is not connected.' }],
};
const empty: BenchmarkRoster = {};

describe('benchmark lobby lineup', () => {
  it('defaults to four GPT-6 Luna agents and the existing supported scenario', () => {
    const state = initialStudioState('');
    expect(state.draftRoster).toEqual({ ...empty, 'GPT-6 Luna': 4 });
    expect(state.draftScenario).toBe('clearing-charter');
  });
  it('enforces a shared maximum and zero floor across repeated additions and removals', () => {
    let state = initialStudioState('');
    const full = transitionStudio(state, { type: 'adjust-draft-count', model: 'Claude 5.5', delta: 1 });
    expect(full).toBe(state);
    for (let index = 0; index < 10; index++) state = transitionStudio(state, { type: 'adjust-draft-count', model: 'GPT-6 Luna', delta: -1 });
    expect(rosterSize(state.draftRoster)).toBe(0);
    for (const model of ['Claude 5.5', 'GLM 5.3', 'Ender', 'GPT-6 Luna', 'Claude 5.5'] as const) state = transitionStudio(state, { type: 'adjust-draft-count', model, delta: 1 });
    expect(state.draftRoster).toEqual({ Ender: 1, 'GLM 5.3': 1, 'Claude 5.5': 1, 'GPT-6 Luna': 1 });
    expect(rosterSize(state.draftRoster)).toBe(4);
  });
  it.each([1, 2, 3, 4])('allows a connected lineup of %i agents', count => {
    expect(benchmarkBlocker(connected, { ...empty, 'GPT-6 Luna': count }, 'clearing-charter')).toBeNull();
  });
  it('preserves lineup and scenario when navigating away and back', () => {
    let state = initialStudioState('');
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'GPT-6 Luna', delta: -1 });
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'Claude 5.5', delta: 1 });
    state = transitionStudio(state, { type: 'select-draft-scenario', scenario: 'ledger' });
    state = transitionStudio(state, { type: 'navigate', screen: 'setup' });
    state = transitionStudio(state, { type: 'navigate', screen: 'briefing' });
    state = transitionStudio(state, { type: 'back' });
    expect(state.draftRoster).toEqual({ ...empty, 'GPT-6 Luna': 3, 'Claude 5.5': 1 });
    expect(state.draftScenario).toBe('ledger');
  });
  it('serializes only positive entries and labels mixed counts truthfully', () => {
    const entries = rosterEntries({ ...empty, Ender: 1, 'GPT-6 Luna': 2 });
    expect(entries).toEqual([{ model: 'GPT-6 Luna', count: 2 }, { model: 'Ender', count: 1 }]);
    expect(rosterLabel(entries)).toBe('2 GPT-6 Luna + 1 Ender');
    expect(rosterLabel([])).toBe('No agents selected');
  });
  it('allows adding unavailable models while blocking launch with an actionable connection message', () => {
    const config = { ...connected, models: connected.models.map(model => model.id === 'Claude 5.5' ? { ...model, available: false, reason: 'Claude 5.5 connection missing.' } : model) };
    let state = initialStudioState('');
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'GPT-6 Luna', delta: -1 });
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'Claude 5.5', delta: 1 });
    expect(state.draftRoster['Claude 5.5']).toBe(1);
    expect(benchmarkBlocker(config, state.draftRoster, 'clearing-charter')).toBe('Connect Claude 5.5 before starting.');
  });
  it('blocks missing, unavailable, empty, oversized, and malformed selections', () => {
    expect(benchmarkBlocker(null, { ...empty, 'GPT-6 Luna': 1 }, 'clearing-charter')).toContain('Connect');
    expect(benchmarkBlocker(connected, empty, 'clearing-charter')).toContain('at least one');
    expect(benchmarkBlocker(connected, { ...empty, 'GPT-6 Luna': 4, 'Claude 5.5': 1 }, 'clearing-charter')).toContain('four');
    expect(benchmarkBlocker(connected, { ...empty, 'GPT-6 Luna': 1.5 }, 'clearing-charter')).toContain('four');
    expect(benchmarkBlocker(connected, { ...empty, 'GPT-6 Luna': 1 }, 'not-supported')).toContain('supported scenario');
    expect(benchmarkBlocker(connected, { ...empty, 'GPT-6 Luna': 1 }, 'ledger')).toBe('Ledger is not connected.');
  });
});
