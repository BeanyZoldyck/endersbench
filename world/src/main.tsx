import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import Studio from './frontend/ui-ux/Studio.tsx';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from './module_bindings/index.ts';
import './styles.css';

// The clearing is the authoritative viewer; the Observation Studio opens only with ?studio.
// Old ?legacy=1 links still land on the clearing.
const params = new URLSearchParams(window.location.search);
const studio = params.has('studio');
const liveStudio = studio && params.has('live');
// Both views watch the local world unless VITE_SPACETIMEDB_HOST names another (Maincloud: wss://maincloud.spacetimedb.com).
const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'endersbench';
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

const connectionBuilder = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(localStorage.getItem(TOKEN_KEY) || undefined)
  .withAutomaticReconnect()
  .onConnect((_conn, _identity, token) => localStorage.setItem(TOKEN_KEY, token))
  .onConnectError((_ctx, err) => console.error('Error connecting to SpacetimeDB:', err));

if (!studio) document.title = 'The Clearing — Ender’s Bench';
const viewer = studio ? <Studio /> : <App />;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {!studio || liveStudio
      ? <SpacetimeDBProvider connectionBuilder={connectionBuilder}>{viewer}</SpacetimeDBProvider>
      : viewer}
  </StrictMode>
);
