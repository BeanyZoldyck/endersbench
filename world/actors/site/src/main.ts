// The Ender's Bench site as an Apify Actor. One long run serves the whole
// viewer (Observation Studio, the Clearing, Ledger Street) from its container
// URL, which needs no token, and starts Ender's Bench runs for visitors with
// the API token Apify gives every run. The token and the model keys stay in
// here; the browser sees only the names in publicConfig.
//
//   GET  /api/apify/config            what a visitor may run, plus recent runs
//   POST /api/apify/runs              start a run: { models: [id, ...] (up to four), variant, caseSet }
//   GET  /api/apify/runs/:ids         a run's status, or a lineup's (run ids joined by commas)
//   GET  /api/apify/runs/:ids/replay  its Ledger Street recording so far, every agent side by side
//
// and, for the setup page's "Start a benchmark" (the local runner's routes):
//
//   GET  /api/benchmarks/config       the lobby models on offer and the two scenarios
//   POST /api/benchmarks              { roster, scenario }: a Clearing run on Maincloud, or Ledger Street Actor runs (one per agent)
//   GET  /api/benchmarks/:id          that run's status and where to watch it
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Actor, log } from 'apify';
import type { SelectableModel } from '../../../shared/models';
import { serve } from '../../shared/serve';
import { CLEARING, LEDGER, clearingRoster, episodeVerdict, lobbyConfig, spacetimeClient, warmEndpoint, warmTargets, type LineupEntry, type WarmTarget } from './clearing';
import { FINANCE_PROMPT_VARIANTS, HEADLINE_VARIANT } from '../../../spacetimedb/src/finance/prompt';
import { CASE_SETS } from '../../enders-bench/src/input';
import { queuedRecording } from '../../enders-bench/src/queued';
import { historyEntry, lineupEntry, type BenchRunInput } from './history';
import { DONE, groupRuns, lineupIds, lineupSummary, mergeRecordings, replayPath, roomLine, type Recording, type Slots } from './lineup';
import { PasswordGuard, RequestError, RunLimiter, lineupInputs, publicConfig, siteConfig } from './runs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_REPLAY = '/replays/finance-v6-live-crs-script.json';

await Actor.init();
let cfg: ReturnType<typeof siteConfig>;
try {
  const bundledModels = path.join(here, 'models.json');
  cfg = siteConfig(await Actor.getInput(), fs.existsSync(bundledModels) ? JSON.parse(fs.readFileSync(bundledModels, 'utf-8')) : []);
  if (cfg.skipped.length) log.warning(`Not offering ${cfg.skipped.join(', ')}.`);
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
// A run's input names its agent and cases (its secret fields stay encrypted in storage).
const inputs = new Map<string, BenchRunInput>();
async function runInput(runId: string, storeId: string): Promise<BenchRunInput> {
  if (!inputs.has(runId)) inputs.set(runId, ((await client.keyValueStore(storeId).getRecord('INPUT'))?.value ?? {}) as BenchRunInput);
  return inputs.get(runId)!;
}

async function labelFor(runId: string, storeId: string) {
  if (labels.has(runId)) return labels.get(runId)!;
  const input = await runInput(runId, storeId);
  const label = !input?.provider || input.provider === 'script' ? 'Policy reference script' : `${input.provider}:${input.model ?? ''}`;
  labels.set(runId, label);
  return label;
}

// Ledger Street lineups: the bench runs started together, one per agent. Kept
// in a named store too, so a restarted or migrated site still groups them.
const lineupStore = await Actor.openKeyValueStore('endersbench-site');
const lineups = new Map<string, string[]>(); // run id -> every run id in its lineup
for (const ids of (await lineupStore.getValue<string[][]>('LINEUPS').catch(() => null)) ?? []) for (const id of ids) lineups.set(id, ids);
async function rememberLineup(ids: string[]) {
  for (const id of ids) lineups.set(id, ids);
  // The newest hundred lineups are plenty for the history the site lists.
  await lineupStore.setValue('LINEUPS', [...new Set(lineups.values())].slice(-100));
}
const lineupOf = (runId: string) => lineups.get(runId);

// Run history: every enders-bench model run, newest first, as a Ledger Street
// recording; a lineup's runs are one recording.
const historyRuns = new Map<string, string>(); // uuid -> Apify run id, or a lineup's ids joined by commas
async function runHistory() {
  return cached('history', 15_000, async () => {
    const list = await client.actor(bench!.id).runs().list({ desc: true, limit: 40 });
    const entries = await Promise.all(list.items.filter(r => r.status !== 'READY').map(async r => ({ runId: r.id, entry: historyEntry(r, await runInput(r.id, r.defaultKeyValueStoreId)) })));
    const out: NonNullable<ReturnType<typeof historyEntry>>[] = [];
    const seen = new Set<string>();
    for (const { runId, entry } of entries) {
      const ids = lineupOf(runId);
      if (!ids) {
        if (entry) {
          historyRuns.set(entry.id, runId);
          out.push(entry);
        }
        continue;
      }
      if (seen.has(ids.join(','))) continue;
      seen.add(ids.join(','));
      const members = ids.flatMap(id => entries.find(e => e.runId === id)?.entry ?? []);
      if (!members.length) continue;
      const combined = lineupEntry(ids, members);
      historyRuns.set(combined.id, ids.join(','));
      out.push(combined);
    }
    return out;
  });
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
      replayUrl: replayPath([run.id]),
      storeId: run.defaultKeyValueStoreId,
    };
  });
}

