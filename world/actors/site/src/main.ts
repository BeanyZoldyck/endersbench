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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Actor, log } from 'apify';
import { serve } from '../../shared/serve';
import { RequestError, RunLimiter, benchInput, publicConfig, siteConfig } from './runs';

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
const labels = new Map<string, string>();

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

async function home() {
  const newest = (await recentRuns().catch(() => [])).find(r => r.status !== 'FAILED' && r.status !== 'ABORTED');
  return newest ? `/finance.html?replay=${newest.replayUrl}&live=1` : `/finance.html?replay=${FALLBACK_REPLAY}`;
}

const port = Number(process.env.ACTOR_WEB_SERVER_PORT ?? 4321);
await serve({
  port,
  root: path.join(here, 'viewer'),
  log: message => log.warning(message),
  route: async (req, url, body) => {
    try {
      if (url.pathname === '/' || (url.pathname === '/finance.html' && !url.searchParams.has('replay'))) return { redirect: await home() };
      if (!url.pathname.startsWith('/api/apify/')) return undefined;
      if (url.pathname === '/api/apify/config' && req.method === 'GET') {
        const recent = await recentRuns();
        return { json: { ...publicConfig(cfg), benchActor: benchName, active: recent.find(r => !DONE.has(r.status)) ?? null, recent: recent.map(visible) } };
      }
      if (url.pathname === '/api/apify/runs' && req.method === 'POST') {
        // A custom header forces a preflight, so another site's page can't press Run for a visitor.
        if (req.headers['x-enders-bench'] !== '1') throw new RequestError('Use the Ender’s Bench viewer to start runs.', 403);
        const request = benchInput(cfg, JSON.parse(body || '{}'));
        cache.delete('recent');
        const active = (await recentRuns()).find(r => !DONE.has(r.status));
        if (active) throw new RequestError(`A run is already going (${active.label}). Watch it, or try again when it ends.`, 409);
        const limited = limiter.check();
        if (limited) throw new RequestError(limited, 429);
        const run = await client.actor(bench.id).start(request.input, { memory: cfg.benchMemoryMbytes, timeout: cfg.benchTimeoutSecs });
        limiter.record();
        labels.set(run.id, request.label);
        cache.delete('recent');
        log.info(`Started ${run.id}: ${request.label} · ${request.input.variant} · ${request.input.caseSet}`);
        return { status: 201, json: { runId: run.id, replayUrl: `/api/apify/runs/${run.id}/replay` } };
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
      if (err instanceof RequestError) return { status: err.status, json: { error: err.message } };
      if (err instanceof SyntaxError) return { status: 400, json: { error: 'Send JSON.' } };
      log.warning(`api: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 502, json: { error: 'Apify did not answer. Try again in a moment.' } };
    }
  },
});

const where = process.env.ACTOR_WEB_SERVER_URL ?? `http://localhost:${port}`;
log.info(`Ender's Bench site: ${where}/ · starts runs of ${benchName} · models: ${cfg.models.map(m => m.label).join(', ')}`);
await Actor.setStatusMessage(`Serving ${where}/ · runs ${benchName}`);
// The server keeps the run alive until its timeout or an abort.
