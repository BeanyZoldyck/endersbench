// Ender's Bench as an Apify Actor. One run is one benchmark job: the input
// names the agent, the policy and the cases; the run scores every case with the
// benchmark's own verifier and leaves:
//   dataset          one row per case (compliant or not, violations, CRS calls)
//   OUTPUT           the scorecard, as finance:bench prints it
//   RUN              the full run in finance:bench's file format
//   REPLAY           the Ledger Street recording, rewritten as each case finishes
// While it runs, the container URL (the Live View tab) serves the viewer
// playing that recording.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Actor, log } from 'apify';
import { type Scored, anthropicAccess, benchRunCase, runCases, savedRecord, summarize } from '../../../harness/finance/bench';
import { type LiveCrs, crsClient, liveCrs } from '../../../harness/finance/crslive';
import { FINANCE_BENCHMARK_VERSION } from '../../../spacetimedb/src/finance/scenarios';
import { serve } from '../../shared/serve';
import { InputError, type Plan, planFromInput } from './input';
import { datasetRow, progressRecording } from './output';

const here = path.dirname(fileURLToPath(import.meta.url));
const pct = (x: number) => `${Math.round(100 * x)}%`;

await Actor.init();

let plan: Plan;
try {
  plan = planFromInput(await Actor.getInput());
} catch (err) {
  if (err instanceof InputError) await Actor.fail(err.message);
  throw err;
}

const env = Actor.getEnv();
const runId = env.actorRunId ?? 'local';
const startedAt = new Date().toISOString();
const total = plan.opts.cases.length * plan.opts.repeat;
const source = `Apify run ${runId} · ${plan.agent} · CRS ${plan.opts.live ? 'live' : 'snapshot'}`;
let finished: Scored[] = [];
let recording = progressRecording(plan, [], source, startedAt, true, total);

// The Live View: the viewer, reloading /replay.json until the run is done.
const port = Number(process.env.ACTOR_WEB_SERVER_PORT ?? 0);
const server = port
  ? await serve({
      port,
      root: path.join(here, 'viewer'),
      log: message => log.warning(message),
      route: (_req, url) => {
        if (url.pathname === '/replay.json') return { json: recording };
        if (url.pathname === '/' || (url.pathname === '/finance.html' && !url.searchParams.has('replay'))) return { redirect: '/finance.html?replay=/replay.json&live=1' };
        return undefined;
      },
    })
  : undefined;
if (server) log.info(`Live View: ${process.env.ACTOR_WEB_SERVER_URL ?? `http://localhost:${port}`}/`);

log.info(`Ender's Bench · finance desk v${FINANCE_BENCHMARK_VERSION} · ${plan.agent} · policy ${plan.opts.variant} · ${plan.opts.cases.length} cases × ${plan.opts.repeat} · CRS ${plan.opts.live ? 'live sandbox' : 'Oct 24 snapshot'}`);
await Actor.setStatusMessage(`Starting ${total} case runs for ${plan.agent}`);

// One login before any case starts. A failed login ends the run and is never
// retried: repeated failures disable the sandbox account.
let live: LiveCrs | undefined;
if (plan.crs) {
  const client = crsClient(plan.crs);
  try {
    await client.login();
  } catch (err) {
    await Actor.fail(`CRS sandbox login failed, so no case was run: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  live = liveCrs(client, { raw: plan.opts.raw });
}

const access = plan.access?.kind === 'anthropic' ? anthropicAccess(plan.access.apiKey) : plan.access;
const runCase = benchRunCase(plan.driver, plan.opts, access, live);

const byIndex = new Map<number, Scored>();
let compliant = 0;
const scored = await runCases(runCase, plan.opts, {
  onError: (scenario, message) => log.warning(`${scenario.id}: ${message}`),
  onCase: async (c, index) => {
    byIndex.set(index, c);
    finished = [...byIndex.keys()].sort((a, b) => a - b).map(i => byIndex.get(i)!);
    if (c.gate.pass) compliant++;
    recording = progressRecording(plan, finished, source, startedAt, true, total);
    await Actor.pushData(datasetRow(c, plan));
    await Actor.setValue('REPLAY', recording);
    await Actor.setStatusMessage(`${finished.length}/${total} cases · ${compliant} compliant · last: ${c.scenario.id} ${c.gate.pass ? 'pass' : 'FAIL'}`);
  },
});

const summary = summarize(scored, plan.opts.model, plan.opts.live);
const record = savedRecord(plan.opts, [{ driver: plan.driver, summary, runs: scored }]);
recording = progressRecording(plan, scored, source, startedAt, false, total);
await Actor.setValue('RUN', record);
await Actor.setValue('REPLAY', recording);
await Actor.setValue('OUTPUT', {
  benchmark: plan.benchmark,
  benchmarkVersion: FINANCE_BENCHMARK_VERSION,
  agent: plan.agent,
  variant: plan.opts.variant,
  crs: plan.opts.live ? 'live' : 'snapshot',
  cases: plan.opts.cases.length,
  repeat: plan.opts.repeat,
  compliantCompletion: summary.byRun.mean,
  summary,
  startedAt,
  finishedAt: new Date().toISOString(),
});
if (plan.replayStore) {
  const store = await Actor.openKeyValueStore(plan.replayStore);
  await store.setValue(runId, recording);
}

const s = summary;
const line = `Compliant completion ${pct(s.byRun.mean)} (${s.cases} case runs) · outcome ${pct(s.gate.outcome)} · process ${pct(s.gate.process)} · output ${pct(s.gate.output)} · harm ${pct(s.gate.harmRate)}`;
log.info(line);
log.info(`Violations by tier ${s.byTier.join('/')} · required checks ${s.tools.requiredMet}/${s.tools.requiredApplied} · wrong calls ${s.tools.wrongCalls}${s.costUsd != null ? ` · ~$${s.costUsd.toFixed(2)} of model calls` : ''}`);

if (server && plan.viewerMinutes > 0) {
  await Actor.setStatusMessage(`${line} · Live View open ${plan.viewerMinutes} more min`);
  await new Promise(resolve => setTimeout(resolve, plan.viewerMinutes * 60_000));
}
server?.close();
await Actor.exit(line);
