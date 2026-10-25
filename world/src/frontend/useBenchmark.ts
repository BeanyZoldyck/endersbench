import { useCallback, useEffect, useRef, useState } from 'react';
import { benchmarkBlocker, benchmarkRequest, benchmarkViewerHref, launchBenchmark, rosterEntries, type BenchmarkConfig, type BenchmarkJob } from './benchmark-client';
import type { BenchmarkRoster } from './model';

export function useBenchmark(enabled: boolean) {
  const [config, setConfig] = useState<BenchmarkConfig | null>(null);
  const [job, setJob] = useState<BenchmarkJob | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const launching = useRef(false);
  const activeId = new URLSearchParams(window.location.search).get('benchmark');
  const [refresh, setRefresh] = useState(0);
  const retry = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    if (!enabled) { launching.current = false; setStarting(false); return; }
    let cancelled = false;
    setError('');
    void benchmarkRequest<BenchmarkConfig>('/api/benchmarks/config').then(value => {
      if (!cancelled) setConfig(value);
    }).catch(() => {
      if (!cancelled) { setConfig(null); setError('Benchmark runner unavailable. Start the local benchmark service, then retry.'); }
    });
    return () => { cancelled = true; };
  }, [enabled, refresh]);
  const id = activeId ?? job?.id;
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await benchmarkRequest<BenchmarkJob>(`/api/benchmarks/${encodeURIComponent(id)}`);
        if (cancelled) return;
        setJob(next);
        setError(next.status === 'failed' ? next.error || 'Benchmark failed. No completed result was produced.' : '');
        if (!activeId && enabled && launching.current && (next.status === 'running' || next.status === 'completed')) {
          window.location.assign(benchmarkViewerHref(next));
          return;
        }
        if (next.status === 'failed' || next.status === 'completed') {
          setStarting(false); launching.current = false;
          return;
        }
      } catch {
        if (cancelled) return;
        setError('Connection to the benchmark runner was lost. The run may still be active; reconnecting.');
      }
      timer = setTimeout(() => { void poll(); }, 1500);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, activeId, enabled]);
  const start = async (roster: BenchmarkRoster, scenario: string) => {
    if (launching.current) return;
    const blocker = benchmarkBlocker(config, roster, scenario);
    if (blocker) { setError(blocker); return; }
    launching.current = true; setStarting(true); setError('');
    try { setJob(await launchBenchmark(rosterEntries(roster), scenario)); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Benchmark could not start.');
      setStarting(false); launching.current = false;
    }
  };
  return { config, job, error, starting, start, retry };
}
