import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DeskApp from './DeskApp.tsx';
import ReplayDesk from './ReplayDesk.tsx';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from '../module_bindings';
import './desk.css';

const replayUrl = new URLSearchParams(window.location.search).get('replay');
function LiveDesk() {
  const host = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
  const database = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'endersbench';
  const tokenKey = `${host}/${database}/auth_token`;
  const connectionBuilder = DbConnection.builder().withUri(host).withDatabaseName(database)
    .withToken(localStorage.getItem(tokenKey) || undefined).withAutomaticReconnect()
    .onConnect((_ctx, _identity, token) => localStorage.setItem(tokenKey, token));
  return <SpacetimeDBProvider connectionBuilder={connectionBuilder}><DeskApp /></SpacetimeDBProvider>;
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>{replayUrl ? <ReplayDesk url={replayUrl} /> : <LiveDesk />}</StrictMode>
);
