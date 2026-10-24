import { useEffect, useRef, useState } from 'react';
import type { FinanceFrame, FinanceRecording } from './replay';
import { snapshotRun } from './replay';
import { SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import { CONDITION_NAMES, currentVersion } from './conditions';
import { HEADLINE_VARIANT } from '../../spacetimedb/src/finance/prompt';
import { comparisonKeyFor } from './comparison';

type Worker = { host: string; database: string; models: string[]; cases: string[]; repeat: number; ready: boolean; busy: boolean; version: number; variants: string[]; defaultVariant: string };
const host = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const database = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'endersbench';
const normalize = (url: string) => url.replace('://localhost:', '://127.0.0.1:');

export function RunControls({ data, comparisonKey, connected, onSelect, onReplay }: {
  data: FinanceFrame; comparisonKey?: string; connected: boolean;
  onSelect: (key: string) => void; onReplay: (recording: FinanceRecording) => void;
}) {
  const [worker, setWorker] = useState<Worker>();
  const [error, setError] = useState('');
  const [variant, setVariant] = useState(HEADLINE_VARIANT);
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState<{ scenario: string; variant: string; before: Set<bigint> }>();
  const lock = useRef(false);
  const refresh = async () => {
    try {
      const response = await fetch('/api/finance-control', { headers: { 'X-Finance-Control': '1' } });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Live run controls need the local finance worker.');
      const value = await response.json() as Worker;
      if (normalize(value.host) !== normalize(host) || value.database !== database) throw new Error('The worker is connected to a different database.');
      if (value.version !== currentVersion) throw new Error('The finance worker needs the current benchmark version.');
      setWorker(value); setError('');
    } catch (err) { setWorker(undefined); setError(err instanceof Error ? err.message : String(err)); }
  };
  useEffect(() => { void refresh(); const focus = () => { void refresh(); }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, []);
  useEffect(() => {
    if (!waiting) return;
    const row = data.cases.find(r => !waiting.before.has(r.id) && r.scenarioId === waiting.scenario && r.variant === waiting.variant && worker?.models.includes(r.modelId));
    if (row) { onSelect(comparisonKeyFor(row, data.cases)); setWaiting(undefined); }
  }, [data.cases, waiting, worker, onSelect]);
  const selected = data.cases.find(r => comparisonKeyFor(r, data.cases) === comparisonKey);
  useEffect(() => { setVariant(selected?.benchmarkVersion === currentVersion ? selected.variant : HEADLINE_VARIANT); }, [selected?.variant, selected?.benchmarkVersion, comparisonKey]);
  const activeCase = data.cases.find(r => worker?.models.includes(r.modelId) && r.status !== 'closed');
  const active = !!activeCase;
  const snapshot = comparisonKey ? snapshotRun(data, comparisonKey) : undefined;
  const complete = !!snapshot?.cases.length && snapshot.cases.every(r => r.status === 'closed');
  const nextId = worker?.cases[((worker.cases.indexOf(selected?.scenarioId ?? '') ?? -1) + 1) % worker.cases.length];
  const disabled = !worker?.ready || !connected || sending || !!waiting || active;
  const start = async (scenarioId: string) => {
    if (!worker || lock.current || disabled) return;
    lock.current = true; setSending(true); setError('');
    const before = new Set(data.cases.map(r => r.id));
    try {
      const response = await fetch('/api/finance-control', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Finance-Control': '1' }, body: JSON.stringify({ scenarioId, variant, version: currentVersion, host: worker.host, database }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not start the run.');
      setWaiting({ scenario: scenarioId, variant, before });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSending(false); lock.current = false; }
  };
  return <div className="finance-run-controls" role="group" aria-label="Live run controls">
    <span className="run-status" role="status">{sending || waiting ? 'Starting run…' : activeCase ? comparisonKeyFor(activeCase, data.cases) === comparisonKey ? 'Running · decisions arriving live' : 'Another case is running' : complete ? 'Run complete' : 'Ready for a case'}</span>
    <label className="run-policy-label">New run policy <select aria-label="New run policy" disabled={disabled} value={variant} onChange={e => setVariant(e.target.value)}>{(worker?.variants ?? [HEADLINE_VARIANT]).map(id => <option key={id} value={id}>{CONDITION_NAMES[id] ?? id}</option>)}</select></label>
    <button disabled={disabled || !selected || !worker?.cases.includes(selected.scenarioId)} onClick={() => selected && void start(selected.scenarioId)}>{selected && selected.benchmarkVersion !== currentVersion ? `Run with v${currentVersion}` : 'Run again'}</button>
    <button disabled={disabled || !nextId} title={nextId ? SCENARIO_BY_ID[nextId]?.title : ''} onClick={() => nextId && void start(nextId)}>Next case →</button>
    <button disabled={!complete} onClick={() => snapshot && onReplay(snapshot)}>Replay this run</button>
    {worker && <small>v{worker.version} · Live roster: {worker.models.map(m => m.slice(m.indexOf(':') + 1)).join(', ')}{worker.repeat > 1 ? ` · ${worker.repeat} independent runs per model` : ''}</small>}
    {error && <span className="run-control-error" role="alert">{error} <button onClick={() => void refresh()}>Reconnect controls</button></span>}
  </div>;
}
