import { afterEach, describe, expect, it, vi } from 'vitest';
import { benchmarkViewerHref, launchBenchmark, type BenchmarkJob } from './benchmark-client';

afterEach(() => vi.unstubAllGlobals());

describe('fresh benchmark launch contract', () => {
  it.each(['Ender', 'Grok', 'Claude', 'ChatGPT'] as const)('sends selected %s to fresh execution', async model => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'run-1', status: 'starting' }), { status: 202 }));
    vi.stubGlobal('fetch', request);
    await launchBenchmark(model, 'clearing-charter');
    expect(request).toHaveBeenCalledWith('/api/benchmarks', expect.objectContaining({ method: 'POST', body: JSON.stringify({ model, scenario: 'clearing-charter' }) }));
  });
  it('surfaces launch failure without a replay fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Selected model is not configured.' }), { status: 503 })));
    await expect(launchBenchmark('Ender', 'clearing-charter')).rejects.toThrow('Selected model is not configured.');
  });
  const job: BenchmarkJob = { id: 'abc-123', status: 'running', model: 'Ender', modelId: 'ender:configured', scenario: 'clearing-charter', dbName: 'endersbench-run-abc-123', host: 'ws://localhost:3000' };
  it('opens the new world, without recording parameters', () => {
    const url = new URL(benchmarkViewerHref(job), 'http://localhost');
    expect(url.searchParams.get('live')).toBe('1');
    expect(url.searchParams.get('db')).toBe(job.dbName);
    expect(url.searchParams.has('replay')).toBe(false);
    expect(url.searchParams.has('run')).toBe(false);
    expect(url.searchParams.get('studio')).toBe('monitor');
    expect(benchmarkViewerHref({ ...job, status: 'completed' })).toContain('studio=outcome');
  });
  it('rejects an unrelated database as a launch destination', () => {
    expect(() => benchmarkViewerHref({ ...job, dbName: 'endersbench' })).toThrow('Invalid benchmark destination');
  });
});
