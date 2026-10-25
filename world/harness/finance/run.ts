// Runs the finance desk's cases against a model and scores them with the
// verifier. Results land in harness/finance/runs/ (kept out of git).
//
//   npm run finance:bench -- --model claude-sonnet-5-5 --variant no-charter
//   npm run finance:bench -- --model openai:<model>       any OpenAI-compatible API
//   npm run finance:bench -- --driver managed             Claude Managed Agents
//   npm run finance:bench -- --driver script              no API: Script A
//
// --variant is one of no-charter, principles, house-rules (the default and
// the headline) or charter. --model is "provider:model" as in the forest harness (anthropic, openai,
// openrouter, ender, ollama); a bare model id means anthropic. --driver
// messages (the default) is the benchmark loop, one fresh call per turn, for
// every provider. Options: --effort (omit for
// the model's own default), --cases id,id, --held-out (the 25 cases kept out of
// the fine-tune's training; pair it with --raw-crs for a model trained on raw
// responses), --repeat N (runs per case, 3 by
// default as the spec asks; --repeat 1 for a quick check), --concurrency N,
// --raw-crs (CRS tools answer with the full saved CRS response instead of the
// compact card; a separate format on the leaderboard), --live-crs (every CRS
// tool the agent calls goes to the CRS sandbox as the persona's exact request,
// and the agent and the verifier get what CRS returns now; see crslive.ts).
// --held-out runs live unless --snapshot-crs is given: the held-out test is
// scored on live CRS data. Keys come from
// the environment or a .env file. Managed runs create or update one agent
// per seat and prompt variant and record their ids in runs/managed.json.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { FINANCE_PROMPT_VARIANTS, HEADLINE_VARIANT } from '../../spacetimedb/src/finance/prompt';
import { FINANCE_BENCHMARK_VERSION, SCENARIOS, forVariant } from '../../spacetimedb/src/finance/scenarios';
import type { Scenario, Verdict, Violation } from '../../spacetimedb/src/finance/types';
import { type Gate, compliantByRun, gateCase, gateScore, passAllRuns } from '../../spacetimedb/src/finance/gate';
import { checkTools, toolScore } from '../../spacetimedb/src/finance/toolcheck';
import { ethicsScore, verify, verifyPair } from '../../spacetimedb/src/finance/verifier';
import { type CaseRun, type Effort, type ManagedSetup, type RunCase, managedDriver, messagesDriver, openAiDriver, scriptDriver, setupManaged } from './drivers';
import { type CrsClient, type LiveCrs, crsClientFromEnv, crsSummary, liveCrs } from './crslive';
import { OPENAI_COMPATIBLE, envValue, trustSystemCertificates } from './providers';
import { TEST_CASES } from './labels';
import { rawCrs } from './rawcrs';

const RUNS_DIR = path.resolve('harness/finance/runs');
const SETUP_FILE = path.join(RUNS_DIR, 'managed.json');

// USD per million tokens, list prices on Oct 24 2026; only for the estimate.
// Cache writes (5 minute) bill at 1.25x input.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  // Cache reads assumed at 0.1x input.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

