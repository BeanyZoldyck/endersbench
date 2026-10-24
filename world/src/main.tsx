import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import Studio from './frontend/ui-ux/Studio.tsx';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from './module_bindings/index.ts';
import './styles.css';

const params = new URLSearchParams(window.location.search);
const legacy = params.has('legacy');
const liveStudio = params.has('live') && !legacy;
const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? (liveStudio ? 'wss://maincloud.spacetimedb.com' : 'ws://localhost:3000');
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'endersbench';
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

const connectionBuilder = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(localStorage.getItem(TOKEN_KEY) || undefined)
  .withAutomaticReconnect()
  .onConnect((_conn, _identity, token) => localStorage.setItem(TOKEN_KEY, token))
  .onConnectError((_ctx, err) => console.error('Error connecting to SpacetimeDB:', err));

if (legacy) document.title = 'The Clearing — Ender’s Bench';
const viewer = legacy ? <App /> : <Studio />;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {legacy || liveStudio
      ? <SpacetimeDBProvider connectionBuilder={connectionBuilder}>{viewer}</SpacetimeDBProvider>
      : viewer}
  </StrictMode>
);
