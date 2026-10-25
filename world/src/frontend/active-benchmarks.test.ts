import { describe, expect, it } from 'vitest';
import { activeBenchmark } from './ui-ux/ActiveBenchmarks';
import { benchmarkViewerHref, type BenchmarkJob } from './benchmark-client';
const job: BenchmarkJob = { id: 'resume-test', dbName: 'endersbench-run-resume-test', scenario: 'clearing-charter', status: 'running', model: 'ChatGPT', modelId: 'example', host: 'localhost' };
describe('continue benchmark action', () => {
  it.each(['clearing-charter', 'ledger'])('continues the existing %s database', scenario => {
    const active = activeBenchmark([{ ...job, scenario }]);
    expect(benchmarkViewerHref(active!)).toContain('benchmark=resume-test');
    expect(benchmarkViewerHref(active!)).toContain('db=endersbench-run-resume-test');
  });
  it('keeps a preparing run active', () => {
    expect(activeBenchmark([{ ...job, status: 'starting' }])?.status).toBe('starting');
  });
  it('returns to start after completion or failure', () => {
    expect(activeBenchmark([{ ...job, status: 'completed' }, { ...job, status: 'failed' }])).toBeNull();
  });
  it('finds an active run even if a newer run is finished', () => {
    expect(activeBenchmark([{ ...job, status: 'completed' }, job])).toEqual(job);
  });
});
