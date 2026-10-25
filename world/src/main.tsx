import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { BenchmarkRunStatus } from './BenchmarkRunStatus';
import Studio from './frontend/ui-ux/Studio.tsx';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from './module_bindings/index.ts';
import './styles.css';
import { benchmarkRequest, benchmarkViewerHref, type BenchmarkJob } from './frontend/benchmark-client';

const params = new URLSearchParams(window.location.search);
const legacy = params.has('legacy');
const liveStudio = params.has('live') && !legacy;
// Both views watch the local world unless VITE_SPACETIMEDB_HOST names another (Maincloud: wss://maincloud.spacetimedb.com).
const HOST = params.has('benchmark') ? 'ws://localhost:3000' : import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const requestedDb = params.get('db');
const benchmarkDb = params.has('benchmark') && requestedDb && /^endersbench-run-[a-z0-9-]+$/.test(requestedDb) ? requestedDb : null;
const DB_NAME = benchmarkDb ?? import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'endersbench';
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

const connectionBuilder = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(localStorage.getItem(TOKEN_KEY) || undefined)
  .withAutomaticReconnect()
  .onConnect((_conn, _identity, token) => localStorage.setItem(TOKEN_KEY, token))
  .onConnectError((_ctx, err) => console.error('Error connecting to SpacetimeDB:', err));

if (legacy) document.title = 'The Clearing — Ender’s Bench';
const viewer = legacy ? <><App />{params.has('benchmark') && <BenchmarkRunStatus />}</> : <Studio />;
const root = createRoot(document.getElementById('root')!);
async function mount(): Promise<void> {
  if (params.has('benchmark')) {
    try {
      const job = await benchmarkRequest<BenchmarkJob>(`/api/benchmarks/${encodeURIComponent(params.get('benchmark') ?? '')}`);
      benchmarkViewerHref(job);
      if ((!liveStudio && !legacy) || job.scenario !== 'clearing-charter' || job.dbName !== requestedDb || job.id !== params.get('benchmark')) throw new Error('Mismatched run.');
    } catch {
      root.render(<main><h1>Benchmark unavailable</h1><p>The runner could not verify this run. Reconnect to the local runner and reload.</p><a href="/?studio=setup">Back to models</a></main>);
      return;
    }
  }
  root.render(
  <StrictMode>
    {legacy || liveStudio
      ? <SpacetimeDBProvider connectionBuilder={connectionBuilder}>{viewer}</SpacetimeDBProvider>
      : viewer}
  </StrictMode>
);
}
void mount();
