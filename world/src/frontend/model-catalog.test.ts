import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MODEL_CATALOG, exactModelName } from '../../shared/models';
import { BENCHMARK_MODELS, initialStudioState, transitionStudio } from './model';
import { benchmarkRuns } from './catalog';
import { modelAvatarPath, modelDisplayName } from './model-identity';
import { parseSavedRecordings, recordingIdentity, savedRecordings, type SavedRecording } from './run-history';
import { RunHistory } from './ui-ux/RunHistory';
import { BenchmarkLobby } from './ui-ux/BenchmarkLobby';
import type { useRecordingHistory } from './useRecordingHistory';

const variants = [
  ['DeepSeek V4.1 Flash', 'bitdeer:deepseek-ai/DeepSeek-V4.1-Flash'],
  ['GLM 5.3', 'bitdeer:zai-org/GLM-5.3'],
  ['GLM 5.3 Flash', 'bitdeer:zai-org/GLM-5.3-Flash'],
  ['Qwen 3.8 27B', 'openrouter:qwen/qwen3.8-27b'],
  ['Claude 5.5', 'anthropic:claude-opus-5-5'],
  ['GPT-6 Luna', 'codex:gpt-6-luna'],
  ['GPT-6 Sol', 'codex:gpt-6-sol'],
  ['Ender', 'ender:ender'],
] as const;

function recording(index: number, model: SavedRecording['model'], modelId: string): SavedRecording {
  const id = `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
  return { id, model, modelId, label: `Recorded ${model}`, scenario: 'clearing-charter', recordedAt: '2026-10-24T20:00:00Z', durationMs: 1000, status: 'completed', replayUrl: `/api/benchmarks/${id}/replay` };
}

describe('exact benchmark model catalog', () => {
  it('has exactly the eight requested choices and no family-level substitutes', () => {
    expect(BENCHMARK_MODELS).toEqual(variants.map(([name]) => name));
    expect(new Set(MODEL_CATALOG.map(model => model.env)).size).toBe(8);
  });
  it.each(variants)('selects and presents %s without losing its variant', (name, id) => {
    const selected = transitionStudio(initialStudioState(''), { type: 'select-draft-model', model: name });
    expect(selected.draftRoster).toEqual({ [name]: 4 });
    expect(selected.draftModel).toBe(name);
    expect(exactModelName(id)).toBe(name);
    expect(modelDisplayName(id)).toBe(name);
    expect(modelAvatarPath(id)).toMatch(/^\/studio\/avatars\/[^/]+\.png$/);
    expect(initialStudioState(`?historyModel=${encodeURIComponent(name)}`).historyModel).toBe(name);
  });
  it('recognizes no unrelated variants as the requested models', () => {
    for (const id of ['codex:gpt-5.6-luna', 'bitdeer:zai-org/GLM-5.3-Flash-Plus', 'anthropic:claude-haiku-5-5', 'openrouter:qwen/qwen3.8-8b']) expect(exactModelName(id)).toBeNull();
  });
  it('keeps history filters distinct for all eight models, even when a family shares its mascot', () => {
    const rows = variants.map(([name, id], index) => recording(index + 1, name, id));
    expect(parseSavedRecordings(rows)).toEqual(rows);
    for (const [name] of variants) {
      const matches = savedRecordings(name, rows).filter(run => run.status !== 'packaged');
      expect(matches).toEqual([expect.objectContaining({ model: name })]);
      expect(recordingIdentity(matches[0]).label).toBe(name);
    }
  });
  it('finds mixed-roster participants by exact variant', () => {
    const first = recording(1, 'GLM 5.3', variants[1][1]);
    const mixed: SavedRecording = { ...first, roster: [
      { model: 'GLM 5.3', modelId: variants[1][1], count: 1 },
      { model: 'GLM 5.3 Flash', modelId: variants[2][1], count: 1 },
      { model: 'GPT-6 Luna', modelId: variants[5][1], count: 1 },
      { model: 'GPT-6 Sol', modelId: variants[6][1], count: 1 },
    ] };
    const parsed = parseSavedRecordings([mixed]);
    for (const name of ['GLM 5.3', 'GLM 5.3 Flash', 'GPT-6 Luna', 'GPT-6 Sol'] as const) expect(savedRecordings(name, parsed).some(row => row.id === mixed.id)).toBe(true);
    expect(savedRecordings('DeepSeek V4.1 Flash', parsed)).toHaveLength(0);
    expect(recordingIdentity(mixed).label).toBe('1 GLM 5.3 + 1 GLM 5.3 Flash + 1 GPT-6 Luna + 1 GPT-6 Sol');
  });
  it('keeps old data labels intact while discovering exact identities in legacy recordings', () => {
    const legacy = recording(1, 'ChatGPT', 'codex:gpt-6-sol');
    const grok = recording(2, 'Grok', 'openrouter:x-ai/grok-4');
    const parsed = parseSavedRecordings([legacy, grok]);
    expect(parsed[0].model).toBe('ChatGPT');
    expect(parsed[1].model).toBe('Grok');
    expect(savedRecordings('GPT-6 Sol', parsed).map(row => row.id)).toEqual([legacy.id]);
    expect(savedRecordings('GPT-6 Luna', parsed).every(row => row.status === 'packaged')).toBe(true);
    expect(savedRecordings('Grok', parsed).map(row => row.id)).toEqual([grok.id]);
    expect(benchmarkRuns('GPT-6 Luna')).toHaveLength(7);
    expect(benchmarkRuns('GPT-6 Sol')).toHaveLength(0);
  });
  it('renders all eight archive filters and an honest empty state without invented records', () => {
    const history: ReturnType<typeof useRecordingHistory> = { recordings: [], status: 'ready', refreshing: false, refresh: vi.fn() };
    const markup = renderToStaticMarkup(createElement(RunHistory, { history, model: 'GPT-6 Sol', onFilter: vi.fn(), onOpen: vi.fn() }));
    for (const [name] of variants) expect(markup).toContain(name);
    expect(markup).toContain('No saved recordings for GPT-6 Sol.');
    expect(markup).not.toContain('Completed benchmark');
  });
  it('renders exactly eight setup cards and disables unconnected variants independently', () => {
    const config = { ready: true, models: variants.map(([id, modelId]) => ({ id, modelId, available: id === 'GPT-6 Luna' })), scenarios: [{ id: 'clearing-charter', name: 'The Clearing', description: 'Observe.' }] };
    const state = { ...initialStudioState(''), draftRoster: { 'GPT-6 Luna': 1 } };
    const markup = renderToStaticMarkup(createElement(BenchmarkLobby, { state, dispatch: vi.fn(), config, error: '', starting: false, onStart: vi.fn(), onRetry: vi.fn(), onDetails: vi.fn() }));
    expect((markup.match(/class="lineup-model /g) ?? [])).toHaveLength(8);
    for (const [name] of variants) {
      const button = markup.split('<button').map(part => part.split('>')[0]).find(part => part.includes(`aria-label="Add one ${name} agent"`));
      expect(button).toBeDefined();
      expect(button?.includes('disabled')).toBe(name !== 'GPT-6 Luna');
    }
  });
});
