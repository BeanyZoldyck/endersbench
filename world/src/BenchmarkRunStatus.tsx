import { useBenchmark } from './frontend/useBenchmark';

/** Compact runner state in the existing viewer header. */
export function BenchmarkRunStatus() {
  const benchmark = useBenchmark(false);
  const job = benchmark.job;
  return <div className="benchmark-inline-status" aria-label="Benchmark run status">
    <span role={benchmark.error ? 'alert' : 'status'}>{benchmark.error || (job?.status === 'completed' ? 'Benchmark complete' : job?.status === 'failed' ? 'Benchmark stopped' : job?.status === 'starting' ? 'Preparing benchmark…' : job ? 'Benchmark running' : 'Checking status…')}</span>
    {job?.status === 'completed' && <a href="/?studio=compare">Results ↗</a>}
  </div>;
}
