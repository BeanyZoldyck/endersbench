// The finance leaderboard: re-scores saved runs from their recorded tool
// calls, so it needs no API calls and always uses the current scoring code.
// Headline: compliant completion, the share of case runs whose outcome,
// process and output all pass, as the mean of a model's runs with their range
// (lowest to highest run) and a 95% interval over cases. The baselines are
// scored live beside the models: if one of them ranks near a model, the
// metric is broken.
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
import { FINANCE_BENCHMARK_VERSION, SCENARIOS, SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import { checkTools, toolScore } from '../../spacetimedb/src/finance/toolcheck';
import type { Step } from '../../spacetimedb/src/finance/types';

const RUNS_DIR = path.resolve('harness/finance/runs');

interface SavedRun {
  config: { benchmarkVersion?: number; provider: string; model: string; variant: string; cases: string[]; repeat?: number };
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
  const key = `${run.config.provider}:${run.config.model}|${run.config.variant}`;
  const cases = byModel.get(key) ?? new Map<string, CaseRuns>();
  for (const id of new Set(loop.cases.map(c => c.id))) {
    const scenario = SCENARIO_BY_ID[id];
    if (!scenario || version < (scenario.since ?? 3)) continue;
    const runs = loop.cases.filter(c => c.id === id).map(c => ({ sample: c.sample ?? 0, steps: c.steps }));
    cases.set(id, { file, version, runs });
  }
  byModel.set(key, cases);
}

interface Row {
  name: string;
  variant: string;
  repeat: number;
  gates: { id: string; sample: number; gate: Gate }[];
  wrongCalls: number;
  files?: string[];
}

const pct = (x: number) => `${Math.round(100 * x)}%`.padStart(4);

const incomplete: string[] = [];
const rows: Row[] = [];
for (const [key, cases] of byModel) {
  const [name, variant] = key.split('|');
  const missing = SCENARIOS.filter(s => !cases.has(s.id));
  if (missing.length) {
    if (missing.length < SCENARIOS.length) incomplete.push(`${name} ${variant}: no runs yet for ${missing.length} of ${SCENARIOS.length} cases`);
    continue;
  }
  const all = SCENARIOS.flatMap(s => cases.get(s.id)!.runs.map(r => ({ id: s.id, ...r })));
  const repeat = Math.min(...SCENARIOS.map(s => cases.get(s.id)!.runs.length));
  rows.push({
    name,
    variant,
    repeat,
    files: [...new Set([...cases.values()].map(c => c.file))],
    gates: all.map(c => ({ id: c.id, sample: c.sample, gate: gateCase(SCENARIO_BY_ID[c.id], c.steps) })),
    wrongCalls: toolScore(all.map(c => checkTools(SCENARIO_BY_ID[c.id], c.steps))).wrongCalls / repeat,
  });
}

// Deterministic, so one run each, and the same under either prompt.
const scripted = [{ name: 'Script A (reference)', brain: policyFollower }, ...BASELINES].map(b => ({
  name: b.name,
  repeat: 1,
  gates: SCENARIOS.map(s => ({ id: s.id, sample: 0, gate: gateCase(s, runBrain(b.brain, s)) })),
  wrongCalls: toolScore(SCENARIOS.map(s => checkTools(s, runBrain(b.brain, s)))).wrongCalls,
}));

console.log(`Finance benchmark v${FINANCE_BENCHMARK_VERSION}, ${SCENARIOS.length} cases. Compliant = outcome, process and output all pass.`);
console.log('Compliant is the mean of the runs; range is the lowest to the highest run; ±95% treats the case as the unit;');
console.log('pass^k counts a case only if all k runs passed.\n');
for (const variant of ['no-charter', 'charter']) {
  const models = rows.filter(r => r.variant === variant);
  console.log(variant === 'no-charter' ? 'WITHOUT the desk policy (headline)' : 'WITH the desk policy');
  console.log('  model                          runs  compliant  ±95%    range  pass^k  outcome  process  output  harm  over-esc  wrong calls/run');
  // Rounded so float noise in the mean cannot reorder a tie; ties keep models above baselines.
  const rank = (r: { gates: Row['gates'] }) => Math.round(1e6 * compliantByRun(r.gates).mean);
  const table = [...models, ...scripted.map(s => ({ ...s, variant }))].sort((a, b) => rank(b) - rank(a));
  for (const r of table) {
    const s = gateScore(r.gates.map(g => g.gate));
    const runs = compliantByRun(r.gates);
    const range = r.repeat > 1 ? `${Math.round(100 * runs.min)}-${Math.round(100 * runs.max)}%` : '-';
    // A deterministic script has no run-to-run spread, and its interval would describe the cases, not it.
    const ci = r.repeat > 1 ? `±${Math.round(100 * compliantInterval(r.gates).halfWidth)}` : '-';
    console.log(
      `  ${r.name.padEnd(30)} ${String(r.repeat).padStart(4)}  ${pct(runs.mean).padStart(9)}  ${ci.padStart(4)}  ${range.padStart(7)}  ${(r.repeat > 1 ? pct(passAllRuns(r.gates)) : '-').padStart(6)}  ${pct(s.outcome).padStart(7)}  ${pct(s.process).padStart(7)}  ${pct(s.output).padStart(6)}  ${pct(s.harmRate)}  ${pct(s.overEscalation).padStart(8)}  ${r.wrongCalls.toFixed(1).padStart(15)}`
    );
  }
  console.log('');
}
for (const note of incomplete) console.log(`Left out until complete: ${note}`);
if (incomplete.length) console.log('');

// Why model runs failed, most common first, to find what to fix or harden next.
const reasons = new Map<string, number>();
for (const r of rows.filter(r => r.variant === 'no-charter')) {
  for (const { gate } of r.gates) for (const f of new Set(gate.failures)) reasons.set(f, (reasons.get(f) ?? 0) + 1);
}
if (reasons.size) {
  console.log('Most common failures without the policy (case runs, all models):');
  for (const [f, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${f}`);
}
