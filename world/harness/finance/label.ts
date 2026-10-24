// Builds Ender's finance training data. No API calls.
//
//   npm run finance:label                         scripted states only (the default)
//   npm run finance:label -- --include-model-runs also states from saved Claude and GPT runs
//
// Sources of states, all relabelled with Script A's verified action:
//   - Script A, Scripts B and C, and the three baselines on every training-split
//     benchmark case and on synthetic training cases (synthetic.ts): the
//     scripts that go wrong put Script A in states it would not reach itself.
//   - Saved model runs, labelled in full for analysis (finance-steps*.jsonl),
//     but used for training rows only with --include-model-runs: Anthropic's
//     Commercial Terms bar using the Services "to train competing AI models"
//     (D.4(a), read Oct 24); OpenAI's terms could not be fetched to check.
//
// Writes ender/finetuning/data/candidates/ (git ignores it):
//   finance-steps.jsonl       every training-split turn with its labels (labels.ts)
//   finance-steps.test.jsonl  the held-out turns, each carrying the canary; never train on them
//   financial.jsonl           supervised rows in prepare_data.py's format, reviewed: false
//   finance-pairs.jsonl       chosen/rejected pairs for preference tuning, reviewed: false
//   summary.json              counts, labels and token estimates
import fs from 'node:fs';
import path from 'node:path';
import { BASELINES, REFERENCE_AGENTS, runBrain, type Brain } from '../../spacetimedb/src/finance/brains';
import { CARDS } from '../../spacetimedb/src/finance/cards';
import { familyCases } from '../../spacetimedb/src/finance/families';
import { RATE_CARD } from '../../spacetimedb/src/finance/policy';
import { FINANCE_PROMPT_VARIANTS } from '../../spacetimedb/src/finance/prompt';
import { FINANCE_BENCHMARK_VERSION, SCENARIOS, SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import type { Scenario, Step } from '../../spacetimedb/src/finance/types';
import { HELD_OUT_PERSONAS, TEST_CASES, labelRun, pairRows, roughTokens, scriptedOnly, sftRows, splitOf, type StepRecord } from './labels';
import { ARCHETYPES, archetypeOf, syntheticCards, syntheticInstances } from './synthetic';

const RUNS_DIR = path.resolve('harness/finance/runs');
const OUT_DIR = path.resolve('..', 'ender', 'finetuning', 'data', 'candidates');
const includeModelRuns = process.argv.includes('--include-model-runs');
const CAP_PER_CASE_TOOL = 3;

interface SavedRun {
  config: { benchmarkVersion?: number; provider: string; model: string; variant: string };
  results: { driver: string; cases: { id: string; sample?: number; steps: Step[] }[] }[];
}

const records: StepRecord[] = [];

// 1. Saved model runs of the cases as they stand now.
let modelRuns = 0;
for (const file of fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json') && f !== 'managed.json').sort()) {
  const run = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, file), 'utf-8')) as SavedRun;
  const version = run.config.benchmarkVersion ?? 0;
  const loop = run.results.find(r => r.driver === 'messages');
  if (!loop || version > FINANCE_BENCHMARK_VERSION) continue;
  for (const c of loop.cases) {
    const scenario = SCENARIO_BY_ID[c.id];
    if (!scenario || version < (scenario.since ?? 3) || c.steps.length === 0) continue;
    records.push(...labelRun(scenario, { source: `${run.config.provider}:${run.config.model}`, variant: run.config.variant, sample: c.sample ?? 0, steps: c.steps }));
    modelRuns++;
  }
}

// 2. Synthetic training cases. Their files join CARDS for this process only,
// so the engine and verifier can read them; the benchmark never sees them.
// --strict-holdout also drops the synthetic files cloned from a held-out
// persona's shape, so the held-out cases test kinds of file never trained on,
// not just people never trained on (the default, like τ²'s train/test split).
const strictHoldout = process.argv.includes('--strict-holdout');
const allSynthetic = syntheticCards();
const synthetic = Object.fromEntries(
  Object.entries(allSynthetic).filter(([id]) => !strictHoldout || !HELD_OUT_PERSONAS.includes(ARCHETYPES[archetypeOf(id)]))
);
Object.assign(CARDS, synthetic);
const syntheticCases = familyCases(syntheticInstances(synthetic), synthetic, { prefix: 'syn-' });
for (const s of syntheticCases) if (s.seat === 'lending') s.brief.rateCard = RATE_CARD;

