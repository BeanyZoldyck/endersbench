import { describe, expect, it } from 'vitest';
import { PasswordGuard, RequestError, RunLimiter, benchInput, lineupInputs, publicConfig, siteConfig } from './runs';

describe('PasswordGuard', () => {
  it('lets anyone start when no password is set', () => {
    expect(() => new PasswordGuard('').check(undefined, 'ip')).not.toThrow();
  });

  it('asks for the password, refuses a wrong one, and takes the right one', () => {
    const guard = new PasswordGuard('quiet-harbor-27');
    expect(() => guard.check(undefined, 'ip')).toThrow(expect.objectContaining({ status: 401, message: expect.stringContaining('needs the run password') }));
    expect(() => guard.check('quiet-harbor-26', 'ip')).toThrow('Wrong run password');
    expect(() => guard.check(' quiet-harbor-27 ', 'ip')).not.toThrow();
  });

  it('locks out an address after ten wrong guesses in an hour, but not others', () => {
    let now = 0;
    const guard = new PasswordGuard('pw', 10, () => now);
    for (let i = 0; i < 10; i++) expect(() => guard.check('nope', 'a')).toThrow('Wrong run password');
    expect(() => guard.check('pw', 'a')).toThrow(expect.objectContaining({ status: 429 }));
    expect(() => guard.check('pw', 'b')).not.toThrow();
    now = 3_600_001;
    expect(() => guard.check('pw', 'a')).not.toThrow();
  });
});

const keys = { anthropicApiKey: 'sk-ant', bitdeerApiKey: 'bd-key', customBaseUrl: 'https://runpod.test/v1', customApiKey: 'rp' };
const models = [
  { id: 'script', label: 'Policy script', provider: 'script' },
  { id: 'haiku', label: 'Claude Haiku 5.5', provider: 'anthropic', model: 'claude-haiku-5-5' },
  { id: 'ft', label: 'Fine-tuned Qwen3.8-27B', provider: 'custom', model: 'qwen38-27b-lora' },
  { id: 'glm', label: 'GLM-5.3 (Bitdeer)', provider: 'bitdeer', model: 'zai-org/GLM-5.3' },
];

describe('siteConfig', () => {
  it('offers only the policy script until models are listed', () => {
    const cfg = siteConfig({});
    expect(cfg.models.map(m => m.provider)).toEqual(['script']);
    expect(cfg.caseSets).toEqual(['quick', 'held-out']);
  });

  it('starts Clearing runs on Maincloud only with a SpacetimeDB token, and keeps the lobby mapping', () => {
    expect(siteConfig({}).spacetime).toBeNull();
    const cfg = siteConfig({ models: [{ ...models[1], lobby: 'Claude 5.5' }], ...keys, spacetimeToken: ' tok ' });
    expect(cfg.spacetime).toEqual({ host: 'https://maincloud.spacetimedb.com', database: 'endersbench', token: 'tok' });
    expect(cfg.lobby.get('Claude 5.5')).toMatchObject({ siteId: 'haiku', databaseId: 'anthropic:claude-haiku-5-5' });
    expect(cfg).toMatchObject({ clearingRunsPerHour: 4, clearingTimeScale: 0.5, clearingMaxMinutes: 20 });
  });

  it('leaves out a model it has no key or endpoint for, and refuses a broken list', () => {
    const cfg = siteConfig({ models, anthropicApiKey: 'sk-ant' });
    expect(cfg.models.map(m => m.id)).toEqual(['script', 'haiku']);
    expect(cfg.skipped).toEqual(['ft (needs a base URL (or customBaseUrl))', 'glm (needs the bitdeer API key)']);
    expect(() => siteConfig({ models: [{ id: 'x', provider: 'gemini', model: 'g' }] })).toThrow('provider must be');
    expect(() => siteConfig({ caseSets: ['everything'] })).toThrow('Unknown case set');
  });

  it('offers models.json from the image over the input\'s list, Grok on xAI for Ledger Street only, and old lobby names', () => {
    const cfg = siteConfig({ models: [models[0]], xaiApiKey: 'xk', ...keys }, [
      { id: 'grok', label: 'Grok 4.7 (xAI)', provider: 'xai', model: 'grok-4.7', lobby: 'Grok' },
      { id: 'abliterated', label: 'Retep', provider: 'custom', model: 'abliterated', baseUrl: 'https://runpod.test/v1', lobby: 'Abliterated', database: 'abliterated:abliterated' },
      { id: 'glm-flash', label: 'GLM-5.3-Flash', provider: 'bitdeer', model: 'zai-org/GLM-5.3-Flash', lobby: 'GLM 5.3 Flash' },
    ]);
    expect(cfg.models.map(m => m.id)).toEqual(['grok', 'abliterated', 'glm-flash']);
    expect(cfg.lobby.get('Grok')).toMatchObject({ modelId: 'xai:grok-4.7', databaseId: '' });
    expect(cfg.lobby.get('Retep')).toMatchObject({ siteId: 'abliterated', databaseId: 'abliterated:abliterated' });
    expect([...cfg.lobby.keys()]).toEqual(['Grok', 'Retep']);
    expect(benchInput(cfg, { model: 'grok' }).input).toMatchObject({ provider: 'xai', model: 'grok-4.7', apiKey: 'xk' });
  });

  it('tells the browser names, never keys or endpoints', () => {
    const shown = JSON.stringify(publicConfig(siteConfig({ models, ...keys })));
    expect(shown).toContain('Fine-tuned Qwen3.8-27B');
    for (const secret of ['sk-ant', 'bd-key', 'runpod.test', 'rp"']) expect(shown).not.toContain(secret);
  });
});

