// What the site lets a visitor start. The site's own input (set by us in the
// Console, keys stored encrypted) lists the models on offer; a visitor only
// picks from that list, so a public Run button can't spend more than we allow.
import { createHash, timingSafeEqual } from 'node:crypto';
import { FINANCE_PROMPT_VARIANTS, HEADLINE_VARIANT } from '../../../spacetimedb/src/finance/prompt';
import { CASE_SETS, PROVIDERS } from '../../enders-bench/src/input';
import { lobbyModels } from './clearing';

export interface SiteModel {
  id: string;
  label: string;
  provider: string;
  model?: string;
  baseUrl?: string;
  effort?: string;
  // The setup page's model this entry is (shared/models.ts), and for a custom
  // endpoint the provider:model the database asks in a Clearing run.
  lobby?: string;
  database?: string;
}

export interface SiteInput {
  benchActor?: string;
  models?: SiteModel[];
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  bitdeerApiKey?: string;
  featherlessApiKey?: string;
  customApiKey?: string;
  customBaseUrl?: string;
  caseSets?: string[];
  crsLive?: boolean;
  crsUsername?: string;
  crsPassword?: string;
  maxRunsPerHour?: number;
  benchMemoryMbytes?: number;
  benchTimeoutSecs?: number;
  spacetimeToken?: string;
  spacetimeHost?: string;
  spacetimeDb?: string;
  clearingRunsPerHour?: number;
  clearingTimeScale?: number;
  clearingMaxMinutes?: number;
  runPassword?: string;
}

export const POLICY_SCRIPT: SiteModel = { id: 'script', label: 'Policy reference script (no model)', provider: 'script' };

export class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function siteConfig(raw: unknown) {
  const input = (raw && typeof raw === 'object' ? raw : {}) as SiteInput;
  const keys: Record<string, string> = {
    anthropic: text(input.anthropicApiKey),
    openai: text(input.openaiApiKey),
    openrouter: text(input.openrouterApiKey),
    bitdeer: text(input.bitdeerApiKey),
    featherless: text(input.featherlessApiKey),
    custom: text(input.customApiKey),
  };
  const listed = Array.isArray(input.models) && input.models.length ? input.models : [POLICY_SCRIPT];
  const models = listed.map((m, i) => {
    const id = text(m?.id) || `model-${i + 1}`;
    const provider = text(m?.provider);
    if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) throw new Error(`Model "${id}": provider must be one of ${PROVIDERS.join(', ')}.`);
    if (provider !== 'script' && !text(m.model)) throw new Error(`Model "${id}" needs a model id.`);
    if (provider !== 'script' && provider !== 'custom' && !keys[provider]) throw new Error(`Model "${id}" needs the ${provider} API key in the site's input.`);
    const baseUrl = text(m.baseUrl) || (provider === 'custom' ? text(input.customBaseUrl) : '');
    if (provider === 'custom' && !baseUrl) throw new Error(`Model "${id}" needs a base URL, or set customBaseUrl.`);
    return { id, label: text(m.label) || (provider === 'script' ? POLICY_SCRIPT.label : `${provider}:${m.model}`), provider, model: text(m.model), baseUrl, effort: text(m.effort) };
  });
  if (new Set(models.map(m => m.id)).size !== models.length) throw new Error('Model ids must be unique.');
  const caseSets = (Array.isArray(input.caseSets) && input.caseSets.length ? input.caseSets : ['quick', 'held-out']).map(text);
  for (const id of caseSets) if (!CASE_SETS[id]) throw new Error(`Unknown case set "${id}". Choose from ${Object.keys(CASE_SETS).join(', ')}.`);
  const crsLive = input.crsLive === true;
  if (crsLive && (!text(input.crsUsername) || !text(input.crsPassword))) throw new Error('Live CRS needs crsUsername and crsPassword.');
  const spacetimeToken = text(input.spacetimeToken);
  return {
    benchActor: text(input.benchActor),
    models,
    keys,
    caseSets,
    crs: crsLive ? { username: text(input.crsUsername), password: text(input.crsPassword) } : null,
    maxRunsPerHour: Math.max(1, Math.min(60, Number(input.maxRunsPerHour) || 10)),
    benchMemoryMbytes: Number(input.benchMemoryMbytes) || 512,
    benchTimeoutSecs: Number(input.benchTimeoutSecs) || 3600,
    lobby: lobbyModels(listed),
    // The shared world the setup page's Clearing runs start on. Without a token the Clearing is offered as unavailable.
    spacetime: spacetimeToken ? { host: text(input.spacetimeHost) || 'https://maincloud.spacetimedb.com', database: text(input.spacetimeDb) || 'endersbench', token: spacetimeToken } : null,
    clearingRunsPerHour: Math.max(1, Math.min(30, Number(input.clearingRunsPerHour) || 4)),
    clearingTimeScale: Math.max(0.05, Math.min(4, Number(input.clearingTimeScale) || 0.5)),
    clearingMaxMinutes: Math.max(2, Math.min(120, Number(input.clearingMaxMinutes) || 20)),
    runPassword: text(input.runPassword),
  };
}