type Shown = Omit<RunInfo, 'storeId'>;
const visible = ({ storeId: _storeId, ...rest }: RunInfo): Shown => rest;

// Newest first, a lineup as one entry.
async function recentRuns(): Promise<Shown[]> {
  return cached('recent', 5000, async () => {
    const list = await client.actor(bench!.id).runs().list({ desc: true, limit: 12 });
    const infos = (await Promise.all(list.items.map(r => runInfo(r.id)))).filter((r): r is RunInfo => r !== null);
    return groupRuns(infos.map(visible), lineupOf).slice(0, 8);
  });
}

async function runsOf(ids: string[]): Promise<RunInfo[]> {
  const infos = await Promise.all(ids.map(runInfo));
  if (infos.some(i => i === null)) throw new RequestError('No such Ender’s Bench run.', 404);
  return infos as RunInfo[];
}

async function statusOf(ids: string[]): Promise<Shown> {
  const infos = (await runsOf(ids)).map(visible);
  return ids.length === 1 ? infos[0] : lineupSummary(ids, infos);
}

// One run's recording so far. Before the run writes its own, the offices are
// staffed from its input, every case queued, so the page never opens empty.
async function runReplay(info: RunInfo): Promise<Recording> {
  const record = await cached(`replay:${info.runId}`, 2000, async () => (await client.keyValueStore(info.storeId).getRecord('REPLAY'))?.value as Recording | undefined);
  const finished = DONE.has(info.status);
  if (!record) {
    const source = `Apify run ${info.runId} · ${info.label} · ${finished ? info.status.toLowerCase() : 'starting'}`;
    if (finished) return { version: 1, source, recordedAt: info.startedAt, timing: 'paced', stepMs: 2200, cases: [], steps: [], verdicts: [], inProgress: false, progress: { done: 0, total: 0 } };
    const input = await runInput(info.runId, info.storeId);
    const caseIds = input.caseSet === 'custom' ? input.caseIds ?? [] : CASE_SETS[input.caseSet ?? 'held-out']?.ids() ?? [];
    const agent = !input.provider || input.provider === 'script' ? 'script:policy' : `${input.provider}:${input.model ?? ''}`;
    const variant = input.variant && FINANCE_PROMPT_VARIANTS.includes(input.variant) ? input.variant : HEADLINE_VARIANT;
    return queuedRecording({ agent, variant, caseIds: [...new Set(caseIds)], repeat: Number(input.repeat) || 1 }, source, info.startedAt) as Recording;
  }
  // A run that stopped mid-way leaves an in-progress recording; stop the viewer polling it.
  return finished ? { ...record, inProgress: false } : record;
}

async function replay(ids: string[]) {
  const infos = await runsOf(ids);
  const parts = await Promise.all(infos.map(runReplay));
  return ids.length === 1 ? parts[0] : mergeRecordings(parts, `Apify lineup · ${infos.map(i => i.label).join(' + ')}`);
}

// Ledger Street without a recording opens the newest run, so Run on Apify is one click away.
async function newestLedger() {
  const newest = (await recentRuns().catch(() => [])).find(r => r.status !== 'FAILED' && r.status !== 'ABORTED');
  return newest ? `/finance.html?replay=${newest.replayUrl}&live=1` : `/finance.html?replay=${FALLBACK_REPLAY}`;
}

// Apify runs only so many jobs at once on an account (five on this plan),
// this site among them. A lineup starts if its agents fit in what's free.
async function freeSlots(fresh = false): Promise<Slots | null> {
  if (fresh) cache.delete('slots');
  return cached('slots', 5000, async () => {
    const usage = await client.user('me').limits().catch(() => undefined);
    if (!usage) return null;
    const max = usage.limits.maxConcurrentActorJobs, going = usage.current.activeActorJobCount;
    return { max, going, free: Math.max(0, max - going) };
  });
}

