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
import { FINANCE_PROMPT_VARIANTS, HEADLINE_VARIANT } from '../../spacetimedb/src/finance/prompt';
import { FINANCE_BENCHMARK_VERSION, SCENARIOS } from '../../spacetimedb/src/finance/scenarios';
import { type Driver, type Scored, benchRunCase, runCases, savedRecord, summarize } from './bench';
import { type Effort, type ManagedSetup, type RunCase, managedDriver, setupManaged } from './drivers';
import { type CrsClient, type LiveCrs, crsClientFromEnv, liveCrs } from './crslive';
import { OPENAI_COMPATIBLE, envValue, trustSystemCertificates } from './providers';
import { TEST_CASES } from './labels';

const RUNS_DIR = path.resolve('harness/finance/runs');
const SETUP_FILE = path.join(RUNS_DIR, 'managed.json');

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

function printCase(driver: Driver, c: Scored) {
  const violations = [...c.verdict.violations, ...c.pair];
  const decision = c.verdict.decision ?? (c.run.stopped ? `none (${c.run.stopped})` : 'none');
  const flags = c.gate.pass ? 'pass' : `FAIL ${c.gate.failures.join(', ')}`;
  const tiers = violations.length ? ` | ${violations.map(v => `T${v.tier} ${v.kind}`).join(', ')}` : '';
  console.log(`[${driver}] #${c.sample + 1} ${c.scenario.id.padEnd(28)} ${decision.padEnd(22)} ${flags}${tiers}`);
}

async function runDriver(driver: Driver, opts: ReturnType<typeof parseArgs>, client: Anthropic | null, crs: CrsClient | null) {
  let runCase: RunCase;
  const live: LiveCrs | undefined = crs ? liveCrs(crs, { raw: opts.raw }) : undefined;
  if (driver === 'script') {
    runCase = benchRunCase('script', opts, null, live);
  } else if (driver === 'messages' && opts.provider !== 'anthropic') {
    const spec = OPENAI_COMPATIBLE[opts.provider];
    const baseUrl = spec.baseUrl() ?? fail(`${opts.provider} models need ${spec.needs} in endersbench/.env`);
    const apiKey = spec.key() ?? fail(`${opts.provider} models need ${spec.needs} in endersbench/.env`);
    runCase = benchRunCase('messages', opts, { kind: 'openai', baseUrl, apiKey, api: spec.api }, live);
  } else if (driver === 'messages') {
    runCase = benchRunCase('messages', opts, { kind: 'anthropic', client: client! }, live);
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

  const runs: Scored[] = await runCases(runCase, opts, { onError: (scenario, message) => console.error(`[${driver}] ${scenario.id}: ${message}`) });
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
  const record = savedRecord(opts, results);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`Saved ${file}`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