type Driver = 'messages' | 'managed' | 'script';

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument '${argv[i]}'`);
    const next = argv[i + 1];
    flags.set(argv[i].slice(2), next && !next.startsWith('--') ? argv[++i] : 'true');
  }
  const driver = flags.get('driver') ?? 'messages';
  if (!['messages', 'managed', 'both', 'script'].includes(driver)) throw new Error(`unknown driver '${driver}'`);
  // house-rules is the headline (v6, reviews/policy-tiers.md).
  const variant = flags.get('variant') ?? HEADLINE_VARIANT;
  if (!FINANCE_PROMPT_VARIANTS.includes(variant)) throw new Error(`unknown variant '${variant}'`);
  const ids = flags.get('cases')?.split(',');
  // --held-out: the 25 cases on the eight personas kept out of training, for
  // the fine-tuned model and the frontier models it is compared with.
  const pool = flags.has('held-out') ? SCENARIOS.filter(s => TEST_CASES.includes(s.id)) : SCENARIOS;
  const cases = ids ? ids.map(id => pool.find(s => s.id === id) ?? fail(`unknown case '${id}'`)) : pool;
  const spec = flags.get('model') ?? 'claude-opus-5-5';
  const sep = spec.indexOf(':');
  const provider = sep < 0 ? 'anthropic' : spec.slice(0, sep);
  if (provider !== 'anthropic' && !(provider in OPENAI_COMPATIBLE)) throw new Error(`unknown provider '${provider}'`);
  if (provider !== 'anthropic' && driver !== 'messages') throw new Error(`--driver ${driver} runs Claude only`);
  return {
    drivers: (driver === 'both' ? ['messages', 'managed'] : [driver]) as Driver[],
    variant,
    provider,
    model: sep < 0 ? spec : spec.slice(sep + 1),
    // Unset means the model's own default: stock settings.
    effort: flags.get('effort') as Effort | undefined,
    cases,
    concurrency: Number(flags.get('concurrency') ?? 3),
    // Runs per case. The design spec asks for 3, reported as mean and range.
    repeat: Math.max(1, Number(flags.get('repeat') ?? 3)),
    raw: flags.has('raw-crs'),
    // The held-out test is the live one: its CRS data comes from the sandbox.
    live: flags.has('live-crs') || (flags.has('held-out') && !flags.has('snapshot-crs')),
  };
}

function fail(message: string): never {
  throw new Error(message);
}

const required = (name: string) => envValue(name) ?? fail(`no ${name}: add ${name}=... to endersbench/.env`);

async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface Scored {
  scenario: Scenario;
  sample: number;
  run: CaseRun;
  verdict: Verdict;
  gate: Gate;
  pair: Violation[];
}

// Same numbers as the desk viewer's scoreboard.
function summarize(scored: Scored[], model: string, live: boolean) {
  const all = (c: Scored) => [...c.verdict.violations, ...c.pair];
  const violations = scored.flatMap(all);
  const usage = scored.reduce(
    (u, c) => ({
      calls: u.calls + c.run.usage.calls,
      inputTokens: u.inputTokens + c.run.usage.inputTokens,
      outputTokens: u.outputTokens + c.run.usage.outputTokens,
      cacheReadTokens: u.cacheReadTokens + c.run.usage.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens + c.run.usage.cacheWriteTokens,
      listCostUsd: u.listCostUsd + (c.run.usage.listCostUsd ?? 0),
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, listCostUsd: 0 }
  );
  const price = PRICES[model];
  const estimatedUsd = price
    ? (usage.inputTokens * price.input + usage.cacheWriteTokens * price.input * 1.25 + usage.cacheReadTokens * price.cacheRead + usage.outputTokens * price.output) / 1e6
    : null;
  return {
    // The headline: outcome, process and output all pass.
    gate: gateScore(scored.map(c => c.gate)),
    // The same per run, for mean and range, and pass^k over the runs.
    byRun: compliantByRun(scored.map(c => ({ sample: c.sample, gate: c.gate }))),
    passAll: passAllRuns(scored.map(c => ({ id: c.scenario.id, gate: c.gate }))),
    // Tool choice alone: required checks called, and calls it had no business making.
    tools: toolScore(scored.map(c => checkTools(c.scenario, c.run.steps))),
    cases: scored.length,
    correct: scored.filter(c => c.verdict.outcome === 'correct').length,
    noDecision: scored.filter(c => c.verdict.outcome === 'no_decision').length,
    byTier: [1, 2, 3, 4].map(t => violations.filter(v => v.tier === t).length),
    ethics: scored.length ? scored.reduce((sum, c) => sum + ethicsScore(all(c)), 0) / scored.length : null,
    caved: `${scored.filter(c => c.verdict.caved === true).length}/${scored.filter(c => c.verdict.caved != null).length}`,
    updated: `${scored.filter(c => c.verdict.updated === true).length}/${scored.filter(c => c.verdict.updated != null).length}`,
    honestReports: `${scored.filter(c => c.verdict.honestReport === true).length}/${scored.filter(c => c.verdict.honestReport != null).length}`,
    stalls: scored.reduce((n, c) => n + c.run.stalls, 0),
    stopped: scored.filter(c => c.run.stopped).map(c => `${c.scenario.id}: ${c.run.stopped}`),
    usage,
    costUsd: usage.listCostUsd > 0 ? usage.listCostUsd : estimatedUsd,
    // Live runs: the CRS calls behind the cases, and any drift from the snapshot.
    ...(live ? { crs: crsSummary(scored.map(c => c.run.steps)) } : {}),
  };
}

function printCase(driver: Driver, c: Scored) {
  const violations = [...c.verdict.violations, ...c.pair];
  const decision = c.verdict.decision ?? (c.run.stopped ? `none (${c.run.stopped})` : 'none');
  const flags = c.gate.pass ? 'pass' : `FAIL ${c.gate.failures.join(', ')}`;
  const tiers = violations.length ? ` | ${violations.map(v => `T${v.tier} ${v.kind}`).join(', ')}` : '';
  console.log(`[${driver}] #${c.sample + 1} ${c.scenario.id.padEnd(28)} ${decision.padEnd(22)} ${flags}${tiers}`);
}

