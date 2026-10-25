import { useEffect, useState } from 'react';
import { benchmarkRequest, benchmarkViewerHref, rosterLabel, type BenchmarkJob } from '../benchmark-client';

export function BenchmarkResumeList({ jobs, error }: { jobs: BenchmarkJob[]; error: string }) {
  if (!jobs.length && !error) return null;
  const active = jobs.filter(job => job.status === 'starting' || job.status === 'running');
  const latestFinished = jobs.find(job => job.status === 'completed' || job.status === 'failed');
  const visible = [...active, ...(latestFinished ? [latestFinished] : [])];
  return <section className="benchmark-resume" aria-label="Your benchmark runs">
    <div><h2>Your benchmark runs</h2><p className="small muted">You can leave this page and return while the runner continues.</p></div>
    {error && <p role="status">{error}</p>}
    {visible.map(job => <div className="benchmark-resume-row" key={job.id}>
      <div><strong>{job.scenario === 'ledger' ? 'Ledger Street' : 'The Clearing'} · {job.roster ? rosterLabel(job.roster) : job.model}</strong><p className="small muted" role="status">{job.status === 'starting' ? 'Preparing the simulation…' : job.status === 'running' ? 'In progress' : job.status === 'completed' ? 'Finished · Results are ready' : 'Stopped · Check run history for captured evidence'}</p></div>
      {job.status === 'running' || job.status === 'completed' ? <a className="outline-button" href={benchmarkViewerHref(job)}>{job.status === 'running' ? 'Resume benchmark ↗' : 'View completed benchmark ↗'}</a> : job.status === 'failed' ? <a className="text-link" href="/?studio=compare">Run history ↗</a> : <span className="small muted">Available when ready</span>}
    </div>)}
  </section>;
}

export function ActiveBenchmarks() {
  const [jobs, setJobs] = useState<BenchmarkJob[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(): Promise<void> {
      try {
        const next = await benchmarkRequest<BenchmarkJob[]>('/api/benchmarks');
        if (cancelled) return;
        setJobs(next);
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
  return <BenchmarkResumeList jobs={jobs} error={error} />;
}
