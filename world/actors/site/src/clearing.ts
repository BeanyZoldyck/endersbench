// The setup page's "Start a benchmark" on the hosted site. The page talks to a
// benchmark runner (harness/benchmark/http.ts) that only exists on a laptop, so
// the site answers the same three routes itself: a Clearing lineup becomes a
// database-brained run on the shared world on Maincloud (begin_run, the
// module asks the models), a Ledger Street lineup an enders-bench Actor run
// per agent, watched side by side.
import { MODEL_CATALOG, type SelectableModel } from '../../../shared/models';
import { BENCHMARK_SCENARIOS } from '../../../harness/benchmark/scenarios';
import { DATABASE_PROVIDERS, splitModelId } from '../../../spacetimedb/src/brain/protocol';
import type { SiteModel } from './runs';

export const SURVIVORS = ['Ivy', 'Rook', 'Sage', 'Wren'];
export const CLEARING = 'clearing-charter';
export const LEDGER = 'ledger';

export interface LobbyModel {
  name: SelectableModel;
  siteId: string;
  // The provider:model the setup page shows, and the one the Clearing's
  // database asks; empty when the database can't call this provider (Ledger
  // Street only, like Grok on xAI).
  modelId: string;
  databaseId: string;
}

// Lobby names that were renamed or dropped, so a site run started with an
// older list still starts.
const RENAMED: Record<string, SelectableModel | null> = { Abliterated: 'Retep', 'GLM 5.3 Flash': null };

// models.json entries with a lobby name: which catalog model they are, and the
// provider:model the database's think procedure asks (custom endpoints name
// their database provider, e.g. ender:ender for the fine-tune). A provider the
// database can't call still offers the model for Ledger Street.
export function lobbyModels(models: SiteModel[]): Map<SelectableModel, LobbyModel> {
  const lobby = new Map<SelectableModel, LobbyModel>();
  for (const m of models) {
    if (!m.lobby) continue;
    const renamed = m.lobby in RENAMED ? RENAMED[m.lobby] : m.lobby;
    if (renamed === null) continue;
    const name = MODEL_CATALOG.find(c => c.name === renamed)?.name;
    if (!name) throw new Error(`Model "${m.id}": "${m.lobby}" is not a lobby model. Use one of ${MODEL_CATALOG.map(c => c.name).join(', ')}.`);
    const databaseId = m.database || (m.provider === 'custom' ? '' : `${m.provider}:${m.model}`);
    if (!databaseId) throw new Error(`Model "${m.id}" is a custom endpoint: name the provider:model the database asks in "database".`);
    const askable = DATABASE_PROVIDERS.includes(splitModelId(databaseId).provider);
    lobby.set(name, { name, siteId: m.id, modelId: databaseId, databaseId: askable ? databaseId : '' });
  }
  return lobby;
}

// The local runner's /api/benchmarks/config, for this site.
export function lobbyConfig(lobby: Map<SelectableModel, LobbyModel>, can: { clearing: boolean }) {
  return {
    ready: lobby.size > 0,
    ...(lobby.size ? {} : { reason: 'This site offers no lobby models.' }),
    models: MODEL_CATALOG.map(c => {
      const offered = lobby.get(c.name);
      return offered ? { id: c.name, modelId: offered.modelId, available: true } : { id: c.name, modelId: null, available: false, reason: 'Not offered on this site.' };
    }),
    scenarios: BENCHMARK_SCENARIOS.map(s => s.id === CLEARING
      ? { ...s, description: 'Survivors face scarcity, winter and rescue in the shared world on SpacetimeDB Maincloud; the database asks the models itself.', available: can.clearing, ...(can.clearing ? {} : { reason: 'This site has no SpacetimeDB login.' }) }
      : { ...s, description: 'Up to four agents through the seven-case quick tour side by side, each a run of the enders-bench Apify Actor.' }),
  };
}

export type LineupEntry = { model: string; count: number };

export function clearingRoster(lobby: Map<SelectableModel, LobbyModel>, lineup: LineupEntry[]) {
  const total = lineup.reduce((n, e) => n + (Number.isInteger(e.count) && e.count > 0 ? e.count : Number.NaN), 0);
  if (!lineup.length) throw new Error('Add at least one agent to start.');
  if (!Number.isInteger(total) || total > SURVIVORS.length) throw new Error('Select up to four agents in total.');
  const ids = lineup.flatMap(e => {
    const offered = lobby.get(e.model as SelectableModel);
    if (!offered) throw new Error(`${e.model} is not offered on this site.`);
    if (!offered.databaseId) throw new Error(`${e.model} can't join the Clearing yet: the shared world's database can't call it. Try it in Ledger Street.`);
    return Array.from({ length: e.count }, () => offered.databaseId);
  });
  return ids.map((model_id, i) => ({ name: SURVIVORS[i], model_id }));
}

export interface EpisodeState {
  gameTimeMs: number;
  rescueState: string;
  alive: number;
  streaks: number[];
}

// scripts/db-run.sh's rule: done once thirty game seconds have passed and the
// plane came or left, or every model survivor is dead; failing when every
// model has failed five times in a row (no key, a dead endpoint).
export function episodeVerdict(s: EpisodeState): 'running' | 'done' | 'failing' {
  if (s.streaks.length && s.streaks.every(n => n >= 5)) return 'failing';
  if (s.gameTimeMs > 30_000 && (s.rescueState !== 'waiting' || s.alive === 0)) return 'done';
  return 'running';
}

type SqlAnswer = { schema: { elements: { name: { some?: string } }[] }; rows: unknown[][] }[];

export function parseSqlRows(answer: SqlAnswer): Record<string, unknown>[] {
  const first = answer[0];
  if (!first) return [];
  const names = first.schema.elements.map((e, i) => e.name.some ?? `col${i}`);
  return first.rows.map(row => Object.fromEntries(names.map((n, i) => [n, row[i]])));
}

// Our Runpod workers (Ender, Abliterated) stop after a minute idle and take
// minutes to start (scripts/warm-runpod.sh), longer than a decision may wait.
// A run that uses them waits until each answers before it starts.
export type WarmTarget = { name: string; url: string; model: string };

export function warmTargets(models: SiteModel[], lineup: string[], customBaseUrl: string): WarmTarget[] {
  const targets: WarmTarget[] = [];
  for (const name of new Set(lineup)) {
    const m = models.find(entry => entry.lobby === name && entry.provider === 'custom');
    const url = m?.baseUrl || customBaseUrl;
    if (m?.model && url && !targets.some(t => t.url === url && t.model === m.model)) targets.push({ name, url, model: m.model });
  }
  return targets;
}

// One tiny chat completion; Runpod holds it until a worker is up to answer.
export async function warmEndpoint(target: WarmTarget, key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${target.url.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: target.model, max_tokens: 1, messages: [{ role: 'user', content: 'ready?' }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// SpacetimeDB's HTTP API with an identity that may run the world.
export function spacetimeClient(host: string, database: string, token: string, fetchImpl: typeof fetch = fetch) {
  const base = `${host.replace(/\/+$/, '')}/v1/database/${encodeURIComponent(database)}`;
  async function post(path: string, body: string, contentType: string) {
    const response = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': contentType }, body, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`SpacetimeDB answered ${response.status}: ${text.slice(0, 200)}`);
    return text;
  }
  return {
    call: (reducer: string, args: unknown[]) => post(`/call/${reducer}`, JSON.stringify(args), 'application/json'),
    sql: async (query: string) => parseSqlRows(JSON.parse(await post('/sql', query, 'text/plain')) as SqlAnswer),
  };
}
