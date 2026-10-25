import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fetchSavedRecordings, parseSavedRecordings, recordedOutcomeComplete, savedRecordings, type SavedRecording } from './run-history';
import { replayPath, recordedStartMs, runInfo } from './data';
import { initialStudioState, recordedStudioHref, transitionStudio } from './model';
import { RunHistory } from './ui-ux/RunHistory';

const id = '312f917e-9af8-46aa-b7e4-314797605a5f';
const local: SavedRecording = {
  id, model: 'Claude', modelId: 'claude-example', scenario: 'clearing-charter',
  label: 'Claude · saved run', recordedAt: '2026-10-25T01:02:03.000Z',
  durationMs: 12345, status: 'partial', replayUrl: `/api/benchmarks/${id}/replay`,
};

afterEach(() => vi.unstubAllGlobals());

describe('saved benchmark history API', () => {
  it('fetches and validates local records without using a cached response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([local])));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchSavedRecordings()).toEqual([local]);
    expect(fetch).toHaveBeenCalledWith('/api/benchmarks/history', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  });
  it('accepts an empty archive without treating an unavailable service as empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(new Response('unavailable', { status: 503 })));
    expect(await fetchSavedRecordings()).toEqual([]);
    await expect(fetchSavedRecordings()).rejects.toThrow('unavailable');
  });
  it.each([
    { replayUrl: 'https://attacker.invalid/replay' }, { replayUrl: `/api/benchmarks/${id}/replay?other=1` },
    { id: '../../private/file' }, { model: 'Other' }, { scenario: 'lending' },
    { durationMs: -1 }, { durationMs: Infinity }, { status: 'running' }, { recordedAt: 'invalid' },
    { modelId: '' }, { label: '' },
  ])('rejects malformed saved metadata: %o', patch => {
    expect(() => parseSavedRecordings([{ ...local, ...patch }])).toThrow();
  });
  it('rejects malformed and duplicate records without silently calling history empty', () => {
    expect(() => parseSavedRecordings({ recordings: [local] })).toThrow();
    expect(() => parseSavedRecordings([local, local])).toThrow();
    expect(() => parseSavedRecordings([null])).toThrow();
  });
  it('merges the archive newest first and filters/counts both sources', () => {
    const all = savedRecordings('all', [local]);
    expect(all).toHaveLength(8);
    expect(all[0]).toMatchObject({ id, status: 'partial' });
    expect(savedRecordings('Claude', [local])).toHaveLength(1);
    expect(savedRecordings('ChatGPT', [local])).toHaveLength(7);
    expect(savedRecordings('Grok', [local])).toEqual([]);
  });
});

describe('saved replay destinations and outcomes', () => {
  it('routes an archive UUID directly to the API and never to the default recording', () => {
    expect(replayPath(id)).toBe(local.replayUrl);
    expect(replayPath('../../private/file')).toBeNull();
    expect(runInfo(id).label).toBe('Saved benchmark');
    expect(runInfo(id, [local])).toMatchObject({ id, label: local.label, model: 'Claude', modelId: local.modelId, start: 0 });
    expect(runInfo('b226f5d0-a5dc-4f70-8ebf-b1a532762e1c', [local]).label).toBe('Saved benchmark');
  });
  it('survives a fresh deep link and returns to the archive without changing draft model selection', () => {
    const href = recordedStudioHref('monitor', id, 0);
    let state = initialStudioState(new URL(href, 'http://localhost').search);
    expect(state).toMatchObject({ runId: id, screen: 'monitor', draftModel: 'ChatGPT' });
    expect(recordedStartMs(state, href.split('?')[1], local.durationMs)).toBe(0);
    state = transitionStudio(state, { type: 'navigate', screen: 'compare' });
    state = transitionStudio(state, { type: 'history-model', model: 'Claude' });
    state = transitionStudio(state, { type: 'select-run', runId: id });
    state = transitionStudio(state, { type: 'navigate', screen: 'monitor', timeMs: 0 });
    state = transitionStudio(state, { type: 'back', fallback: 'compare' });
    expect(state).toMatchObject({ screen: 'compare', historyModel: 'Claude', draftModel: 'ChatGPT' });
    expect(initialStudioState(`?studio=compare&historyModel=Claude`).historyModel).toBe('Claude');
  });
  it('cannot call partial or metadata-unavailable UUID captures complete even after a rescued frame', () => {
    expect(recordedOutcomeComplete(id, true, local)).toBe(false);
    expect(recordedOutcomeComplete(id, true)).toBe(false);
    expect(recordedOutcomeComplete(id, true, { status: 'completed' })).toBe(true);
    expect(recordedOutcomeComplete(id, false, { status: 'completed' })).toBe(false);
    expect(recordedOutcomeComplete('clearing-charter-v8-admission', true)).toBe(true);
  });
});

describe('archive presentation states', () => {
  const render = (status: 'ready' | 'loading' | 'unavailable', model: 'all' | 'Claude' | 'Grok' = 'all', recordings: SavedRecording[] = []) => renderToStaticMarkup(createElement(RunHistory, { model, onFilter: () => undefined, onOpen: () => undefined, history: { status, recordings, refreshing: false, refresh: () => undefined } }));
  it('shows packaged records and a recovery action during an outage', () => {
    const html = render('unavailable');
    expect(html).toContain('Local history unavailable');
    expect(html).toContain('Fair-share admission');
    expect(html).toContain('Refresh history');
    expect(html).toContain('7<small>saved recordings');
  });
  it('does not call an unchecked model archive empty while loading or unavailable', () => {
    expect(render('loading', 'Grok')).toContain('Checking local recordings for Grok');
    expect(render('unavailable', 'Grok')).toContain('Local history could not be checked');
    expect(render('ready', 'Grok')).toContain('No saved recordings for Grok');
  });
  it('renders partial metadata truthfully and retains the latest known local data on outage', () => {
    const html = render('unavailable', 'Claude', [local]);
    expect(html).toContain('Partial recording');
    expect(html).toContain('claude-example');
    expect(html).toContain('last loaded local recordings');
    expect(html).not.toContain('No saved recordings');
  });
});
