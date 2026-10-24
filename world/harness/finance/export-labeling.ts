// Writes the labelling kit's data: one item per case run, with the full CRS
// responses inline, and the verifier's answer key for each. No API calls.
//
//   npm run finance:export-labeling                     saved runs + scripted runs
//   npm run finance:export-labeling -- --runs <dir>     also another runs folder (e.g. from the DGX)
//   npm run finance:export-labeling -- --no-scripts     saved runs only
//
// Writes ender/labeling/finance/data/ (git ignores it):
//   items.train.jsonl, items.test.jsonl        what the labelling agent reads
//   answer_key.train.jsonl, answer_key.test.jsonl   what it is scored against; never show it to the agent
//   manifest.json                               counts and sizes
// Held-out items (8 personas) carry the canary and must never become training rows.
import fs from 'node:fs';
import path from 'node:path';
import { BASELINES, REFERENCE_AGENTS, runBrain } from '../../spacetimedb/src/finance/brains';
import { FINANCE_PROMPT_VARIANTS } from '../../spacetimedb/src/finance/prompt';
import { FINANCE_BENCHMARK_VERSION, SCENARIOS, SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import type { Scenario, Step } from '../../spacetimedb/src/finance/types';
import { answerKeyFor, itemFor } from './labeling';
import { rawCrs } from './rawcrs';

const OUT = path.resolve('..', 'ender', 'labeling', 'finance', 'data');
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dirs = [path.resolve('harness/finance/runs'), ...(flag('runs') ? [path.resolve(flag('runs')!)] : [])];

interface SavedRun {
  config: { benchmarkVersion?: number; provider: string; model: string; variant: string };
  results: { driver: string; cases: { id: string; sample?: number; steps: Step[] }[] }[];
}

const runs: { scenario: Scenario; source: string; variant: string; sample: number; steps: Step[] }[] = [];
for (const dir of dirs) {
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'managed.json').sort()) {
    const run = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as SavedRun;
    const version = run.config.benchmarkVersion ?? 0;
    const loop = run.results.find(r => r.driver === 'messages');
    if (!loop || version > FINANCE_BENCHMARK_VERSION) continue;
    for (const c of loop.cases) {
      const scenario = SCENARIO_BY_ID[c.id];
      if (!scenario || version < (scenario.since ?? 3) || c.steps.length === 0) continue;
      runs.push({ scenario, source: `${run.config.provider}:${run.config.model}`, variant: run.config.variant, sample: c.sample ?? 0, steps: c.steps });
    }
  }
}
if (!process.argv.includes('--no-scripts')) {
  const scripts = [
    ...REFERENCE_AGENTS.map(a => ({ source: `script-${a.id === 'policy' ? 'a' : a.id === 'pleaser' ? 'b' : 'c'}`, brain: a.brain })),
    ...BASELINES.map(b => ({ source: `baseline-${b.id}`, brain: b.brain })),
  ];
  for (const scenario of SCENARIOS) {
    for (const variant of FINANCE_PROMPT_VARIANTS) {
      for (const { source, brain } of scripts) runs.push({ scenario, source, variant, sample: 0, steps: runBrain(brain, scenario, { raw: rawCrs }) });
    }
  }
}

fs.mkdirSync(OUT, { recursive: true });
const out = {
  'items.train.jsonl': fs.createWriteStream(path.join(OUT, 'items.train.jsonl')),
  'items.test.jsonl': fs.createWriteStream(path.join(OUT, 'items.test.jsonl')),
  'answer_key.train.jsonl': fs.createWriteStream(path.join(OUT, 'answer_key.train.jsonl')),
  'answer_key.test.jsonl': fs.createWriteStream(path.join(OUT, 'answer_key.test.jsonl')),
};
const seen = new Set<string>();
const counts = { train: 0, test: 0, duplicates: 0 };
let bytes = 0;
for (const r of runs) {
  const item = itemFor(r.scenario, r);
  if (seen.has(item.item_id)) {
    // The same model, prompt and sample from a later file: keep the first.
    counts.duplicates++;
    continue;
  }
  seen.add(item.item_id);
  const line = JSON.stringify(item) + '\n';
  bytes += line.length;
  out[`items.${item.split}.jsonl`].write(line);
  out[`answer_key.${item.split}.jsonl`].write(JSON.stringify({ split: item.split, ...answerKeyFor(r.scenario, item, r.steps) }) + '\n');
  counts[item.split]++;
}
for (const s of Object.values(out)) s.end();
const manifest = {
  benchmarkVersion: FINANCE_BENCHMARK_VERSION,
  items: counts,
  sources: [...new Set(runs.map(r => r.source))].sort(),
  cases: SCENARIOS.length,
  approxItemMB: Math.round(bytes / 1e6),
  note: 'Each item carries the full CRS responses it saw and the full CRS file of every person on the case. Score labels with npm run finance:score-labels.',
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
console.log(`Wrote ${OUT}`);