export type SiteConfig = ReturnType<typeof siteConfig>;

// What the browser may know: names to pick from, never keys or endpoints.
export function publicConfig(cfg: SiteConfig) {
  return {
    models: cfg.models.map(m => ({ id: m.id, label: m.label })),
    variants: FINANCE_PROMPT_VARIANTS,
    defaultVariant: HEADLINE_VARIANT,
    caseSets: cfg.caseSets.map(id => ({ id, label: CASE_SETS[id].label, count: CASE_SETS[id].ids().length })),
    crs: cfg.crs ? 'live' : 'snapshot',
  };
}

// A visitor's request, checked against the allow-list, as the bench Actor's input.
export function benchInput(cfg: SiteConfig, body: unknown) {
  const request = (body && typeof body === 'object' ? body : {}) as { model?: unknown; variant?: unknown; caseSet?: unknown };
  const model = cfg.models.find(m => m.id === text(request.model)) ?? (() => { throw new RequestError('Pick one of the listed models.'); })();
  const variant = text(request.variant) || HEADLINE_VARIANT;
  if (!FINANCE_PROMPT_VARIANTS.includes(variant)) throw new RequestError('Pick one of the listed policies.');
  const caseSet = text(request.caseSet) || cfg.caseSets[0];
  if (!cfg.caseSets.includes(caseSet)) throw new RequestError('Pick one of the listed case sets.');
  return {
    label: model.label,
    input: {
      benchmark: 'finance-desk',
      provider: model.provider,
      ...(model.provider === 'script' ? {} : { model: model.model, apiKey: cfg.keys[model.provider] || undefined }),
      ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
      ...(model.effort ? { effort: model.effort } : {}),
      variant,
      caseSet,
      repeat: 1,
      concurrency: 3,
      crsSource: cfg.crs ? 'live' : 'snapshot',
      ...(cfg.crs ? { crsUsername: cfg.crs.username, crsPassword: cfg.crs.password } : {}),
      // The site reads the recording from storage, so the run needn't stay open.
      viewerMinutes: 0,
    },
  };
}

// At most one run at a time and a few per hour, whoever presses the button.
export class RunLimiter {
  private started: number[] = [];
  constructor(private perHour: number, private now = () => Date.now()) {}
  check(): string | null {
    const hourAgo = this.now() - 3_600_000;
    this.started = this.started.filter(t => t > hourAgo);
    if (this.started.length >= this.perHour) {
      const wait = Math.ceil((this.started[0] + 3_600_000 - this.now()) / 60_000);
      return `This site has started its ${this.perHour} runs for the hour. Try again in ${wait} min.`;
    }
    return null;
  }
  record() {
    this.started.push(this.now());
  }
}

// Starting a run spends the site's keys, so with a run password set only
// people who know it can; anyone can still browse, replay and watch. A few
// wrong guesses an hour per address, compared in constant time.
export class PasswordGuard {
  private misses = new Map<string, number[]>();
  constructor(private password: string, private perHour = 10, private now = () => Date.now()) {}
  get required() {
    return this.password !== '';
  }
  check(given: string | undefined, address: string) {
    if (!this.required) return;
    const hourAgo = this.now() - 3_600_000;
    const recent = (this.misses.get(address) ?? []).filter(t => t > hourAgo);
    if (recent.length >= this.perHour) throw new RequestError('Too many wrong passwords. Try again in an hour.', 429);
    const typed = (given ?? '').trim();
    if (!typed) throw new RequestError('Starting a run needs the run password.', 401);
    const digest = (s: string) => createHash('sha256').update(s).digest();
    if (!timingSafeEqual(digest(typed), digest(this.password))) {
      this.misses.set(address, [...recent, this.now()]);
      throw new RequestError('Wrong run password.', 401);
    }
  }
}