// 3. Scripted runs on every training case, benchmark and synthetic.
const SCRIPTS: { source: string; brain: Brain }[] = [
  ...REFERENCE_AGENTS.map(a => ({ source: `script-${a.id === 'policy' ? 'a' : a.id === 'pleaser' ? 'b' : 'c'}`, brain: a.brain })),
  ...BASELINES.map(b => ({ source: `baseline-${b.id}`, brain: b.brain })),
];
const trainingCases: Scenario[] = [...SCENARIOS.filter(s => splitOf(s) === 'train'), ...syntheticCases];
for (const scenario of [...SCENARIOS.filter(s => splitOf(s) === 'test'), ...trainingCases]) {
  for (const variant of FINANCE_PROMPT_VARIANTS) {
    for (const { source, brain } of SCRIPTS) records.push(...labelRun(scenario, { source, variant, sample: 0, steps: runBrain(brain, scenario) }));
  }
}

const train = records.filter(r => r.split === 'train');
const test = records.filter(r => r.split === 'test');
const source = includeModelRuns ? () => true : scriptedOnly;
const sft = sftRows(records, { capPerCaseTool: CAP_PER_CASE_TOOL, source });
const pairs = pairRows(records, { source });

fs.mkdirSync(OUT_DIR, { recursive: true });
const jsonl = (name: string, rows: unknown[]) => fs.writeFileSync(path.join(OUT_DIR, name), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
jsonl('finance-steps.jsonl', train);
jsonl('finance-steps.test.jsonl', test);
jsonl('financial.jsonl', sft);
jsonl('finance-pairs.jsonl', pairs);

const tokens = sft.map(r => roughTokens(r.instruction + r.input + r.output)).sort((a, b) => a - b);
const count = <T>(xs: T[], key: (x: T) => string) => Object.fromEntries([...xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]));
const target = (output: string) => JSON.parse(output.split('\n')[1]).name as string;
const summary = {
  benchmarkVersion: FINANCE_BENCHMARK_VERSION,
  trainingRowsFrom: includeModelRuns ? 'scripted and saved model runs' : 'scripted runs only',
  holdout: strictHoldout ? 'strict: held-out personas and the archetypes cloned from them' : 'held-out personas',
  modelCaseRunsLabelled: modelRuns,
  heldOut: { personas: HELD_OUT_PERSONAS, cases: TEST_CASES.length },
  trainingCases: { benchmark: trainingCases.length - syntheticCases.length, synthetic: syntheticCases.length, syntheticFiles: Object.keys(synthetic).length },
  syntheticArchetypes: count(Object.keys(synthetic), id => archetypeOf(id)),
  turns: { train: train.length, test: test.length, trainLabels: count(train, r => String(r.label)) },
  sftRows: sft.length,
  sftTargets: count(sft, r => target(r.output)),
  sftRowsBySeat: count(sft, r => (r.instruction.startsWith('You are the underwriter') ? 'lending' : r.instruction.startsWith('You work the collections') ? 'collections' : 'vendor_payments')),
  sftRowsFromSynthetic: sft.filter(r => r.scenario_id.startsWith('finance:syn-')).length,
  pairRows: pairs.length,
  capPerCaseTool: CAP_PER_CASE_TOOL,
  roughTokensPerSftRow: { min: tokens[0], p50: tokens[Math.floor(tokens.length / 2)], p95: tokens[Math.floor(tokens.length * 0.95)], max: tokens[tokens.length - 1] },
  roughTokensTotal: tokens.reduce((a, b) => a + b, 0),
  note: 'Token counts are estimates at 3.2 characters per token. Rows are reviewed: false; prepare_data.py accepts only reviewed rows.',
};
fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${OUT_DIR}`);
