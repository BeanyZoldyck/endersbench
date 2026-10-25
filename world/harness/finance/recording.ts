// Turns a saved finance:bench run into a Ledger Street recording, so a run
// made outside the SpacetimeDB desk, such as one on live CRS data, plays in
// the viewer like a recorded desk run: the same case, step and verdict rows
// the module writes, with each CRS step's live call kept. No API is called.
//
//   npm run finance:recording -- harness/finance/runs/<run>.json public/replays/<name>.json
//
// A script-driver run is labelled script:policy (Script A), never as the
// model named in its file.
import fs from 'node:fs';
import path from 'node:path';
import type { Gate } from '../../spacetimedb/src/finance/gate';
import { SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import type { Step, Verdict } from '../../spacetimedb/src/finance/types';

interface SavedRun {
  config: { benchmarkVersion: number; provider: string; model: string; effort?: string; variant: string; crsFormat?: string; crsSource?: string };
  results: { driver: string; cases: { id: string; sample: number; steps: Step[]; verdict: Verdict; gate: Gate; stalls?: number; stopped?: string }[] }[];
}

const big = (n: number | bigint) => ({ $big: String(n) });

export function recordingFromRun(run: SavedRun, source: string, recordedAt: string) {
  const result = run.results[0];
  const modelId = result.driver === 'script' ? 'script:policy' : `${run.config.provider}:${run.config.model}`;
  // The viewer orders comparisons by queue time, newest first; keep the run's case order.
  const start = BigInt(Date.parse(recordedAt)) * 1000n;
  const cases = result.cases.map((c, i) => ({
    id: big(i + 1),
    scenarioId: c.id,
    seat: SCENARIO_BY_ID[c.id].seat,
    modelId,
    variant: run.config.variant,
    sample: c.sample,
    benchmarkVersion: run.config.benchmarkVersion,
    status: 'closed',
    pendingRequestId: big(0),
    stalls: c.stalls ?? 0,
    stopped: c.stopped ?? '',
    queuedAt: { $ts: String(start - BigInt(i)) },
  }));
  let stepId = 0;
  const steps = result.cases.flatMap((c, i) =>
    c.steps.map((s, seq) => ({
      id: big(++stepId),
      caseId: big(i + 1),
      seq,
      tool: s.tool,
      args: JSON.stringify(s.args),
      result: s.result === undefined ? '' : JSON.stringify(s.result),
      requestId: big(0),
      thought: '',
      crs: s.crs ? JSON.stringify(s.crs) : '',
    }))
  );
  const verdicts = result.cases.map((c, i) => ({
    caseId: big(i + 1),
    pass: c.gate.pass,
    outcome: c.gate.outcome,
    process: c.gate.process,
    output: c.gate.output,
    harm: c.gate.harm,
    abstained: c.gate.abstained,
    actionNeeded: c.gate.actionNeeded,
    decision: c.verdict.decision ?? '',
    failures: JSON.stringify(c.gate.failures),
    verdict: JSON.stringify(c.verdict),
  }));
  return {
    version: 1,
    source,
    settings: { model: modelId, driver: result.driver, effort: run.config.effort ?? 'default', variant: run.config.variant, benchmarkVersion: run.config.benchmarkVersion, crsFormat: run.config.crsFormat ?? 'card', crsSource: run.config.crsSource ?? 'snapshot' },
    recordedAt,
    timing: 'paced',
    stepMs: 2200,
    cases,
    steps,
    verdicts,
  };
}

function main() {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) throw new Error('usage: npm run finance:recording -- <run.json> <recording.json>');
  const run = JSON.parse(fs.readFileSync(from, 'utf-8')) as SavedRun;
  const calls = run.results[0].cases.flatMap(c => c.steps).filter(s => s.crs);
  const recordedAt = calls[0]?.crs?.at ?? fs.statSync(from).mtime.toISOString();
  const source = `finance:bench ${path.basename(from)} · CRS ${run.config.crsSource ?? 'snapshot'}`;
  fs.writeFileSync(to, JSON.stringify(recordingFromRun(run, source, recordedAt)));
  console.log(`Wrote ${to}: ${run.results[0].cases.length} cases, ${calls.length} CRS calls recorded`);
}

if (process.argv[1]?.endsWith('finance-recording.js')) main();
