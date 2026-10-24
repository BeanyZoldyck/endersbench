// Pools every saved run into the benchmark's results pages.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Report } from './report.js';
import { aggregate, atAGlance, renderResultsHtml, renderResultsMarkdown } from './results.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const runsDir = path.resolve(process.env.RESULTS_RUNS_DIR ?? path.join(here, '..', 'runs'));
const outDir = path.resolve(process.env.RESULTS_OUT_DIR ?? runsDir);

function isReport(value: unknown): value is Report {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<Record<'run' | 'models' | 'agents' | 'events', unknown>>;
  return typeof report.run === 'object' && Array.isArray(report.models) && Array.isArray(report.agents) && Array.isArray(report.events);
}

function readReports() {
  const reports: Array<{ dir: string; report: Report }> = [];
  if (!fs.existsSync(runsDir)) return reports;
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const filename = path.join(runsDir, entry.name, 'report.json');
    try {
      const report: unknown = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (!isReport(report)) throw new Error('JSON does not have the report shape');
      reports.push({ dir: entry.name, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping unreadable report ${filename}: ${message}`);
    }
  }
  return reports;
}

fs.mkdirSync(outDir, { recursive: true });
const reports = readReports();
const results = aggregate(reports);
fs.writeFileSync(path.join(outDir, 'RESULTS.md'), renderResultsMarkdown(results));
fs.writeFileSync(path.join(outDir, 'results.html'), renderResultsHtml(results));
console.log(`Wrote ${path.join(outDir, 'RESULTS.md')} and results.html from ${reports.length} run${reports.length === 1 ? '' : 's'}.`);
for (const line of atAGlance(results)) console.log(`\n${line.replace(/: /, ':\n  ').replace(/; /g, '\n  ')}`);
