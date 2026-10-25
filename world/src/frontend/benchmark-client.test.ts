import { afterEach, describe, expect, it, vi } from 'vitest';
import { benchmarkViewerHref, launchBenchmark, type BenchmarkJob } from './benchmark-client';

afterEach(() => vi.unstubAllGlobals());

describe('fresh benchmark launch contract', () => {
  it.each(['Ender', 'Grok', 'Claude', 'ChatGPT'] as const)('sends selected %s to fresh execution', async model => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'run-1', status: 'starting' }), { status: 202 }));
    vi.stubGlobal('fetch', request);
    await launchBenchmark([{ model, count: 4 }], 'clearing-charter');
    expect(request).toHaveBeenCalledWith('/api/benchmarks', expect.objectContaining({ method: 'POST', body: JSON.stringify({ roster: [{ model, count: 4 }], scenario: 'clearing-charter' }) }));
  });
  it('sends mixed counts and the chosen scenario without a legacy model field', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', request);
    const roster = [{ model: 'ChatGPT' as const, count: 2 }, { model: 'Claude' as const, count: 1 }];
    await launchBenchmark(roster, 'ledger');
    expect(request).toHaveBeenCalledWith('/api/benchmarks', expect.objectContaining({ body: JSON.stringify({ roster, scenario: 'ledger' }) }));
  });
  it('surfaces launch failure without a replay fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Selected model is not configured.' }), { status: 503 })));
    await expect(launchBenchmark([{ model: 'Ender', count: 1 }], 'clearing-charter')).rejects.toThrow('Selected model is not configured.');
  });
  const job: BenchmarkJob = { id: 'abc-123', status: 'running', model: 'Ender', modelId: 'ender:configured', scenario: 'clearing-charter', dbName: 'endersbench-run-abc-123', host: 'ws://localhost:3000' };
  it('opens the new world, without recording parameters', () => {
    const url = new URL(benchmarkViewerHref(job), 'http://localhost');
    expect(url.searchParams.get('legacy')).toBe('1');
    expect(url.searchParams.get('db')).toBe(job.dbName);
    expect(url.searchParams.has('replay')).toBe(false);
    expect(url.searchParams.has('run')).toBe(false);
    expect(url.searchParams.has('studio')).toBe(false);
    expect(benchmarkViewerHref({ ...job, status: 'completed' })).toContain('studio=outcome');
  });
  it('opens the finance viewer only for a supported ledger job', () => {
    expect(benchmarkViewerHref({ ...job, scenario: 'ledger' })).toBe('/finance.html?benchmark=abc-123&db=endersbench-run-abc-123');
    expect(() => benchmarkViewerHref({ ...job, scenario: 'made-up-map' })).toThrow('Unsupported benchmark scenario.');
  });
  it('rejects an unrelated database as a launch destination', () => {
    expect(() => benchmarkViewerHref({ ...job, dbName: 'endersbench' })).toThrow('Invalid benchmark destination');
  });
  it('follows a hosted runner to the page it names, on this site only', () => {
    const hosted = { ...job, id: 'Iq0NkJRlpDU7v1khb', dbName: 'endersbench', viewerHref: '/?legacy=1' };
    expect(benchmarkViewerHref(hosted)).toBe('/?legacy=1');
    expect(benchmarkViewerHref({ ...hosted, scenario: 'ledger', viewerHref: '/finance.html?replay=/api/apify/runs/Iq0NkJRlpDU7v1khb/replay&live=1' })).toContain('/api/apify/runs/');
    for (const elsewhere of ['//evil.test/', 'https://evil.test/', 'javascript:alert(1)', '/a b']) expect(() => benchmarkViewerHref({ ...hosted, viewerHref: elsewhere })).toThrow('Invalid benchmark destination');
  });
});
