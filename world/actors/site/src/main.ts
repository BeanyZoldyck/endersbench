// The Ender's Bench site as an Apify Actor. One long run serves the whole
// viewer (Observation Studio, the Clearing, Ledger Street) from its container
// URL, which needs no token, and starts Ender's Bench runs for visitors with
// the API token Apify gives every run. The token and the model keys stay in
// here; the browser sees only the names in publicConfig.
//
//   GET  /api/apify/config            what a visitor may run, plus recent runs
//   POST /api/apify/runs              start a run: { model, variant, caseSet }
//   GET  /api/apify/runs/:id          one run's status
//   GET  /api/apify/runs/:id/replay   its Ledger Street recording so far
//
// and, for the setup page's "Start a benchmark" (the local runner's routes):
//
//   GET  /api/benchmarks/config       the lobby models on offer and the two scenarios
//   POST /api/benchmarks              { roster, scenario }: a Clearing run on Maincloud or a Ledger Street Actor run
//   GET  /api/benchmarks/:id          that run's status and where to watch it
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Actor, log } from 'apify';
import type { SelectableModel } from '../../../shared/models';
import { serve } from '../../shared/serve';
import { CLEARING, LEDGER, clearingRoster, episodeVerdict, lobbyConfig, spacetimeClient, type LineupEntry } from './clearing';
import { PasswordGuard, RequestError, RunLimiter, benchInput, publicConfig, siteConfig } from './runs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_REPLAY = '/replays/finance-v6-live-crs-script.json';
const DONE = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);

await Actor.init();
let cfg: ReturnType<typeof siteConfig>;
try {
  cfg = siteConfig(await Actor.getInput());
} catch (err) {
  await Actor.fail(`Site input: ${err instanceof Error ? err.message : String(err)}`);
  throw err;
}

