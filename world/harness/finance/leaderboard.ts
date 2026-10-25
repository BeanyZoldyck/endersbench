// The finance leaderboard: re-scores saved runs from their recorded tool
// calls, so it needs no API calls and always uses the current scoring code.
// Headline: compliant completion, the share of case runs whose outcome,
// process and output all pass, as the mean of a model's runs with their range
// (lowest to highest run) and a 95% interval over cases. The baselines are
// scored live beside the models: if one of them ranks near a model, the
// metric is broken.
//
// Four prompt variants (v6, reviews/policy-tiers.md): no-charter, principles,
// house-rules (the headline) and charter. Each table also splits the cases
// by what they turn on: a rule of law, or one of our house rules. Under a
// prompt that carries no house rules, the policy-backed column is agreement
// with those rules, not violations. After the tables, the lift from
// house-rules to charter is given as paired per-case differences.
//
// Each case's runs come from the latest saved run that includes it, of a
// version at or after the case's `since`, so a case that has not changed
// keeps its earlier runs (scenarios.test.ts guards this with fingerprints).
//
//   npm run finance:leaderboard
import fs from 'node:fs';
import path from 'node:path';
import { BASELINES, policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { type Gate, compliantByRun, compliantInterval, gateCase, gateScore, passAllRuns } from '../../spacetimedb/src/finance/gate';
import { FINANCE_PROMPT_VARIANTS, HEADLINE_VARIANT, hasHouseRules } from '../../spacetimedb/src/finance/prompt';
import { FINANCE_BENCHMARK_VERSION, SCENARIOS, SCENARIO_BY_ID, forVariant } from '../../spacetimedb/src/finance/scenarios';
import { checkTools, toolScore } from '../../spacetimedb/src/finance/toolcheck';
import type { Step } from '../../spacetimedb/src/finance/types';
import { crsSummary } from './crslive';
import { TEST_CASES } from './labels';

const RUNS_DIR = path.resolve('harness/finance/runs');

// --held-out: score only the 25 cases kept out of the fine-tune's training, so a
// model run with finance:bench --held-out is complete and comparable with the
// frontier models on the same cases.
const heldOut = process.argv.includes('--held-out');
const CASES = heldOut ? SCENARIOS.filter(s => TEST_CASES.includes(s.id)) : SCENARIOS;

interface SavedRun {
  config: { benchmarkVersion?: number; provider: string; model: string; variant: string; crsFormat?: 'raw' | 'card'; crsSource?: 'live' | 'snapshot'; cases: string[]; repeat?: number };
  results: { driver: string; cases: { id: string; sample?: number; steps: Step[] }[] }[];
}

type CaseRuns = { file: string; version: number; runs: { sample: number; steps: Step[] }[] };

// Per model and prompt, per case: the runs from the latest file that may supply it.
const byModel = new Map<string, Map<string, CaseRuns>>();
for (const file of fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json') && f !== 'managed.json').sort()) {
  const run = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, file), 'utf-8')) as SavedRun;
  const version = run.config.benchmarkVersion ?? 0;
  if (version > FINANCE_BENCHMARK_VERSION) continue;
  const loop = run.results.find(r => r.driver === 'messages');
  if (!loop) continue;
  // Full CRS responses are a different task from cards: their own row. Runs
  // on live CRS data get their own row too, so a row is never half live.
  const tags = [run.config.crsFormat === 'raw' ? 'raw' : '', run.config.crsSource === 'live' ? 'live' : ''].filter(Boolean);
  const key = `${run.config.provider}:${run.config.model}${tags.length ? ` [${tags.join(', ')} CRS]` : ''}|${run.config.variant}`;
  const cases = byModel.get(key) ?? new Map<string, CaseRuns>();
  for (const id of new Set(loop.cases.map(c => c.id))) {
    const scenario = SCENARIO_BY_ID[id];
    if (!scenario || version < (scenario.since ?? 3)) continue;
    const runs = loop.cases.filter(c => c.id === id).map(c => ({ sample: c.sample ?? 0, steps: c.steps }));
    cases.set(id, { file, version, runs });
  }
  byModel.set(key, cases);
}

type Gated = { id: string; sample: number; gate: Gate };

interface Row {
  name: string;
  variant: string;
  repeat: number;
  gates: Gated[];
  wrongCalls: number;
  files?: string[];
  crs?: ReturnType<typeof crsSummary>; // the CRS calls behind a live row
}

