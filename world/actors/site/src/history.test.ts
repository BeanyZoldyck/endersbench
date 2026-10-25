import { describe, expect, it } from 'vitest';
import { parseSavedRecordings } from '../../../src/frontend/run-history';
import { historyEntry, runUuid } from './history';

const run = { id: 'Iq0NkJRlpDU7v1khb', status: 'SUCCEEDED', startedAt: new Date('2026-10-25T05:46:00Z'), finishedAt: new Date('2026-10-25T05:46:45Z') };

describe('runUuid', () => {
  it('gives an Apify run the same uuid-shaped id every time, and different runs different ids', () => {
    expect(runUuid(run.id)).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    expect(runUuid(run.id)).toBe(runUuid(run.id));
    expect(runUuid('other')).not.toBe(runUuid(run.id));
  });
});

describe('historyEntry', () => {
  it('turns a model run into a Ledger Street recording the history page accepts', () => {
    const entry = historyEntry(run, { provider: 'custom', model: 'ender', caseSet: 'quick' })!;
    expect(entry).toMatchObject({ model: 'Ender', modelId: 'custom:ender', scenario: 'ledger', label: 'Quick tour · 7 cases', status: 'completed', durationMs: 45_000 });
    expect(entry.replayUrl).toBe(`/api/benchmarks/${entry.id}/replay`);
    expect(parseSavedRecordings([entry])).toHaveLength(1);
  });

  it('names catalog models by their catalog name, and Haiku as Claude', () => {
    expect(historyEntry(run, { provider: 'anthropic', model: 'claude-opus-5-5', caseSet: 'held-out' })).toMatchObject({ model: 'Claude 5.5', label: 'Held-out test · 25 cases' });
    expect(historyEntry(run, { provider: 'anthropic', model: 'claude-haiku-5-5' })).toMatchObject({ model: 'Claude' });
    expect(historyEntry(run, { provider: 'custom', model: 'abliterated' })).toMatchObject({ model: 'Abliterated' });
  });

  it('leaves out script runs and models it can not name, and marks unfinished runs partial', () => {
    expect(historyEntry(run, { provider: 'script' })).toBeNull();
    expect(historyEntry(run, { provider: 'openrouter', model: 'some/unknown-model' })).toBeNull();
    const failed = historyEntry({ ...run, status: 'ABORTED' }, { provider: 'custom', model: 'ender', caseSet: 'quick' })!;
    expect(failed.status).toBe('partial');
    expect(parseSavedRecordings([failed])).toHaveLength(1);
  });
});
