// Writes runs/ender-sft.jsonl from every run's decisions.jsonl and report.json.
//
//   npm run dataset

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { sftExamples } from './dataset.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const runsDir = path.join(here, '..', 'runs');
const out = path.join(runsDir, 'ender-sft.jsonl');
const lines: string[] = [];
let runs = 0;
for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(runsDir, entry.name);
  const reportPath = path.join(dir, 'report.json'), decisionsPath = path.join(dir, 'decisions.jsonl');
  if (!fs.existsSync(reportPath) || !fs.existsSync(decisionsPath)) continue;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const systemPrompt = report.run?.config?.systemPrompt;
  if (typeof systemPrompt !== 'string') continue; // runs before the prompt was recorded
  const survivors = new Set<string>(report.agents.filter((a: { diedAtSeconds: number | null }) => a.diedAtSeconds === null).map((a: { name: string }) => a.name));
  const decisions = fs.readFileSync(decisionsPath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const ex of sftExamples(decisions, { systemPrompt, survivors })) lines.push(JSON.stringify(ex));
  runs++;
}
fs.writeFileSync(out, lines.join('\n') + (lines.length ? '\n' : ''));
console.log(`Wrote ${out}: ${lines.length} examples from ${runs} runs.`);
