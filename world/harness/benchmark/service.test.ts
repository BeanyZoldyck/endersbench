import { describe, expect, it } from 'vitest';
import { BenchmarkService, RequestError } from './service.js';
import type { BenchmarkJob } from './types.js';

const config = async () => ({
  ready: true,
  models: [
    { id: 'ChatGPT' as const, modelId: 'openai:gpt-test', available: true },
    { id: 'Claude' as const, modelId: null, available: false, reason: 'Missing mapping.' },
  ],
});
const tick = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)); };

describe('BenchmarkService', () => {
  it('accepts only configured model and scenario values', async () => {
    const service = new BenchmarkService(config, async () => ({}));
    await expect(service.start({ model: 'fake', scenario: 'clearing-charter' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.start({ model: 'ChatGPT', scenario: '../secret' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.start({ model: 'ChatGPT', scenario: 'clearing-charter', command: 'x' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.start({ model: 'Claude', scenario: 'clearing-charter' })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('isolates fresh jobs and permits only one active run', async () => {
    let finish: ((report: unknown) => void) | undefined;
    let running: (() => void) | undefined;
    const invoked: BenchmarkJob[] = [];
    const service = new BenchmarkService(config, (job, onRunning) => {
      invoked.push(job);
      running = onRunning;
      return new Promise(resolve => { finish = resolve; });
    });
    const first = await service.start({ model: 'ChatGPT', scenario: 'clearing-charter' });
    expect(first.status).toBe('starting');
    expect(first.dbName).toBe(`endersbench-run-${first.id}`);
    await expect(service.start({ model: 'ChatGPT', scenario: 'clearing-charter' })).rejects.toBeInstanceOf(RequestError);
    running?.();
    expect(service.get(first.id)?.status).toBe('running');
    finish?.({ models: [{ meanEthics: 50 }] });
    await tick();
    expect(service.get(first.id)?.status).toBe('completed');
    const second = await service.start({ model: 'ChatGPT', scenario: 'clearing-charter' });
    expect(second.id).not.toBe(first.id);
    expect(second.dbName).not.toBe(first.dbName);
    expect(invoked).toHaveLength(2);
    finish?.({});
    await tick();
  });

  it('marks executor failure without producing a score', async () => {
    const service = new BenchmarkService(config, async () => { throw new Error('provider secret detail'); });
    const job = await service.start({ model: 'ChatGPT', scenario: 'clearing-charter' });
    await tick();
    expect(service.get(job.id)).toMatchObject({ status: 'failed', error: 'Benchmark failed. Check the local runner logs.' });
    expect(JSON.stringify(service.get(job.id))).not.toContain('provider secret detail');
    expect(service.get(job.id)?.report).toBeUndefined();
  });

  it('serializes concurrent starts across asynchronous readiness checks', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const service = new BenchmarkService(async () => { await gate; return config(); }, async () => new Promise(() => undefined));
    const input = { model: 'ChatGPT', scenario: 'clearing-charter' };
    const first = service.start(input);
    const second = service.start(input);
    release?.();
    const results = await Promise.allSettled([first, second]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });
});
