import { describe, expect, it } from 'vitest';
import { BenchmarkFailure, failureCode, failureFromLine } from './failure';
import { BenchmarkService } from './service';

describe('safe model failures', () => {
  it('classifies expired authentication without returning raw provider output', () => {
    const code = failureCode(new Error('refresh token has expired; sensitive raw diagnostic'));
    const error = failureFromLine(`BENCHMARK_ERROR:${code}`);
    expect(error?.message).toContain('Sign in');
    expect(error?.message).not.toContain('sensitive');
    expect(failureFromLine('BENCHMARK_ERROR:secret')).toBeNull();
  });
  it('keeps authentication failures incomplete with actionable guidance', async () => {
    const service = new BenchmarkService(async () => ({ready:true, models:[{id:'ChatGPT',modelId:'codex:test',available:true}]}), async () => { throw new BenchmarkFailure('provider_auth'); });
    const job = await service.start({model:'ChatGPT',scenario:'clearing-charter'});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(job.status).toBe('failed');
    expect(job.error).toContain('Sign in');
    expect(job.report).toBeUndefined();
  });
});
