// Scores a labelling agent's labels against the verifier's answer key.
//
//   npm run finance:score-labels -- --labels <labels.jsonl> [--key <answer_key.jsonl>]
//
// --key defaults to ender/labeling/finance/data/answer_key.train.jsonl. Only
// items present in the labels file are scored; the report says how many.
import fs from 'node:fs';
import path from 'node:path';
import { type Labels, scoreLabels } from './labeling';

const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const labelsPath = flag('labels');
if (!labelsPath) {
  console.error('Pass --labels <file.jsonl>: one JSON object per line, in the shape of ender/labeling/finance/labels.schema.json.');
  process.exit(1);
}
const keyPath = flag('key') ?? path.resolve('..', 'ender', 'labeling', 'finance', 'data', 'answer_key.train.jsonl');
const read = (p: string) => fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Labels);
const got = read(labelsPath);
const ids = new Set(got.map(g => g.item_id));
const key = read(keyPath).filter(k => ids.has(k.item_id));
const score = scoreLabels(key, got);
const pct = (x: number | null) => (x == null ? '   -' : `${Math.round(100 * x)}%`.padStart(4));
console.log(`Scored ${score.items} items (${score.missing} in the key had no labels).\n`);
console.log('Accuracy');
for (const [field, a] of Object.entries(score.accuracy)) console.log(`  ${field.padEnd(36)} ${pct(a.accuracy)}  (n=${a.n})`);
console.log('\nCode lists: precision / recall / F1');
for (const [field, s] of Object.entries(score.prf)) console.log(`  ${field.padEnd(36)} ${pct(s.precision)} ${pct(s.recall)} ${pct(s.f1)}  (tp ${s.tp}, fp ${s.fp}, fn ${s.fn})`);
