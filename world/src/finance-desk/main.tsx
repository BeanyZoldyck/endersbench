import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DeskApp from './DeskApp.tsx';
import ReplayDesk from './ReplayDesk.tsx';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from '../module_bindings';
import { benchmarkRequest, benchmarkViewerHref, type BenchmarkJob } from '../frontend/benchmark-client';
import './desk.css';

const params = new URLSearchParams(window.location.search);
const replayUrl = params.get('replay');
const root = createRoot(document.getElementById('root')!);

async function mount(): Promise<void> {
  let database = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'endersbench';
  let host = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
  if (params.has('benchmark')) {
    try {
      const job = await benchmarkRequest<BenchmarkJob>(`/api/benchmarks/${encodeURIComponent(params.get('benchmark') ?? '')}`);
      benchmarkViewerHref(job);
      if (job.scenario !== 'ledger' || job.id !== params.get('benchmark') || job.dbName !== params.get('db') || replayUrl) throw new Error('Mismatched run.');
      database = job.dbName;
      host = 'ws://localhost:3000';
    } catch {
      root.render(<main><h1>Benchmark unavailable</h1><p>The runner could not verify this Ledger run. Reconnect to the local runner and reload.</p><a href="/?studio=setup">Back to lobby</a></main>);
      return;
    }
  }
  const tokenKey = `${host}/${database}/auth_token`;
  const connectionBuilder = DbConnection.builder().withUri(host).withDatabaseName(database)
    .withToken(localStorage.getItem(tokenKey) || undefined).withAutomaticReconnect()
    .onConnect((_ctx, _identity, token) => localStorage.setItem(tokenKey, token));
  root.render(<StrictMode>{replayUrl ? <ReplayDesk url={replayUrl} live={params.get('live') === '1'} /> : <SpacetimeDBProvider connectionBuilder={connectionBuilder}><DeskApp lineup={params.has('benchmark')} /></SpacetimeDBProvider>}</StrictMode>);
}
void mount();
