// The harness: a sidecar client that answers the world's decision requests.
// It holds no world state and computes no perception; the module does both.
//
//   npm run harness
//   ROSTER="Ada:fake,Bo:ender:qwen3.8-27b" ENDER_BASE_URL=http://spark:8000/v1 npm run harness

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { DbConnection, tables } from '../src/module_bindings/index.js';
import { brainFor, type Brain, type Tool } from './brains.js';
import { promptVersion, systemPrompt } from './prompt.js';

const HOST = process.env.SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const DB_NAME = process.env.SPACETIMEDB_DB_NAME ?? 'endersbench';
const ROSTER = process.env.ROSTER ?? 'Ada:fake,Bo:fake,Cy:fake,Di:fake';
const PROMPT_VARIANT = process.env.PROMPT_VARIANT ?? 'reward';
const TIME_SCALE = process.env.TIME_SCALE ? Number(process.env.TIME_SCALE) : undefined;
const FOOD_SCALE = process.env.FOOD_SCALE ? Number(process.env.FOOD_SCALE) : undefined;
const ROLE_OFFSET = process.env.ROLE_OFFSET ? Number(process.env.ROLE_OFFSET) : undefined;
const RESCUE_SEATS = process.env.RESCUE_SEATS ? Number(process.env.RESCUE_SEATS) : undefined;
const TIMEOUT_MS = Number(process.env.DECISION_TIMEOUT_MS ?? 20_000);

const here = path.dirname(fileURLToPath(import.meta.url));
// One identity per server and database: a local token is meaningless on Maincloud.
const TOKEN_FILE = path.join(here, '..', `.harness-token-${HOST.replace(/[^a-z0-9]+/gi, '_')}-${DB_NAME}`);

// "Name:provider:model" → { name, modelId: "provider:model" }
function parseRoster(spec: string) {
  return spec
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const sep = entry.indexOf(':');
      if (sep < 0) throw new Error(`roster entry '${entry}' should look like Name:modelId`);
      return { name: entry.slice(0, sep), modelId: entry.slice(sep + 1) };
    });
}

const roster = parseRoster(ROSTER);
const promptOptions = { rescueSeats: RESCUE_SEATS ?? 0 };
const system = systemPrompt(PROMPT_VARIANT, promptOptions);
// Fail at startup, not mid-run, if a roster model has no endpoint or key.
const brains = new Map<string, Brain>(roster.map(r => [r.modelId, brainFor(r.modelId, process.env)]));
const inFlight = new Set<bigint>();

function loadToken() {
  try {
    return fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf-8').trim() : undefined;
  } catch {
    return undefined;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms)),
  ]);
}

async function answer(conn: DbConnection, req: { id: bigint; agentId: bigint; modelId: string; observation: string }) {
  if (inFlight.has(req.id)) return;
  inFlight.add(req.id);
  // Monotonic clock: Date.now() can step backwards when the system clock resyncs.
  const started = performance.now();
  const agent = conn.db.agent.id.find(req.agentId);
  const name = agent?.name ?? `agent ${req.agentId}`;
  try {
    let brain = brains.get(req.modelId);
    if (!brain) {
      // The world routes a request by its survivor's model; one this roster
      // didn't name means the world and the roster disagree, so say so loudly.
      console.warn(`${name}: the world asks for ${req.modelId}, which is not in this roster (${[...new Set(roster.map(r => r.modelId))].join(', ')})`);
      brain = brainFor(req.modelId, process.env);
      brains.set(req.modelId, brain);
    }
    // The module publishes the action catalog; read it fresh so a republish
    // with new actions reaches the models without restarting the harness.
    const toolsRow = conn.db.meta.key.find('tools');
    if (!toolsRow) throw new Error('module has not published its tools yet');
    const tools: Tool[] = JSON.parse(toolsRow.value);
    const decision = await withTimeout(
      brain.decide({ agentName: name, observation: JSON.parse(req.observation), tools, system }),
      TIMEOUT_MS
    );
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    await conn.reducers.submitDecision({
      requestId: req.id,
      action: JSON.stringify(decision.action),
      thought: decision.thought,
      latencyMs,
    });
    console.log(`${name.padEnd(8)} ${String(latencyMs).padStart(5)} ms  ${decision.action.name} ${JSON.stringify(decision.action.args)}  "${decision.thought}"`);
  } catch (err) {
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${name.padEnd(8)} failed after ${latencyMs} ms: ${message}`);
    await conn.reducers.failDecision({ requestId: req.id, error: message, latencyMs }).catch(() => {});
  } finally {
    inFlight.delete(req.id);
  }
}

function onConnect(conn: DbConnection, identity: { toHexString(): string }, token: string) {
  fs.writeFileSync(TOKEN_FILE, token, 'utf-8');
  console.log(`Connected to ${HOST}/${DB_NAME} as ${identity.toHexString().slice(0, 12)}…`);
  void (async () => {
    try {
      await conn.reducers.claimHarness({});
    } catch (err) {
      console.error('This world belongs to another harness. Delete the token file only if you mean to take it over.', err);
      process.exit(1);
    }
    for (const r of roster) {
      await conn.reducers.spawnAgent({ name: r.name, modelId: r.modelId });
    }
    // A scarcity sweep or role rotation reseeds the clearing, then starts the
    // run from time zero with this roster.
    if (FOOD_SCALE !== undefined || ROLE_OFFSET !== undefined || RESCUE_SEATS !== undefined) {
      await conn.reducers.configureScenario({ foodScale: FOOD_SCALE ?? 1, roleOffset: ROLE_OFFSET ?? 0, rescueSeats: RESCUE_SEATS ?? 0 });
      await conn.reducers.resetExperiment({});
    }
    // Slowing the world gives slow models more game time per decision; it is
    // recorded with the run, never applied silently.
    if (TIME_SCALE !== undefined) await conn.reducers.setTimeScale({ timeScale: TIME_SCALE });
    await conn.reducers.setRunInfo({
      info: JSON.stringify({ promptVariant: PROMPT_VARIANT, promptVersion: promptVersion(promptOptions), systemPrompt: system, roster, timeScale: TIME_SCALE ?? 1, foodScale: FOOD_SCALE ?? 1, roleOffset: ROLE_OFFSET ?? 0, rescueSeats: RESCUE_SEATS ?? 0, startedAt: new Date().toISOString() }),
    });
    console.log(`Roster: ${roster.map(r => `${r.name} (${r.modelId})`).join(', ')} · prompt: ${PROMPT_VARIANT}`);
  })();
}

const conn = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(loadToken())
  .withAutomaticReconnect()
  .onConnect(onConnect)
  .onConnectError((_ctx, err) => {
    console.error(`Could not connect to ${HOST}/${DB_NAME}:`, err);
    process.exit(1);
  })
  .build();

function route(req: { id: bigint; agentId: bigint; modelId: string; observation: string; status: string }) {
  // The dedicated finance worker owns agentId 0 requests. Never duplicate its
  // model calls when the clearing and financial district run together.
  if (req.status !== 'pending' || req.agentId === 0n) return;
  void answer(conn, req);
}
conn.db.decisionRequest.onInsert((_ctx, req) => route(req));

conn
  .subscriptionBuilder()
  .onApplied(() => {
    // Answer anything left pending from before a restart.
    for (const req of conn.db.decisionRequest.iter()) {
      route(req);
    }
  })
  .subscribe([tables.meta, tables.agent, tables.decisionRequest.where(r => r.status.eq('pending'))]);
