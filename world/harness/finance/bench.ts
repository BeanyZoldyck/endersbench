// The finance benchmark loop without the command line: run every case and
// sample through a driver, score each with the verifier, and summarize. The
// CLI (run.ts) and the Apify Actor (actors/enders-bench) both run it, so a run
// started from either one is scored and saved the same way.
import Anthropic from '@anthropic-ai/sdk';
import { policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { FINANCE_BENCHMARK_VERSION, forVariant } from '../../spacetimedb/src/finance/scenarios';
import type { Scenario, Verdict, Violation } from '../../spacetimedb/src/finance/types';
import { type Gate, compliantByRun, gateCase, gateScore, passAllRuns } from '../../spacetimedb/src/finance/gate';
import { checkTools, toolScore } from '../../spacetimedb/src/finance/toolcheck';
import { ethicsScore, verify, verifyPair } from '../../spacetimedb/src/finance/verifier';
import { type CaseRun, type Effort, type OpenAiApi, type RunCase, messagesDriver, openAiDriver, scriptDriver } from './drivers';
import { type LiveCrs, crsSummary } from './crslive';
import { rawCrs } from './rawcrs';

// USD per million tokens, list prices on Oct 24 2026; only for the estimate.
// Cache writes (5 minute) bill at 1.25x input.
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  // Cache reads assumed at 0.1x input.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export type Driver = 'messages' | 'managed' | 'script';

export interface BenchOptions {
  variant: string;
  provider: string;
  model: string;
  effort?: Effort;
  cases: Scenario[];
  concurrency: number;
  repeat: number;
  raw: boolean;
  live: boolean;
}

export interface Scored {
  scenario: Scenario;
  sample: number;
  run: CaseRun;
  verdict: Verdict;
  gate: Gate;
  pair: Violation[];
}

const NO_USAGE = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

// A model to call: Claude through the Messages API, or any OpenAI-compatible endpoint.
export type ModelAccess =
  | { kind: 'anthropic'; client: Anthropic }
  | { kind: 'openai'; baseUrl: string; apiKey: string; api?: OpenAiApi };

// Claude from a key alone, for callers that don't carry their own copy of the SDK.
export const anthropicAccess = (apiKey: string): ModelAccess => ({ kind: 'anthropic', client: new Anthropic({ apiKey }) });

// The driver for one run: Script A with no model, or the benchmark loop
// against a model. Managed Agents sessions are set up by the CLI only.
export function benchRunCase(driver: 'script' | 'messages', opts: BenchOptions, access: ModelAccess | null, live?: LiveCrs): RunCase {
  const raw = opts.raw ? rawCrs : undefined;
  if (driver === 'script') {
    return live
      ? scriptDriver(policyFollower, { raw, live })
      : async scenario => ({ steps: runBrain(policyFollower, scenario, { raw }), notes: [], stalls: 0, usage: { ...NO_USAGE } });
  }
  if (!access) throw new Error('the benchmark loop needs a model to call');
  return access.kind === 'openai'
    ? openAiDriver({ baseUrl: access.baseUrl, apiKey: access.apiKey, model: opts.model, api: access.api, reasoningEffort: opts.effort, raw, live })
    : messagesDriver(access.client, { model: opts.model, effort: opts.effort, raw, live });
}

async function pool<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await work(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Every case and sample, in run order. onStart hears when a case begins; onCase
// hears about each one once it is final: scored, and for the second case of a pair, compared with its twin.
// Cases finish out of order, so a pair's second case waits for its first.
export async function runCases(
  runCase: RunCase,
  opts: BenchOptions,
  hooks: { onStart?: (index: number) => void | Promise<void>; onCase?: (c: Scored, index: number) => void | Promise<void>; onError?: (scenario: Scenario, message: string) => void } = {}
): Promise<Scored[]> {
  // Scored as this prompt variant sees the case (v6, forVariant).
  const items = Array.from({ length: opts.repeat }, (_, sample) => opts.cases.map(scenario => ({ scenario: forVariant(scenario, opts.variant), sample }))).flat();
  const done: (Scored | undefined)[] = new Array(items.length);
  const reported = new Set<number>();
  // A twin's unequal treatment is charged to the second case of the pair, within one sample.
  const twinOf = (i: number) => {
    const { scenario, sample } = items[i];
    return scenario.pairId ? items.slice(0, i).findIndex(o => o.sample === sample && o.scenario.pairId === scenario.pairId) : -1;
  };
  const report = async () => {
    for (let i = 0; i < items.length; i++) {
      const c = done[i];
      if (!c || reported.has(i)) continue;
      const twin = twinOf(i);
      if (twin >= 0 && !done[twin]) continue;
      if (twin >= 0) c.pair = verifyPair({ scenario: done[twin]!.scenario, steps: done[twin]!.run.steps }, { scenario: c.scenario, steps: c.run.steps });
      reported.add(i);
      await hooks.onCase?.(c, i);
    }
  };
  await pool(items, opts.concurrency, async ({ scenario, sample }, i) => {
    let run: CaseRun;
    await hooks.onStart?.(i);
    try {
      run = await runCase(scenario, opts.variant);
    } catch (err) {
      // One failed case should not sink the run; it scores as no decision.
      const message = err instanceof Error ? err.message : String(err);
      hooks.onError?.(scenario, message);
      run = { steps: [], notes: [], stalls: 0, stopped: `error: ${message.slice(0, 200)}`, usage: { ...NO_USAGE } };
    }
    done[i] = { scenario, sample, run, verdict: verify(scenario, run.steps), gate: gateCase(scenario, run.steps), pair: [] };
    await report();
  });
  return done as Scored[];
}

// Same numbers as the desk viewer's scoreboard.
export function summarize(scored: Scored[], model: string, live: boolean) {
  const all = (c: Scored) => [...c.verdict.violations, ...c.pair];
  const violations = scored.flatMap(all);
  const usage = scored.reduce(
    (u, c) => ({
      calls: u.calls + c.run.usage.calls,
      inputTokens: u.inputTokens + c.run.usage.inputTokens,
      outputTokens: u.outputTokens + c.run.usage.outputTokens,
      cacheReadTokens: u.cacheReadTokens + c.run.usage.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens + c.run.usage.cacheWriteTokens,
      listCostUsd: u.listCostUsd + (c.run.usage.listCostUsd ?? 0),
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, listCostUsd: 0 }
  );
  const price = PRICES[model];
  const estimatedUsd = price
    ? (usage.inputTokens * price.input + usage.cacheWriteTokens * price.input * 1.25 + usage.cacheReadTokens * price.cacheRead + usage.outputTokens * price.output) / 1e6
    : null;
  return {
    // The headline: outcome, process and output all pass.
    gate: gateScore(scored.map(c => c.gate)),
    // The same per run, for mean and range, and pass^k over the runs.
    byRun: compliantByRun(scored.map(c => ({ sample: c.sample, gate: c.gate }))),
    passAll: passAllRuns(scored.map(c => ({ id: c.scenario.id, gate: c.gate }))),
    // Tool choice alone: required checks called, and calls it had no business making.
    tools: toolScore(scored.map(c => checkTools(c.scenario, c.run.steps))),
    cases: scored.length,
    correct: scored.filter(c => c.verdict.outcome === 'correct').length,
    noDecision: scored.filter(c => c.verdict.outcome === 'no_decision').length,
    byTier: [1, 2, 3, 4].map(t => violations.filter(v => v.tier === t).length),
    ethics: scored.length ? scored.reduce((sum, c) => sum + ethicsScore(all(c)), 0) / scored.length : null,
    caved: `${scored.filter(c => c.verdict.caved === true).length}/${scored.filter(c => c.verdict.caved != null).length}`,
    updated: `${scored.filter(c => c.verdict.updated === true).length}/${scored.filter(c => c.verdict.updated != null).length}`,
    honestReports: `${scored.filter(c => c.verdict.honestReport === true).length}/${scored.filter(c => c.verdict.honestReport != null).length}`,
    stalls: scored.reduce((n, c) => n + c.run.stalls, 0),
    stopped: scored.filter(c => c.run.stopped).map(c => `${c.scenario.id}: ${c.run.stopped}`),
    usage,
    costUsd: usage.listCostUsd > 0 ? usage.listCostUsd : estimatedUsd,
    // Live runs: the CRS calls behind the cases, and any drift from the snapshot.
    ...(live ? { crs: crsSummary(scored.map(c => c.run.steps)) } : {}),
  };
}

export type Summary = ReturnType<typeof summarize>;

// The saved run file: what finance:leaderboard, finance:label and
// finance:recording read.
export function savedRecord(opts: BenchOptions, results: { driver: Driver; summary: Summary; runs: Scored[] }[]) {
  return {
    config: {
      benchmarkVersion: FINANCE_BENCHMARK_VERSION,
      provider: opts.provider,
      model: opts.model,
      effort: opts.effort ?? 'default',
      variant: opts.variant,
      crsFormat: opts.raw ? 'raw' : 'card',
      crsSource: opts.live ? 'live' : 'snapshot',
      cases: opts.cases.map(c => c.id),
      repeat: opts.repeat,
    },
    results: results.map(r => ({
      driver: r.driver,
      summary: r.summary,
      cases: r.runs.map(c => ({ id: c.scenario.id, sample: c.sample, verdict: c.verdict, gate: c.gate, pair: c.pair, ...c.run })),
    })),
  };
}

export type SavedRecord = ReturnType<typeof savedRecord>;
