import { describe, expect, it } from 'vitest';
import { initialStudioState, recordedStudioHref, requiresRecordedSource, transitionStudio, type StudioScreen } from './model';
import { recordedStartMs } from './data';

describe('buttons crossing live and recorded sources', () => {
  it.each<StudioScreen>(['landing', 'setup', 'single', 'briefing', 'lending'])('%s opens the recorded catalog rather than showing live rows as recordings', screen => {
    expect(requiresRecordedSource(screen)).toBe(true);
  });
  it.each<StudioScreen>(['monitor', 'follow', 'outcome', 'context', 'method', 'compare'])('%s can retain current-world observation', screen => {
    expect(requiresRecordedSource(screen)).toBe(false);
  });
  it('saved evidence links drop live mode and preserve the exact exhibit timestamp', () => {
    const url = new URL(recordedStudioHref('context', 'clearing-charter-v8-admission', 145596, 'details'), 'http://localhost:5180');
    expect(url.searchParams.has('live')).toBe(false);
    expect(url.searchParams.get('run')).toBe('clearing-charter-v8-admission');
    expect(Number(url.searchParams.get('t')) * 1000).toBeCloseTo(145596, 8);
    expect(initialStudioState(url.search).screen).toBe('context');
    expect(initialStudioState(url.search).contextTab).toBe('details');
  });
  it('preserves a recording start of zero instead of dropping it', () => {
    const url = new URL(recordedStudioHref('monitor', 'clearing-reward-v2', 0), 'http://localhost:5180');
    expect(url.searchParams.get('t')).toBe('0');
    expect(initialStudioState(url.search).runId).toBe('clearing-reward-v2');
  });
});

describe('recording switch timestamp precedence', () => {
  const oldUrl = '?replay=/demo/clearing-charter-v6.json.gz&t=12:08';
  it('retains the initial exhibit deep link', () => {
    expect(recordedStartMs(initialStudioState(oldUrl), oldUrl, 1_000_000)).toBe(728_000);
  });
  it('does not carry an old tour timestamp into a different recording', () => {
    let state = transitionStudio(initialStudioState(oldUrl), { type: 'navigate', screen: 'compare', timeMs: 728_000 });
    state = transitionStudio(state, { type: 'select-run', runId: 'clearing-charter-v8-admission' });
    state = transitionStudio(state, { type: 'navigate', screen: 'monitor', timeMs: 145_597 });
    expect(recordedStartMs(state, oldUrl, 1_000_000)).toBe(145_597);
  });
  it('preserves zero as an explicit navigation target', () => {
    let state = transitionStudio(initialStudioState(oldUrl), { type: 'navigate', screen: 'compare' });
    state = transitionStudio(state, { type: 'select-run', runId: 'clearing-reward-v2' });
    state = transitionStudio(state, { type: 'navigate', screen: 'monitor', timeMs: 0 });
    expect(recordedStartMs(state, oldUrl, 1_000_000)).toBe(0);
  });
  it('clamps a deep link to the recording duration', () => {
    const search = '?studio=monitor&t=99999';
    expect(recordedStartMs(initialStudioState(search), search, 1_000)).toBe(1_000);
  });
});
