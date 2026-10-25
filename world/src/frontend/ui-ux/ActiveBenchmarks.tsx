import { useEffect, useState } from 'react';
import { benchmarkRequest, type BenchmarkJob } from '../benchmark-client';

export function activeBenchmark(jobs: BenchmarkJob[]): BenchmarkJob | null {
  return jobs.find(job => job.status === 'running' || job.status === 'starting') ?? null;
}

export function useActiveBenchmark() {
  const [jobs, setJobs] = useState<BenchmarkJob[]>([]);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(): Promise<void> {
      try {
        const next = await benchmarkRequest<BenchmarkJob[]>('/api/benchmarks');
        if (cancelled) return;
        setJobs(next);
        setChecked(true);
        setError('');
      } catch {
        if (cancelled) return;
        setError('Unable to check running benchmarks. Reconnecting…');
      }
      timer = setTimeout(() => { void poll(); }, 3000);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  return { job: activeBenchmark(jobs), error, checked };
}