const client = Actor.newClient();
const benchName = cfg.benchActor || `${(await client.user('me').get()).username}/enders-bench`;
const bench = await client.actor(benchName).get();
if (!bench) {
  await Actor.fail(`No Actor called ${benchName}. Push actors/enders-bench first, or set benchActor in the site's input.`);
  throw new Error('bench Actor missing');
}
const limiter = new RunLimiter(cfg.maxRunsPerHour);
const password = new PasswordGuard(cfg.runPassword);
const header = (req: IncomingMessage, name: string) => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};
// Apify's proxy puts the visitor first in X-Forwarded-For.
const addressOf = (req: IncomingMessage) => (header(req, 'x-forwarded-for') ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
const labels = new Map<string, string>();

// The shared world on Maincloud, with an identity that may run it.
let spacetime = cfg.spacetime ? spacetimeClient(cfg.spacetime.host, cfg.spacetime.database, cfg.spacetime.token) : null;
if (spacetime) {
  try {
    await spacetime.sql('SELECT running FROM world');
    // claim_harness trusts the first caller on a fresh world; take the slot so a stranger can't.
    await spacetime.call('claim_harness', []);
  } catch (err) {
    log.warning(`SpacetimeDB ${cfg.spacetime!.database}: ${err instanceof Error ? err.message : String(err)}. The setup page won't offer the Clearing.`);
    spacetime = null;
  }
}

interface RunInfo {
  runId: string;
  label: string;
  status: string;
  statusMessage: string;
  startedAt: string;
  finishedAt: string | null;
  replayUrl: string;
  storeId: string;
}

// Short caches, so a room full of viewers polling doesn't become a room full of API calls.
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ms: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Runs started from the Console or the API show up too; their label comes from their input.
async function labelFor(runId: string, storeId: string) {
  if (labels.has(runId)) return labels.get(runId)!;
  const input = (await client.keyValueStore(storeId).getRecord('INPUT'))?.value as { provider?: string; model?: string } | undefined;
  const label = !input?.provider || input.provider === 'script' ? 'Policy reference script' : `${input.provider}:${input.model ?? ''}`;
  labels.set(runId, label);
  return label;
}

async function runInfo(runId: string): Promise<RunInfo | null> {
  return cached(`run:${runId}`, 3000, async () => {
    const run = await client.run(runId).get();
    if (!run || run.actId !== bench!.id) return null;
    return {
      runId: run.id,
      label: await labelFor(run.id, run.defaultKeyValueStoreId),
      status: run.status,
      statusMessage: run.statusMessage ?? '',
      startedAt: new Date(run.startedAt).toISOString(),
      finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
      replayUrl: `/api/apify/runs/${run.id}/replay`,
      storeId: run.defaultKeyValueStoreId,
    };
  });
}

async function recentRuns(): Promise<RunInfo[]> {
  return cached('recent', 5000, async () => {
    const list = await client.actor(bench!.id).runs().list({ desc: true, limit: 8 });
    const infos = await Promise.all(list.items.map(r => runInfo(r.id)));
    return infos.filter((r): r is RunInfo => r !== null);
  });
}

const visible = ({ storeId: _storeId, ...rest }: RunInfo) => rest;

async function replay(runId: string) {
  const info = await runInfo(runId);
  if (!info) throw new RequestError('No such Ender’s Bench run.', 404);
  const record = await cached(`replay:${runId}`, 2000, async () => (await client.keyValueStore(info.storeId).getRecord('REPLAY'))?.value as Record<string, unknown> | undefined);
  const finished = DONE.has(info.status);
  if (!record) {
    return { version: 1, source: `Apify run ${runId} · ${info.label} · ${finished ? info.status.toLowerCase() : 'starting'}`, recordedAt: info.startedAt, timing: 'paced', stepMs: 2200, cases: [], steps: [], verdicts: [], inProgress: !finished, progress: { done: 0, total: 0 } };
  }
  // A run that stopped mid-way leaves an in-progress recording; stop the viewer polling it.
  return finished ? { ...record, inProgress: false } : record;
}

// Ledger Street without a recording opens the newest run, so Run on Apify is one click away.
async function newestLedger() {
  const newest = (await recentRuns().catch(() => [])).find(r => r.status !== 'FAILED' && r.status !== 'ABORTED');
  return newest ? `/finance.html?replay=${newest.replayUrl}&live=1` : `/finance.html?replay=${FALLBACK_REPLAY}`;
}

// One enders-bench run at a time and a few an hour, from Run on Apify or the setup page.
async function startBenchRun(request: ReturnType<typeof benchInput>) {
  cache.delete('recent');
  const active = (await recentRuns()).find(r => !DONE.has(r.status));
  if (active) throw new RequestError(`A run is already going (${active.label}). Watch it, or try again when it ends.`, 409);
  const limited = limiter.check();
  if (limited) throw new RequestError(limited, 429);
  const run = await client.actor(bench!.id).start(request.input, { memory: cfg.benchMemoryMbytes, timeout: cfg.benchTimeoutSecs });
  limiter.record();
  labels.set(run.id, request.label);
  cache.delete('recent');
  log.info(`Started ${run.id}: ${request.label} · ${request.input.variant} · ${request.input.caseSet}`);
  return run.id;
}

// A run started from the setup page, in the shape src/frontend/useBenchmark.ts polls.
interface LobbyJob {
  id: string;
  status: 'starting' | 'running' | 'completed' | 'failed';
  model: string;
  modelId: string;
  scenario: string;
  roster: (LineupEntry & { modelId: string })[];
  dbName: string;
  host: string;
  viewerHref: string;
  summary?: string;
  error?: string;
  runId?: string;
}
const jobs = new Map<string, LobbyJob>();
const clearingLimiter = new RunLimiter(cfg.clearingRunsPerHour);
let clearingJob: LobbyJob | null = null;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const offered = (model: string) => cfg.lobby.get(model as SelectableModel);

async function startClearing(lineup: LineupEntry[]): Promise<LobbyJob> {
  if (!spacetime || !cfg.spacetime) throw new RequestError('This site has no SpacetimeDB login, so it can’t start Clearing runs.');
  let roster: ReturnType<typeof clearingRoster>;
  try {
    roster = clearingRoster(cfg.lobby, lineup);
  } catch (err) {
    throw new RequestError(err instanceof Error ? err.message : String(err));
  }
  if (clearingJob && clearingJob.status !== 'completed' && clearingJob.status !== 'failed') throw new RequestError('A Clearing run is going. Watch it, or start one when it ends.', 409);
  const limited = clearingLimiter.check();
  if (limited) throw new RequestError(limited, 429);
  // Held as starting before begin_run, so the minute's adoption check can't take it for a stranger's episode.
  const job: LobbyJob = {
    id: `clearing-${Date.now().toString(36)}`, status: 'starting', model: lineup[0].model, modelId: roster[0].model_id, scenario: CLEARING,
    roster: lineup.map(e => ({ ...e, modelId: offered(e.model)!.databaseId })), dbName: cfg.spacetime.database, host: cfg.spacetime.host, viewerHref: '/?legacy=1',
  };
  clearingJob = job;
  try {
    // begin_run resets the shared world, so never over someone's live episode.
    const [world] = await spacetime.sql('SELECT running FROM world');
    if (world?.running === true) throw new RequestError('The Clearing is live right now. Watch it, or start one when it ends.', 409);
    await spacetime.call('begin_run', [roster, 'charter', 1, 0, 0, cfg.clearingTimeScale]);
  } catch (err) {
    job.status = 'failed';
    throw err;
  }
  clearingLimiter.record();
  job.status = 'running';
  jobs.set(job.id, job);
  log.info(`Clearing run ${job.id} on ${cfg.spacetime.database}: ${roster.map(r => `${r.name}=${r.model_id}`).join(', ')}`);
  void watchClearing(job);
  return job;
}

// Pauses the world when the episode ends, as scripts/db-run.sh does: with no
// one watching, a missed plane would keep the models (and the bill) going.
async function watchClearing(job: LobbyJob) {
  const db = spacetime!;
  const started = Date.now();
  let errors = 0;
  const finish = async (status: 'completed' | 'failed', note: string) => {
    try {
      await db.call('set_running', [false]);
    } catch (err) {
      log.warning(`pausing after ${job.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    job.status = status;
    if (status === 'failed') job.error = note;
    else job.summary = note;
    log.info(`Clearing run ${job.id} ${status}: ${note}`);
  };
  while (job.status === 'running') {
    await sleep(15_000);
    try {
      const [world] = await db.sql('SELECT rescue_state, game_time_ms, running FROM world');
      if (world?.running === false) {
        job.status = 'completed';
        job.summary = 'The world was paused.';
        return;
      }
      const alive = (await db.sql("SELECT name FROM agent WHERE alive = true AND kind = 'llm'")).length;
      const streaks = (await db.sql('SELECT failing_in_a_row FROM model_health')).map(r => Number(r.failing_in_a_row));
      const state = { gameTimeMs: Number(world?.game_time_ms ?? 0), rescueState: String(world?.rescue_state ?? 'waiting'), alive, streaks };
      errors = 0;
      const verdict = episodeVerdict(state);
      if (verdict === 'failing') return await finish('failed', 'Every model kept failing, so the world was paused.');
      if (verdict === 'done') return await finish('completed', `Rescue ${state.rescueState} · ${alive} model survivor${alive === 1 ? '' : 's'} alive.`);
      if (Date.now() - started > cfg.clearingMaxMinutes * 60_000) return await finish('completed', `Stopped after ${cfg.clearingMaxMinutes} minutes.`);
    } catch (err) {
      log.warning(`watching ${job.id}: ${err instanceof Error ? err.message : String(err)}`);
      if (++errors >= 8) return await finish('failed', 'Lost touch with SpacetimeDB, so the world was paused.');
    }
  }
}

// No episode runs unwatched, whoever started it (scripts/db-run.sh, or this
// site before a restart): a running world with no watcher is adopted and
// paused by the same rules.
async function adoptRunningWorld() {
  if (!spacetime || !cfg.spacetime || clearingJob?.status === 'running' || clearingJob?.status === 'starting') return;
  try {
    const [world] = await spacetime.sql('SELECT running FROM world');
    if (world?.running !== true) return;
    const ids = (await spacetime.sql("SELECT model_id FROM agent WHERE kind = 'llm'")).map(r => String(r.model_id));
    const job: LobbyJob = {
      id: `clearing-${Date.now().toString(36)}`, status: 'running', model: ids[0] ?? '', modelId: ids[0] ?? '', scenario: CLEARING,
      roster: [], dbName: cfg.spacetime.database, host: cfg.spacetime.host, viewerHref: '/?legacy=1',
    };
    jobs.set(job.id, job);
    clearingJob = job;
    log.info(`Watching a Clearing episode already running on ${cfg.spacetime.database} (${ids.join(', ')}) as ${job.id}.`);
    void watchClearing(job);
  } catch (err) {
    log.warning(`checking the world: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function startLedger(lineup: LineupEntry[]): Promise<LobbyJob> {
  const names = [...new Set(lineup.map(e => e.model))];
  if (names.length !== 1) throw new RequestError('On this site Ledger Street runs one model at a time. Pick a single model.');
  const model = offered(names[0]) ?? (() => { throw new RequestError(`${names[0]} is not offered on this site.`); })();
  const runId = await startBenchRun(benchInput(cfg, { model: model.siteId, caseSet: 'quick' }));
  const job: LobbyJob = {
    id: runId, status: 'running', model: names[0], modelId: model.databaseId, scenario: LEDGER, roster: lineup.map(e => ({ ...e, modelId: model.databaseId })),
    dbName: 'apify', host: 'apify', viewerHref: `/finance.html?replay=/api/apify/runs/${runId}/replay&live=1`, runId,
  };
  jobs.set(job.id, job);
  return job;
}

async function lobbyJob(id: string) {
  const job = jobs.get(id);
  if (!job) throw new RequestError('Benchmark not found.', 404);
  if (job.runId && job.status === 'running') {
    const info = await runInfo(job.runId);
    if (info?.status === 'SUCCEEDED') Object.assign(job, { status: 'completed', summary: info.statusMessage });
    else if (info && DONE.has(info.status)) Object.assign(job, { status: 'failed', error: info.statusMessage || `The run ${info.status.toLowerCase()}.` });
  }
  return job;
}

// The setup page asks every few seconds whether a run is going, and offers to
// continue it. The shared world is one: an episode started elsewhere
// (scripts/db-run.sh) is offered too, so visitors watch it instead of waiting.
async function lobbyJobs(): Promise<LobbyJob[]> {
  const list = [...jobs.values()];
  await Promise.all(list.filter(j => j.runId && j.status === 'running').map(j => lobbyJob(j.id)));
  if (list.some(j => j.scenario === CLEARING && j.status === 'running')) return list;
  // Started since the last minute's check: adopt it now, so it shows and is watched.
  await cached('adopt', 4000, async () => { await adoptRunningWorld(); return true; });
  return [...jobs.values()];
}

function lineupFrom(body: string): { lineup: LineupEntry[]; scenario: string } {
  const request = JSON.parse(body || '{}') as { roster?: unknown; scenario?: unknown };
  const roster = Array.isArray(request.roster) ? request.roster : [];
  const lineup = roster.map(e => ({ model: String((e as LineupEntry)?.model ?? ''), count: Number((e as LineupEntry)?.count) })).filter(e => e.count !== 0);
  return { lineup, scenario: String(request.scenario ?? '') };
}

const port = Number(process.env.ACTOR_WEB_SERVER_PORT ?? 4321);
await serve({
  port,
  root: path.join(here, 'viewer'),
  log: message => log.warning(message),
  route: async (req, url, body) => {
    try {
      // The landing page is home; every other view is a query on / and loads as it is.
      if (url.pathname === '/' && !url.search) return { redirect: '/?studio=landing' };
      if (url.pathname === '/finance.html' && !url.searchParams.has('replay')) return { redirect: await newestLedger() };
      if (url.pathname === '/api/benchmarks/config' && req.method === 'GET') return { json: { ...lobbyConfig(cfg.lobby, { clearing: !!spacetime }), passwordRequired: password.required } };
      if (url.pathname === '/api/benchmarks' && req.method === 'GET') return { json: await lobbyJobs() };
      if (url.pathname === '/api/benchmarks' && req.method === 'POST') {
        // JSON from another site's page needs a CORS preflight, which this server never grants.
        if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new RequestError('Expected application/json.', 415);
        password.check(header(req, 'x-run-password'), addressOf(req));
        const { lineup, scenario } = lineupFrom(body);
        if (scenario === CLEARING) return { status: 202, json: await startClearing(lineup) };
        if (scenario === LEDGER) return { status: 202, json: await startLedger(lineup) };
        throw new RequestError('Choose a supported scenario.');
      }
      const lobby = url.pathname.match(/^\/api\/benchmarks\/([A-Za-z0-9-]+)$/);
      if (lobby && req.method === 'GET' && lobby[1] !== 'history') return { json: await lobbyJob(lobby[1]) };
      if (!url.pathname.startsWith('/api/apify/')) return url.pathname.startsWith('/api/') ? { status: 404, json: { error: 'Route not found.' } } : undefined;
      if (url.pathname === '/api/apify/config' && req.method === 'GET') {
        const recent = await recentRuns();
        return { json: { ...publicConfig(cfg), benchActor: benchName, active: recent.find(r => !DONE.has(r.status)) ?? null, recent: recent.map(visible), passwordRequired: password.required } };
      }
      if (url.pathname === '/api/apify/runs' && req.method === 'POST') {
        // A custom header forces a preflight, so another site's page can't press Run for a visitor.
        if (req.headers['x-enders-bench'] !== '1') throw new RequestError('Use the Ender’s Bench viewer to start runs.', 403);
        password.check(header(req, 'x-run-password'), addressOf(req));
        const runId = await startBenchRun(benchInput(cfg, JSON.parse(body || '{}')));
        return { status: 201, json: { runId, replayUrl: `/api/apify/runs/${runId}/replay` } };
      }
      const match = url.pathname.match(/^\/api\/apify\/runs\/([A-Za-z0-9]+)(\/replay)?$/);
      if (match && req.method === 'GET') {
        if (match[2]) return { json: await replay(match[1]) };
        const info = await runInfo(match[1]);
        if (!info) throw new RequestError('No such Ender’s Bench run.', 404);
        return { json: visible(info) };
      }
      throw new RequestError('Not found', 404);
    } catch (err) {
      if (err instanceof RequestError) return { status: err.status, json: { error: err.message, ...(err.status === 401 ? { passwordRequired: true } : {}) } };
      if (err instanceof SyntaxError) return { status: 400, json: { error: 'Send JSON.' } };
      log.warning(`api ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
      const which = url.pathname.startsWith('/api/benchmarks') ? 'The benchmark service' : 'Apify';
      return { status: 502, json: { error: `${which} did not answer. Try again in a moment.` } };
    }
  },
});

await adoptRunningWorld();
setInterval(() => void adoptRunningWorld(), 60_000);

const where = process.env.ACTOR_WEB_SERVER_URL ?? `http://localhost:${port}`;
log.info(`Ender's Bench site: ${where}/ · starts runs of ${benchName} · models: ${cfg.models.map(m => m.label).join(', ')}`);
await Actor.setStatusMessage(`Serving ${where}/ · runs ${benchName}`);
// The server keeps the run alive until its timeout or an abort.
