import type { StudioModel } from './model';

export type BenchmarkConfig = {
  ready: boolean;
  reason?: string;
  models: Array<{ id: StudioModel; modelId: string | null; available: boolean; reason?: string }>;
  scenarios: Array<{ id: string; name: string; description: string }>;
};
export type BenchmarkJob = {
  id: string;
  status: 'starting' | 'running' | 'completed' | 'failed';
  model: StudioModel;
  modelId: string;
  scenario: string;
  dbName: string;
  host: string;
  error?: string;
  summary?: string;
  report?: unknown;
};

export function benchmarkViewerHref(job: BenchmarkJob): string {
  if (!/^endersbench-run-[a-z0-9-]+$/.test(job.dbName) || !/^[a-z0-9-]+$/.test(job.id)) throw new Error('Invalid benchmark destination.');
  return `/?${new URLSearchParams({ live: '1', studio: job.status === 'completed' ? 'outcome' : 'monitor', benchmark: job.id, db: job.dbName })}`;
}

export async function benchmarkRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? body.error : 'The benchmark service could not complete this request.');
  }
  return response.json() as Promise<T>;
}

export function launchBenchmark(model: StudioModel, scenario: string): Promise<BenchmarkJob> {
  return benchmarkRequest('/api/benchmarks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, scenario }),
  });
}