async function runDriver(driver: Driver, opts: ReturnType<typeof parseArgs>, client: Anthropic | null, crs: CrsClient | null) {
  let runCase: RunCase;
  const raw = opts.raw ? rawCrs : undefined;
  const live: LiveCrs | undefined = crs ? liveCrs(crs, { raw: opts.raw }) : undefined;
  if (driver === 'script') {
    runCase = live
      ? scriptDriver(policyFollower, { raw, live })
      : async scenario => ({ steps: runBrain(policyFollower, scenario, { raw }), notes: [], stalls: 0, usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  } else if (driver === 'messages' && opts.provider !== 'anthropic') {
    const spec = OPENAI_COMPATIBLE[opts.provider];
    const baseUrl = spec.baseUrl() ?? fail(`${opts.provider} models need ${spec.needs} in endersbench/.env`);
    const apiKey = spec.key() ?? fail(`${opts.provider} models need ${spec.needs} in endersbench/.env`);
    runCase = openAiDriver({ baseUrl, apiKey, model: opts.model, api: spec.api, reasoningEffort: opts.effort, raw, live });
  } else if (driver === 'messages') {
    runCase = messagesDriver(client!, { model: opts.model, effort: opts.effort, raw, live });
  } else {
    // Sync the agents every run so they always carry the current prompt and
    // tools; an update that changes nothing keeps the agent's version.
    const existing = fs.existsSync(SETUP_FILE) ? (JSON.parse(fs.readFileSync(SETUP_FILE, 'utf-8')) as ManagedSetup) : undefined;
    const setup = await setupManaged(
      client!,
      { model: opts.model, effort: opts.effort, seats: ['lending', 'collections', 'vendor_payments'], variants: FINANCE_PROMPT_VARIANTS },
      existing
    );
    fs.writeFileSync(SETUP_FILE, JSON.stringify(setup, null, 2));
    runCase = managedDriver(client!, setup, { live });
  }

  // Scored as this prompt variant sees the case (v6, forVariant).
  const items = Array.from({ length: opts.repeat }, (_, sample) => opts.cases.map(scenario => ({ scenario: forVariant(scenario, opts.variant), sample }))).flat();
  const runs = await pool(items, opts.concurrency, async ({ scenario, sample }): Promise<Scored> => {
    let run: CaseRun;
    try {
      run = await runCase(scenario, opts.variant);
    } catch (err) {
      // One failed case should not sink the run; it scores as no decision.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${driver}] ${scenario.id}: ${message}`);
      run = { steps: [], notes: [], stalls: 0, stopped: `error: ${message.slice(0, 200)}`, usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    }
    return { scenario, sample, run, verdict: verify(scenario, run.steps), gate: gateCase(scenario, run.steps), pair: [] };
  });
  // A twin's unequal treatment is charged to the second case of the pair, within one sample.
  runs.forEach((c, i) => {
    const twin = c.scenario.pairId
      ? runs.slice(0, i).find(o => o.sample === c.sample && o.scenario.pairId === c.scenario.pairId)
      : undefined;
    if (twin) c.pair = verifyPair({ scenario: twin.scenario, steps: twin.run.steps }, { scenario: c.scenario, steps: c.run.steps });
  });
  runs.forEach(c => printCase(driver, c));
  const summary = summarize(runs, opts.model, opts.live);
  return { driver, summary, runs };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const needsApi = opts.drivers.some(d => d !== 'script');
  if (needsApi) trustSystemCertificates();
  const client = needsApi && opts.provider === 'anthropic' ? new Anthropic({ apiKey: required('ANTHROPIC_API_KEY') }) : null;
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const effort = opts.effort ?? 'default';
  if (opts.raw && opts.drivers.includes('managed')) fail('--raw-crs runs the benchmark loop only, not --driver managed');
  // Log in before any case starts: a live run without CRS stops here instead
  // of quietly answering from the snapshot.
  const crs = opts.live ? crsClientFromEnv() : null;
  if (crs) await crs.login();
  console.log(
    `Finance benchmark v${FINANCE_BENCHMARK_VERSION} · ${opts.cases.length} cases · prompt: ${opts.variant} · ${opts.provider}:${opts.model} · effort: ${effort} · CRS: ${opts.raw ? 'full responses' : 'cards'}, ${opts.live ? 'live sandbox' : 'Oct 24 snapshot'}`
  );

  const results = [];
  for (const driver of opts.drivers) {
    const result = await runDriver(driver, opts, client, crs);
    results.push(result);
    const s = result.summary;
    const pct = (x: number) => `${Math.round(100 * x)}%`;
    const runs = opts.repeat > 1 ? ` over ${opts.repeat} runs, range ${pct(s.byRun.min)} to ${pct(s.byRun.max)}, pass^${opts.repeat} ${pct(s.passAll)}` : '';
    console.log(
      `[${driver}] compliant completion ${pct(s.byRun.mean)}${runs} (outcome ${pct(s.gate.outcome)}, process ${pct(s.gate.process)}, output ${pct(s.gate.output)}) · harm ${pct(s.gate.harmRate)} · over-escalation ${pct(s.gate.overEscalation)}`
    );
    console.log(`[${driver}] tools: required checks ${s.tools.requiredMet}/${s.tools.requiredApplied} · wrong calls ${s.tools.wrongCalls} in ${s.tools.casesWithWrongCalls} cases`);
    console.log(
      `[${driver}] correct ${s.correct}/${s.cases} · ethics ${s.ethics?.toFixed(1) ?? '-'} · violations by tier ${s.byTier.join('/')} · caved ${s.caved} · updated ${s.updated} · honest reports ${s.honestReports} · stalls ${s.stalls}` +
        (s.costUsd != null ? ` · ~$${s.costUsd.toFixed(2)}` : '')
    );
    if (s.crs) {
      const c = s.crs;
      console.log(
        `[${driver}] CRS live: ${c.calls} calls, ${c.live} answered by the sandbox (median ${c.medianMs ?? '-'} ms, p95 ${c.p95Ms ?? '-'} ms), ${c.fellBack} fell back to the snapshot, ${c.drifted} differed from it` +
          (c.driftFields.length ? ` (${c.driftFields.join(', ')})` : '') +
          (c.errors.length ? ` · errors: ${c.errors.join('; ')}` : '')
      );
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${opts.provider}-${opts.model}`.replace(/[^\w.-]+/g, '_');
  const file = path.join(RUNS_DIR, `${stamp}-v${FINANCE_BENCHMARK_VERSION}-${opts.drivers.join('+')}-${opts.variant}${opts.raw ? '-raw' : ''}${opts.live ? '-live' : ''}-${name}.json`);
  const record = {
    config: {
      benchmarkVersion: FINANCE_BENCHMARK_VERSION,
      provider: opts.provider,
      model: opts.model,
      effort,
      variant: opts.variant,
      crsFormat: opts.raw ? 'raw' : 'card',
      crsSource: opts.live ? 'live' : 'snapshot',
      cases: opts.cases.map(c => c.id),
      repeat: opts.repeat,
    },
    results: results.map(r => ({
      driver: r.driver,
      summary: r.summary,
      cases: r.runs.map(c => ({ id: c.scenario.id, sample: c.sample, verdict: c.verdict, gate: c.gate, pair: c.pair, ...c.run })),
    })),
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`Saved ${file}`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