// Room for these agents and a few lineups an hour, from Run on Apify or the setup page.
async function refuseUnlessRoom(agents: number) {
  const limited = limiter.check();
  if (limited) throw new RequestError(limited, 429);
  const slots = await freeSlots(true);
  if (slots) {
    if (agents > slots.free) throw new RequestError(roomLine(slots, agents), 409);
    return;
  }
  // Without the account's limits, one lineup at a time.
  cache.delete('recent');
  const active = (await recentRuns()).find(r => !DONE.has(r.status));
  if (active) throw new RequestError(`A run is already going (${active.label}). Watch it, or try again when it ends.`, 409);
}

// A bench run per agent, started together. If Apify refuses one (say the
// account's memory is used up), the ones already started are stopped.
async function startBenchRuns(requests: ReturnType<typeof lineupInputs>) {
  await refuseUnlessRoom(requests.length);
  const ids: string[] = [];
  for (const request of requests) {
    try {
      const run = await client.actor(bench!.id).start(request.input, { memory: cfg.benchMemoryMbytes, timeout: cfg.benchTimeoutSecs });
      ids.push(run.id);
      labels.set(run.id, request.label);
      log.info(`Started ${run.id}: ${request.label} · ${request.input.variant} · ${request.input.caseSet} × ${request.input.repeat}`);
    } catch (err) {
      await Promise.all(ids.map(id => client.run(id).abort().catch(() => undefined)));
      throw new RequestError(`Apify wouldn’t start ${request.label}: ${err instanceof Error ? err.message : String(err)}`, 502);
    }
  }
  limiter.record();
  if (ids.length > 1) await rememberLineup(ids);
  cache.delete('recent');
  cache.delete('slots');
  return ids;
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
  runIds?: string[];
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
  const db = spacetime, where = cfg.spacetime;
  // begin_run resets the shared world, so never over someone's live episode.
  const worldIsLive = async () => (await db.sql('SELECT running FROM world'))[0]?.running === true;
  try {
    if (await worldIsLive()) throw new RequestError('The Clearing is live right now. Watch it, or start one when it ends.', 409);
  } catch (err) {
    job.status = 'failed';
    throw err;
  }
  clearingLimiter.record();
  jobs.set(job.id, job);
  const targets = runpodTargets(lineup);
  const begin = async () => {
    await wakeRunpod(targets, job);
    if (targets.length && await worldIsLive()) throw new Error('The Clearing went live while the models were waking up. Watch it, or start one when it ends.');
    await db.call('begin_run', [roster, 'charter', 1, 0, 0, cfg.clearingTimeScale]);
    job.status = 'running';
    log.info(`Clearing run ${job.id} on ${where.database}: ${roster.map(r => `${r.name}=${r.model_id}`).join(', ')}`);
    void watchClearing(job);
  };
  if (!targets.length) {
    try {
      await begin();
    } catch (err) {
      job.status = 'failed';
      throw err;
    }
    return job;
  }
  // Waking a cold worker takes minutes: answer now with a starting job, which the setup page polls.
  void begin().catch(err => failJob(job, err));
  return job;
}

// Our Runpod endpoints (Ender, Abliterated) in a lineup, to wake before it starts.
const WARM_MS = 20 * 60_000;
function runpodTargets(lineup: LineupEntry[]) {
  const site = cfg.models.map(m => ({ ...m, lobby: [...cfg.lobby.values()].find(l => l.siteId === m.id)?.name }));
  return warmTargets(site, lineup.map(e => e.model), '');
}

async function wakeRunpod(targets: WarmTarget[], job: LobbyJob) {
  if (!targets.length) return;
  log.info(`Waking ${targets.map(t => t.name).join(' and ')} on Runpod for ${job.id}…`);
  const started = Date.now();
  const awake = await Promise.all(targets.map(t => warmEndpoint(t, cfg.keys.custom, WARM_MS)));
  const cold = targets.filter((_, i) => !awake[i]).map(t => t.name);
  if (cold.length) throw new Error(`${cold.join(' and ')} didn't wake up on Runpod. Try again in a few minutes.`);
  log.info(`${targets.map(t => t.name).join(' and ')} awake after ${Math.round((Date.now() - started) / 1000)} s.`);
}

