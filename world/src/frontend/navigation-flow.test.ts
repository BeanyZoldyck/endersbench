import { afterEach, describe, expect, it, vi } from 'vitest';
import { benchmarkViewerHref, launchBenchmark, rosterEntries, type BenchmarkJob } from './benchmark-client';
import { initialStudioState, recordedStudioHref, requiresRecordedSource, transitionStudio, type StudioState } from './model';

const job: BenchmarkJob = {
  id: 'fresh-mixed-run', status: 'running', model: 'ChatGPT', modelId: 'configured-chatgpt',
  scenario: 'clearing-charter', dbName: 'endersbench-run-fresh-mixed-run', host: 'ws://localhost:3000',
};

afterEach(() => vi.unstubAllGlobals());

describe('setup and benchmark navigation flow', () => {
  it('retains a mixed lineup and scenario through scenario details and Back', () => {
    let state: StudioState = { ...initialStudioState('?studio=follow&replay=/demo/clearing-reward-v2.json.gz&t=12'), draftRoster: { 'GPT-6 Luna': 4 } };
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'GPT-6 Luna', delta: -1 });
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'GPT-6 Luna', delta: -1 });
    state = transitionStudio(state, { type: 'adjust-draft-count', model: 'Claude 5.5', delta: 1 });
    state = transitionStudio(state, { type: 'select-draft-scenario', scenario: 'ledger' });
    state = transitionStudio(state, { type: 'navigate', screen: 'setup', timeMs: 12_000 });
    state = transitionStudio(state, { type: 'navigate', screen: 'briefing' });
    state = transitionStudio(state, { type: 'back' });
    expect(state).toMatchObject({
      screen: 'setup', draftMode: 'swarm', draftScenario: 'ledger',
      draftRoster: { 'Claude 5.5': 1, 'GPT-6 Luna': 2 }, playing: false,
    });
  });

  it('launches the edited setup rather than the model or scenario from the saved replay', async () => {
    const responseJob = { ...job, status: 'starting' as const, scenario: 'ledger' };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseJob), { status: 202 }));
    vi.stubGlobal('fetch', request);
    let state: StudioState = { ...initialStudioState('?studio=monitor&replay=/demo/clearing-reward-v2.json.gz&t=73'), draftRoster: { 'GPT-6 Luna': 4 } };
    state = transitionStudio(state, { type: 'select-draft-model', model: 'Claude 5.5' });
    state = transitionStudio(state, { type: 'select-draft-scenario', scenario: 'ledger' });
    state = transitionStudio(state, { type: 'navigate', screen: 'setup' });
    const launched = await launchBenchmark(rosterEntries(state.draftRoster), state.draftScenario);
    const [, init] = request.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ roster: [{ model: 'Claude 5.5', count: 4 }], scenario: 'ledger' });
    expect(launched).toEqual(responseJob);
    const destination = new URL(benchmarkViewerHref({ ...launched, status: 'running' }), 'http://localhost');
    expect(destination.pathname).toBe('/finance.html');
    expect(Object.fromEntries(destination.searchParams)).toEqual({ benchmark: job.id, db: job.dbName });
  });

  it.each(['running', 'completed'] as const)('opens the %s Clearing job without old preview or replay state', status => {
    const destination = new URL(benchmarkViewerHref({ ...job, status }), 'http://localhost');
    expect(destination.searchParams.get('benchmark')).toBe(job.id);
    expect(destination.searchParams.get('db')).toBe(job.dbName);
    for (const stale of ['replay', 'run', 't', 'historyModel']) expect(destination.searchParams.has(stale)).toBe(false);
    expect(destination.searchParams.get('studio')).toBe(status === 'completed' ? 'outcome' : null);
  });

  it('returns from a live benchmark to setup through a catalog URL without retaining its database', () => {
    const current = new URL(benchmarkViewerHref({ ...job, status: 'completed' }), 'http://localhost');
    const state = initialStudioState(current.search);
    expect(requiresRecordedSource('setup')).toBe(true);
    const setup = new URL(recordedStudioHref('setup', state.runId), current);
    expect(initialStudioState(setup.search).screen).toBe('setup');
    for (const liveOnly of ['live', 'legacy', 'benchmark', 'db']) expect(setup.searchParams.has(liveOnly)).toBe(false);
  });
});
