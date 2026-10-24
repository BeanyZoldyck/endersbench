// Promotes reviewed finance candidates into the fine-tuning pipeline's input,
// ender/finetuning/data/raw/financial.jsonl. A person runs this after looking
// at the rows: it records who, when and why, and marks every row reviewed,
// which prepare_data.py requires. It refuses without a reviewer's name.
//
//   npm run finance:promote -- --reviewer "Sid" --notes "spot-checked 40 rows"
//   npm run finance:promote -- --raw-crs --reviewer "Sid"   the full-CRS-response rows (candidates-raw/)
import fs from 'node:fs';
import path from 'node:path';
import { CANARY, TEST_CASES, type SftRow } from './labels';

const rawMode = process.argv.includes('--raw-crs');
const CANDIDATES = path.resolve('..', 'ender', 'finetuning', 'data', rawMode ? 'candidates-raw' : 'candidates', 'financial.jsonl');
const RAW = path.resolve('..', 'ender', 'finetuning', 'data', 'raw', 'financial.jsonl');

function flag(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const reviewer = flag('reviewer')?.trim();
if (!reviewer) {
  console.error('Refusing to promote: pass --reviewer "<your name>". Only a person who has looked at the rows should mark them reviewed.');
  process.exit(1);
}
const text = fs.readFileSync(CANDIDATES, 'utf-8');
if (text.includes(CANARY)) throw new Error('a held-out record is in the candidates; regenerate with npm run finance:label');
const rows = text.split('\n').filter(Boolean).map(l => JSON.parse(l) as SftRow);
const leaked = rows.filter(r => TEST_CASES.some(id => r.scenario_id === `finance:${id}`));
if (leaked.length) throw new Error(`${leaked.length} rows come from held-out cases`);
for (const [i, r] of rows.entries()) {
  if (!/^<tool_call>\n\{.*\}\n<\/tool_call>$/s.test(r.output)) throw new Error(`row ${i + 1}: output is not one tool call`);
}
if (fs.existsSync(RAW) && !process.argv.includes('--replace')) {
  console.error(`${RAW} exists. Pass --replace to overwrite it.`);
  process.exit(1);
}
const reviewedAt = new Date().toISOString();
const notes = flag('notes') ?? '';
const format = rawMode ? 'full CRS responses' : 'cards';
fs.writeFileSync(RAW, rows.map(r => JSON.stringify({ ...r, reviewed: true, reviewed_by: reviewer, reviewed_at: reviewedAt, review_notes: notes, crs_format: format })).join('\n') + '\n');
console.log(`Promoted ${rows.length} rows (${format}) to ${RAW}, reviewed by ${reviewer}.`);
console.log('Next, on the Spark: python finetuning/prepare_data.py finetuning/data/raw/financial.jsonl [the refusal rows]');