function failJob(job: LobbyJob, err: unknown) {
  job.status = 'failed';
  job.error = err instanceof Error ? err.message : String(err);
  log.warning(`${job.id}: ${job.error}`);
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

// A lineup of up to four agents through the quick tour, a bench run each, all
// in the offices at once. An agent picked twice runs every case twice.
async function startLedger(lineup: LineupEntry[]): Promise<LobbyJob> {
  const picked = lineup.map(e => ({ ...e, offered: offered(e.model) ?? (() => { throw new RequestError(`${e.model} is not offered on this site.`); })() }));
  const requests = lineupInputs(cfg, { models: picked.map(p => ({ model: p.offered.siteId, count: p.count })), caseSet: 'quick' });
  const base = { model: picked[0].model, modelId: picked[0].offered.modelId, scenario: LEDGER, roster: picked.map(p => ({ model: p.model, count: p.count, modelId: p.offered.modelId })), dbName: 'apify', host: 'apify' };
  const watch = (ids: string[]) => `/finance.html?replay=${replayPath(ids)}&live=1`;
  const targets = runpodTargets(lineup);
  if (!targets.length) {
    const ids = await startBenchRuns(requests);
    const job: LobbyJob = { id: ids.length === 1 ? ids[0] : `ledger-${Date.now().toString(36)}`, status: 'running', ...base, viewerHref: watch(ids), runIds: ids };
    jobs.set(job.id, job);
    return job;
  }
  // Refuse now rather than after minutes of waking the worker.
  await refuseUnlessRoom(requests.length);
  const job: LobbyJob = { id: `ledger-${Date.now().toString(36)}`, status: 'starting', ...base, viewerHref: '/?studio=setup' };
  jobs.set(job.id, job);
  void (async () => {
    await wakeRunpod(targets, job);
    const ids = await startBenchRuns(requests);
    Object.assign(job, { status: 'running', runIds: ids, viewerHref: watch(ids) });
  })().catch(err => failJob(job, err));
  return job;
}

async function lobbyJob(id: string) {
  const job = jobs.get(id);
  if (!job) throw new RequestError('Benchmark not found.', 404);
  if (job.runIds && job.status === 'running') {
    const info = await statusOf(job.runIds);
    if (info.status === 'SUCCEEDED') Object.assign(job, { status: 'completed', summary: info.statusMessage });
    else if (DONE.has(info.status)) Object.assign(job, { status: 'failed', error: info.statusMessage || `The run ${info.status.toLowerCase()}.` });
  }
  return job;
}

// The setup page asks every few seconds whether a run is going, and offers to
// continue it. The shared world is one: an episode started elsewhere
// (scripts/db-run.sh) is offered too, so visitors watch it instead of waiting.
async function lobbyJobs(): Promise<LobbyJob[]> {
  const list = [...jobs.values()];
  await Promise.all(list.filter(j => j.runIds && j.status === 'running').map(j => lobbyJob(j.id)));
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
      if (url.pathname === '/api/benchmarks/history' && req.method === 'GET') return { json: await runHistory() };
      const recording = url.pathname.match(/^\/api\/benchmarks\/([a-f0-9-]{36})\/replay$/);
      if (recording && req.method === 'GET') {
        // A link opened before this run listed the history: list it once to learn the id.
        const runIds = historyRuns.get(recording[1]) ?? (await runHistory(), historyRuns.get(recording[1]));
        if (!runIds) throw new RequestError('Recording not found.', 404);
        return { json: await replay(runIds.split(',')) };
      }
      const lobby = url.pathname.match(/^\/api\/benchmarks\/([A-Za-z0-9-]+)$/);
      if (lobby && req.method === 'GET' && lobby[1] !== 'history') return { json: await lobbyJob(lobby[1]) };
      if (!url.pathname.startsWith('/api/apify/')) return url.pathname.startsWith('/api/') ? { status: 404, json: { error: 'Route not found.' } } : undefined;
      if (url.pathname === '/api/apify/config' && req.method === 'GET') {
        const recent = await recentRuns();
        return { json: { ...publicConfig(cfg), benchActor: benchName, active: recent.find(r => !DONE.has(r.status)) ?? null, recent, slots: await freeSlots(), passwordRequired: password.required } };
      }
      if (url.pathname === '/api/apify/runs' && req.method === 'POST') {
        // A custom header forces a preflight, so another site's page can't press Run for a visitor.
        if (req.headers['x-enders-bench'] !== '1') throw new RequestError('Use the Ender’s Bench viewer to start runs.', 403);
        password.check(header(req, 'x-run-password'), addressOf(req));
        const ids = await startBenchRuns(lineupInputs(cfg, JSON.parse(body || '{}')));
        return { status: 201, json: { runId: ids.join(','), replayUrl: replayPath(ids) } };
      }
      const match = url.pathname.match(/^\/api\/apify\/runs\/([A-Za-z0-9,]+)(\/replay)?$/);
      if (match && req.method === 'GET') {
        const ids = lineupIds(match[1]) ?? (() => { throw new RequestError('No such Ender’s Bench run.', 404); })();
        return { json: match[2] ? await replay(ids) : await statusOf(ids) };
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