describe('benchInput', () => {
  const cfg = siteConfig({ models, ...keys, crsLive: true, crsUsername: 'u', crsPassword: 'p' });

  it('turns a pick from the list into the bench Actor\'s input', () => {
    expect(benchInput(cfg, { model: 'ft', variant: 'no-charter', caseSet: 'held-out' })).toEqual({
      label: 'Fine-tuned Qwen3.8-27B',
      input: { benchmark: 'finance-desk', provider: 'custom', model: 'qwen38-27b-lora', apiKey: 'rp', baseUrl: 'https://runpod.test/v1', variant: 'no-charter', caseSet: 'held-out', repeat: 1, concurrency: 3, crsSource: 'live', crsUsername: 'u', crsPassword: 'p', viewerMinutes: 0 },
    });
    expect(benchInput(cfg, { model: 'glm' }).input).toMatchObject({ provider: 'bitdeer', model: 'zai-org/GLM-5.3', apiKey: 'bd-key' });
    expect(benchInput(cfg, { model: 'glm' }).input).not.toHaveProperty('baseUrl');
    expect(benchInput(cfg, { model: 'script' }).input).not.toHaveProperty('apiKey');
  });

  it('rejects anything off the list', () => {
    expect(() => benchInput(cfg, { model: 'gpt-anything' })).toThrow(RequestError);
    expect(() => benchInput(cfg, { model: 'script', variant: 'win-at-all-costs' })).toThrow('listed policies');
    expect(() => benchInput(cfg, { model: 'script', caseSet: 'all' })).toThrow('listed case sets');
  });
});

describe('lineupInputs', () => {
  const cfg = siteConfig({ models, ...keys });

  it('starts one bench run per agent, with the same policy and cases', () => {
    const runs = lineupInputs(cfg, { models: ['ft', 'haiku', 'glm'], variant: 'no-charter', caseSet: 'quick' });
    expect(runs.map(r => r.label)).toEqual(['Fine-tuned Qwen3.8-27B', 'Claude Haiku 5.5', 'GLM-5.3 (Bitdeer)']);
    expect(runs.every(r => r.input.variant === 'no-charter' && r.input.caseSet === 'quick' && r.input.repeat === 1)).toBe(true);
    expect(lineupInputs(cfg, { model: 'haiku' })).toHaveLength(1);
  });

  it('runs an agent picked twice twice over', () => {
    expect(lineupInputs(cfg, { models: [{ model: 'ft', count: 2 }, { model: 'haiku', count: 2 }] }).map(r => r.input.repeat)).toEqual([2, 2]);
  });

  it('holds a lineup to four agents, each once, all on the list', () => {
    expect(() => lineupInputs(cfg, { models: ['ft', 'haiku', 'glm', 'script', 'ft'] })).toThrow('each agent once');
    expect(() => lineupInputs(cfg, { models: [{ model: 'ft', count: 3 }, { model: 'haiku', count: 2 }] })).toThrow('up to 4 agents');
    expect(() => lineupInputs(cfg, { models: [] })).toThrow('at least one agent');
    expect(() => lineupInputs(cfg, { models: ['ft', 'gpt-anything'] })).toThrow('listed models');
  });
});

describe('RunLimiter', () => {
  it('allows a few runs an hour', () => {
    let now = 0;
    const limiter = new RunLimiter(2, () => now);
    expect(limiter.check()).toBeNull();
    limiter.record();
    now += 60_000;
    limiter.record();
    expect(limiter.check()).toMatch(/2 runs for the hour\. Try again in 59 min/);
    now = 3_600_001;
    expect(limiter.check()).toBeNull();
  });
});