const pct = (x: number) => `${Math.round(100 * x)}%`.padStart(4);
const basisOf = (id: string) => SCENARIO_BY_ID[id].basis;

const incomplete: string[] = [];
const rows: Row[] = [];
for (const [key, cases] of byModel) {
  const [name, variant] = key.split('|');
  if (!FINANCE_PROMPT_VARIANTS.includes(variant)) continue;
  const missing = CASES.filter(s => !cases.has(s.id));
  if (missing.length) {
    if (missing.length < CASES.length) incomplete.push(`${name} ${variant}: no runs yet for ${missing.length} of ${CASES.length} cases`);
    continue;
  }
  const all = CASES.flatMap(s => cases.get(s.id)!.runs.map(r => ({ id: s.id, ...r })));
  const repeat = Math.min(...CASES.map(s => cases.get(s.id)!.runs.length));
  rows.push({
    name,
    variant,
    repeat,
    files: [...new Set([...cases.values()].map(c => c.file))],
    // Scored as the prompt variant saw each case (forVariant, v6).
    gates: all.map(c => ({ id: c.id, sample: c.sample, gate: gateCase(forVariant(SCENARIO_BY_ID[c.id], variant), c.steps) })),
    wrongCalls: toolScore(all.map(c => checkTools(SCENARIO_BY_ID[c.id], c.steps))).wrongCalls / repeat,
    crs: crsSummary(all.map(c => c.steps)),
  });
}

// Deterministic, so one run each. Scored per variant: the accepted answers
// differ without the house rules, though the scripts' actions do not.
const scripted = (variant: string): Row[] =>
  [{ name: 'Script A (reference)', brain: policyFollower }, ...BASELINES].map(b => ({
    name: b.name,
    variant,
    repeat: 1,
    gates: CASES.map(s => ({ id: s.id, sample: 0, gate: gateCase(forVariant(s, variant), runBrain(b.brain, s)) })),
    wrongCalls: toolScore(CASES.map(s => checkTools(s, runBrain(b.brain, s)))).wrongCalls,
  }));

const lawCases = CASES.filter(s => s.basis === 'law').length;
const policyCases = CASES.length - lawCases;

console.log(
  `Finance benchmark v${FINANCE_BENCHMARK_VERSION}, ${CASES.length} cases${heldOut ? " held out from the fine-tune" : ""} (${lawCases} law-backed, ${policyCases} policy-backed). Compliant = outcome, process and output all pass.`
);
console.log('Compliant is the mean of the runs; range is the lowest to the highest run; ±95% treats the case as the unit;');
console.log('pass^k counts a case only if all k runs passed. "law" and "policy" are compliant completion on each group of cases;');
console.log('where the prompt carries no house rules, the policy column is agreement with them, not violations.\n');

const TITLES: Record<string, string> = {
  'house-rules': 'HOUSE RULES (headline): the four principles and the three company rules',
  'no-charter': 'NO POLICY: the model\'s defaults',
  principles: 'PRINCIPLES: four principles, no company rules',
  charter: 'FULL CHARTER: the 9-line desk policy spelled out',
};
const order = [HEADLINE_VARIANT, ...FINANCE_PROMPT_VARIANTS.filter(v => v !== HEADLINE_VARIANT)];
// Rounded so float noise in the mean cannot reorder a tie; ties keep models above baselines.
const rank = (r: { gates: Gated[] }) => Math.round(1e6 * compliantByRun(r.gates).mean);
const isBaseline = (r: Row) => r.name.startsWith('Baseline:');

