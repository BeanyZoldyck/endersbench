import { useBenchmark } from './frontend/useBenchmark';
import { rosterLabel } from './frontend/benchmark-client';

/** Keeps runner failures visible when the simulation itself has stopped updating. */
export function BenchmarkRunStatus() {
  const benchmark = useBenchmark(false);
  const job = benchmark.job;
  return <aside aria-label="Benchmark run status" style={{ position: 'fixed', bottom: 12, left: 12, right: 12, zIndex: 1000, padding: '12px 16px', background: '#171a18', color: '#f4f3ec', border: '1px solid #cdb675', borderRadius: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, font: '14px system-ui' }}>
    <span role={benchmark.error ? 'alert' : 'status'}>{benchmark.error || (job ? `${job.roster ? rosterLabel(job.roster) : job.model} · ${job.status === 'completed' ? 'Benchmark complete' : job.status === 'failed' ? 'Benchmark failed' : 'Benchmark running'}` : 'Checking benchmark status…')}</span>
    {job?.status === 'completed' && job.scenario === 'clearing-charter' && <a style={{ color: '#e3c77d' }} href={`/?live=1&studio=outcome&benchmark=${encodeURIComponent(job.id)}&db=${encodeURIComponent(job.dbName)}`}>View scores</a>}
    <a style={{ color: '#e3c77d' }} href="/?studio=compare">Run history</a>
    <a style={{ color: '#e3c77d' }} href="/?studio=setup">Back to lobby</a>
  </aside>;
}
