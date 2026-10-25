import { useEffect, useState } from 'react';
import { CONDITION_NAMES } from './conditions';

// Starts an Ender's Bench run on Apify from the viewer. It appears only where
// the site Actor serves the page and answers /api/apify/config; the site
// holds the keys and offers only the models it was set up with.
type RunInfo = { runId: string; label: string; status: string; statusMessage: string; startedAt: string; finishedAt: string | null; replayUrl: string };
type Config = {
  models: { id: string; label: string }[];
  variants: string[];
  defaultVariant: string;
  caseSets: { id: string; label: string; count: number }[];
  crs: 'live' | 'snapshot';
  benchActor: string;
  active: RunInfo | null;
  recent: RunInfo[];
};

const STATUS: Record<string, string> = { READY: 'starting', RUNNING: 'running', SUCCEEDED: 'done', FAILED: 'failed', 'TIMING-OUT': 'timing out', 'TIMED-OUT': 'timed out', ABORTING: 'stopping', ABORTED: 'stopped' };
const watch = (run: RunInfo) => `/finance.html?replay=${run.replayUrl}&live=1`;
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function ApifyRun({ replayUrl }: { replayUrl?: string }) {
  const [config, setConfig] = useState<Config>();
  const [model, setModel] = useState('');
  const [variant, setVariant] = useState('');
  const [caseSet, setCaseSet] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch('/api/apify/config', { cache: 'no-store' });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
        const value = await response.json() as Config;
        if (stopped) return;
        setConfig(value);
        setModel(m => value.models.some(x => x.id === m) ? m : value.models[0]?.id ?? '');
        setCaseSet(c => value.caseSets.some(x => x.id === c) ? c : value.caseSets[0]?.id ?? '');
        setVariant(v => value.variants.includes(v) ? v : value.defaultVariant);
      } catch { /* not served by the site Actor: stay hidden */ }
    };
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  if (!config) return null;
  const current = config.recent.find(r => r.replayUrl === replayUrl);
  const start = async () => {
    setSending(true); setError('');
    try {
      const response = await fetch('/api/apify/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Enders-Bench': '1' }, body: JSON.stringify({ model, variant, caseSet }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not start the run.');
      window.location.href = `/finance.html?replay=${value.replayUrl}&live=1`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSending(false);
    }
  };
  return <details className="finance-pop run-pop apify-pop">
    <summary>Run on Apify</summary>
    <div className="finance-run-controls" role="group" aria-label="Run on Apify">
      <span className="run-status" role="status">{config.active ? `Running · ${config.active.label}` : 'Start a benchmark run'}</span>
      {current && <small>This recording: {STATUS[current.status] ?? current.status}{current.statusMessage ? ` · ${current.statusMessage}` : ''}</small>}
      <label className="run-policy-label">Agent <select aria-label="Agent" disabled={sending} value={model} onChange={e => setModel(e.target.value)}>{config.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <label className="run-policy-label">Policy <select aria-label="Policy" disabled={sending} value={variant} onChange={e => setVariant(e.target.value)}>{config.variants.map(id => <option key={id} value={id}>{CONDITION_NAMES[id] ?? id}</option>)}</select></label>
      <label className="run-policy-label">Cases <select aria-label="Cases" disabled={sending} value={caseSet} onChange={e => setCaseSet(e.target.value)}>{config.caseSets.map(c => <option key={c.id} value={c.id}>{c.label} · {c.count}</option>)}</select></label>
      <button disabled={sending || !!config.active || !model} onClick={() => void start()}>{sending ? 'Starting the Actor…' : 'Start run'}</button>
      {config.active && config.active.replayUrl !== replayUrl && <a className="apify-link" href={watch(config.active)}>Watch the run in progress →</a>}
      {config.recent.length > 0 && <div className="apify-runs">
        <span className="more-heading">Recent runs</span>
        {config.recent.map(r => <a key={r.runId} href={watch(r)} aria-current={r.replayUrl === replayUrl ? 'page' : undefined}>{r.label} · {STATUS[r.status] ?? r.status} · {time(r.startedAt)}</a>)}
      </div>}
      <small>Each run is a run of the {config.benchActor} Actor on Apify · CRS {config.crs === 'live' ? 'live sandbox' : 'saved snapshot'}</small>
      {error && <span className="run-control-error" role="alert">{error}</span>}
    </div>
  </details>;
}