for (const variant of order) {
  const models = rows.filter(r => r.variant === variant);
  const policyHeader = hasHouseRules(variant) ? 'policy' : 'agree';
  console.log(TITLES[variant] ?? variant.toUpperCase());
  console.log(`  model                          runs  compliant  ±95%    range  pass^k    law  ${policyHeader.padStart(6)}  outcome  process  output  harm  over-esc  wrong calls/run`);
  // Script A first at 100%; models by score; the baselines after every model, in their own order.
  const table = [...models, ...scripted(variant)].sort((a, b) => Number(isBaseline(a)) - Number(isBaseline(b)) || rank(b) - rank(a));
  for (const r of table) {
    const s = gateScore(r.gates.map(g => g.gate));
    const runs = compliantByRun(r.gates);
    const law = gateScore(r.gates.filter(g => basisOf(g.id) === 'law').map(g => g.gate)).compliant;
    const policy = gateScore(r.gates.filter(g => basisOf(g.id) === 'policy').map(g => g.gate)).compliant;
    const range = r.repeat > 1 ? `${Math.round(100 * runs.min)}-${Math.round(100 * runs.max)}%` : '-';
    // A deterministic script has no run-to-run spread, and its interval would describe the cases, not it.
    const ci = r.repeat > 1 ? `±${Math.round(100 * compliantInterval(r.gates).halfWidth)}` : '-';
    console.log(
      `  ${r.name.padEnd(30)} ${String(r.repeat).padStart(4)}  ${pct(runs.mean).padStart(9)}  ${ci.padStart(4)}  ${range.padStart(7)}  ${(r.repeat > 1 ? pct(passAllRuns(r.gates)) : '-').padStart(6)}  ${pct(law).padStart(5)}  ${pct(policy).padStart(6)}  ${pct(s.outcome).padStart(7)}  ${pct(s.process).padStart(7)}  ${pct(s.output).padStart(6)}  ${pct(s.harmRate)}  ${pct(s.overEscalation).padStart(8)}  ${r.wrongCalls.toFixed(1).padStart(15)}`
    );
  }
  if (!models.length) console.log('  (no complete model runs yet for this prompt)');
  console.log('');
}
for (const note of incomplete) console.log(`Left out until complete: ${note}`);
if (incomplete.length) console.log('');

// Where a live row's CRS answers came from: the sandbox during the run, or
// the snapshot when a call failed, and whether CRS's data had moved since.
const liveRows = rows.filter(r => r.crs?.calls);
if (liveRows.length) {
  console.log('CRS calls behind the live rows:');
  for (const r of liveRows) {
    const c = r.crs!;
    console.log(`  ${r.name.padEnd(30)} ${r.variant.padEnd(12)} ${c.calls} calls, ${c.live} answered by the sandbox (median ${c.medianMs ?? '-'} ms), ${c.fellBack} from the snapshot, ${c.drifted} differed from it`);
  }
  console.log('');
}

// The lift from writing the rules out: charter minus house-rules, as the mean
// of paired per-case differences (each case's pass rate over its runs) with a
// 95% interval. A large gap means the full charter works as a rubric. With
// few cases, gaps under about 20 points are not established.
function pairedLift(a: Row, b: Row) {
  const rate = (r: Row) => {
    const byCase = new Map<string, boolean[]>();
    for (const g of r.gates) byCase.set(g.id, [...(byCase.get(g.id) ?? []), g.gate.pass]);
    return new Map([...byCase].map(([id, passes]) => [id, passes.filter(Boolean).length / passes.length]));
  };
  const ra = rate(a);
  const rb = rate(b);
  const diffs = CASES.map(s => (rb.get(s.id) ?? 0) - (ra.get(s.id) ?? 0));
  const n = diffs.length;
  const mean = diffs.reduce((x, y) => x + y, 0) / n;
  const variance = n > 1 ? diffs.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, halfWidth: 1.96 * Math.sqrt(variance / n), cases: n };
}
const lifts = [...new Set(rows.map(r => r.name))].flatMap(name => {
  const h = rows.find(r => r.name === name && r.variant === HEADLINE_VARIANT);
  const c = rows.find(r => r.name === name && r.variant === 'charter');
  return h && c ? [{ name, ...pairedLift(h, c) }] : [];
});
if (lifts.length) {
  console.log('Lift from spelling the rules out (charter minus house-rules), paired per case:');
  for (const l of lifts) {
    const points = Math.round(100 * l.mean);
    const hw = Math.round(100 * l.halfWidth);
    const verdict = Math.abs(points) > hw ? '' : ' (not established)';
    console.log(`  ${l.name.padEnd(30)} ${(points >= 0 ? '+' : '') + points} points ±${hw} over ${l.cases} cases${verdict}`);
  }
  console.log('');
}

// Why model runs failed under the headline prompt, most common first, to
// find what to fix or harden next.
const reasons = new Map<string, number>();
for (const r of rows.filter(r => r.variant === HEADLINE_VARIANT)) {
  for (const { gate } of r.gates) for (const f of new Set(gate.failures)) reasons.set(f, (reasons.get(f) ?? 0) + 1);
}
if (reasons.size) {
  console.log(`Most common failures under ${HEADLINE_VARIANT} (case runs, all models):`);
  for (const [f, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${f}`);
}
