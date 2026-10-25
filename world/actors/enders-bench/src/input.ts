// The Actor's input form, read into a benchmark run. Kept apart from the
// Apify SDK so the rules can be tested; main.ts does the platform work.
import { FINANCE_PROMPT_VARIANTS, HEADLINE_VARIANT } from '../../../spacetimedb/src/finance/prompt';
import { SCENARIOS, SCENARIO_BY_ID } from '../../../spacetimedb/src/finance/scenarios';
import { TEST_CASES } from '../../../harness/finance/labels';
import type { BenchOptions } from '../../../harness/finance/bench';
import type { Effort, OpenAiApi } from '../../../harness/finance/drivers';

export const BENCHMARKS = ['finance-desk'] as const;
export const PROVIDERS = ['script', 'anthropic', 'openai', 'openrouter', 'custom'] as const;
export type Provider = (typeof PROVIDERS)[number];
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_REPLAY_STORE = 'endersbench-replays';

// The seven-case tour the live desk opens with (harness/finance/live.ts).
export const QUICK_CASES = ['lend-old-checklist', 'lend-credit-freeze', 'collect-chapter13', 'lend-subprime-pushback', 'lend-no-file-new-evidence', 'lend-hide-from-audit', 'vendor-genuine-change'];
export const CASE_SETS: Record<string, { label: string; ids: () => string[] }> = {
  quick: { label: 'Quick tour', ids: () => QUICK_CASES },
  'held-out': { label: 'Held-out test', ids: () => TEST_CASES },
  all: { label: 'Every case', ids: () => SCENARIOS.map(s => s.id) },
};

const OPENAI_BASE: Record<string, { baseUrl: string; api?: OpenAiApi }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', api: 'responses' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1' },
};

export interface ActorInput {
  benchmark?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  effort?: string;
  variant?: string;
  caseSet?: string;
  caseIds?: string[];
  repeat?: number;
  concurrency?: number;
  crsSource?: string;
  crsUsername?: string;
  crsPassword?: string;
  crsFormat?: string;
  viewerMinutes?: number;
  replayStore?: string;
}

export type Access = { kind: 'anthropic'; apiKey: string } | { kind: 'openai'; baseUrl: string; apiKey: string; api?: OpenAiApi };

export interface Plan {
  benchmark: (typeof BENCHMARKS)[number];
  driver: 'script' | 'messages';
  opts: BenchOptions;
  access: Access | null;
  crs: { username: string; password: string } | null;
  // What the results call the agent: script:policy, or provider:model.
  agent: string;
  viewerMinutes: number;
  replayStore: string;
}

export class InputError extends Error {}

const fail = (message: string): never => {
  throw new InputError(message);
};
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
function whole(v: unknown, name: string, fallback: number, min: number, max: number) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

export function planFromInput(raw: unknown): Plan {
  const input = (raw && typeof raw === 'object' ? raw : {}) as ActorInput;
  const benchmark = (text(input.benchmark) || 'finance-desk') as Plan['benchmark'];
  if (!BENCHMARKS.includes(benchmark)) fail(`Unknown benchmark "${benchmark}". Choose one of: ${BENCHMARKS.join(', ')}.`);

  const provider = (text(input.provider) || 'script') as Provider;
  if (!PROVIDERS.includes(provider)) fail(`Unknown provider "${provider}". Choose one of: ${PROVIDERS.join(', ')}.`);
  const model = provider === 'script' ? 'policy' : text(input.model) || fail('Model is required unless the provider is the policy script.');
  const apiKey = text(input.apiKey);
  let access: Access | null = null;
  if (provider === 'anthropic') access = { kind: 'anthropic', apiKey: apiKey || fail('Claude models need an Anthropic API key.') };
  else if (provider === 'openai' || provider === 'openrouter')
    access = { kind: 'openai', ...OPENAI_BASE[provider], apiKey: apiKey || fail(`${provider === 'openai' ? 'OpenAI' : 'OpenRouter'} models need an API key.`) };
  else if (provider === 'custom') {
    const baseUrl = text(input.baseUrl) || fail('A custom provider needs the base URL of its OpenAI-compatible API, ending in /v1.');
    if (!/^https?:\/\//.test(baseUrl)) fail('The base URL must start with https:// or http://.');
    access = { kind: 'openai', baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
  }

  // 'default' (or nothing) leaves the model at its own setting.
  const effort = (text(input.effort) === 'default' ? '' : text(input.effort)) as Effort | '';
  if (effort && !EFFORTS.includes(effort)) fail(`Effort must be default or one of: ${EFFORTS.join(', ')}.`);
  const variant = text(input.variant) || HEADLINE_VARIANT;
  if (!FINANCE_PROMPT_VARIANTS.includes(variant)) fail(`Unknown policy "${variant}". Choose one of: ${FINANCE_PROMPT_VARIANTS.join(', ')}.`);

  const caseSet = text(input.caseSet) || 'held-out';
  let ids: string[];
  if (caseSet === 'custom') {
    ids = (input.caseIds ?? []).map(text).filter(Boolean);
    if (!ids.length) fail('List at least one case id, or choose a case set.');
    const unknown = ids.filter(id => !SCENARIO_BY_ID[id]);
    if (unknown.length) fail(`Unknown case id${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`);
  } else ids = CASE_SETS[caseSet]?.ids() ?? fail(`Unknown case set "${caseSet}". Choose one of: ${[...Object.keys(CASE_SETS), 'custom'].join(', ')}.`);

  const crsSource = text(input.crsSource) || 'snapshot';
  if (crsSource !== 'snapshot' && crsSource !== 'live') fail('CRS data is "snapshot" or "live".');
  const crs = crsSource === 'live'
    ? { username: text(input.crsUsername) || fail('Live CRS needs the CRS sandbox username.'), password: text(input.crsPassword) || fail('Live CRS needs the CRS sandbox password.') }
    : null;
  const crsFormat = text(input.crsFormat) || 'card';
  if (crsFormat !== 'card' && crsFormat !== 'raw') fail('CRS format is "card" or "raw".');

  return {
    benchmark,
    driver: provider === 'script' ? 'script' : 'messages',
    opts: {
      variant,
      provider,
      model,
      effort: effort || undefined,
      cases: [...new Set(ids)].map(id => SCENARIO_BY_ID[id]),
      concurrency: whole(input.concurrency, 'Concurrency', 3, 1, 8),
      repeat: whole(input.repeat, 'Runs per case', 1, 1, 10),
      raw: crsFormat === 'raw',
      live: crs !== null,
    },
    access,
    crs,
    agent: provider === 'script' ? 'script:policy' : `${provider}:${model}`,
    viewerMinutes: whole(input.viewerMinutes, 'Viewer minutes', 5, 0, 60),
    // A named store keeps recordings after the run's own storage expires; empty skips it.
    replayStore: input.replayStore === undefined ? DEFAULT_REPLAY_STORE : text(input.replayStore),
  };
}
