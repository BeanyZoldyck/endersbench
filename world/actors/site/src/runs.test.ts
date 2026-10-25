import { describe, expect, it } from 'vitest';
import { RequestError, RunLimiter, benchInput, publicConfig, siteConfig } from './runs';

const keys = { anthropicApiKey: 'sk-ant', customBaseUrl: 'https://runpod.test/v1', customApiKey: 'rp' };
const models = [
  { id: 'script', label: 'Policy script', provider: 'script' },
  { id: 'haiku', label: 'Claude Haiku 5.5', provider: 'anthropic', model: 'claude-haiku-5-5' },
  { id: 'ft', label: 'Fine-tuned Qwen3.8-27B', provider: 'custom', model: 'qwen38-27b-lora' },
];

describe('siteConfig', () => {
  it('offers only the policy script until models are listed', () => {
    const cfg = siteConfig({});
    expect(cfg.models.map(m => m.provider)).toEqual(['script']);
    expect(cfg.caseSets).toEqual(['quick', 'held-out']);
  });

  it('refuses a model it has no key or endpoint for', () => {
    expect(() => siteConfig({ models: [models[1]] })).toThrow('anthropic API key');
    expect(() => siteConfig({ models: [models[2]] })).toThrow('base URL');
    expect(() => siteConfig({ models: [{ id: 'x', provider: 'gemini', model: 'g' }] })).toThrow('provider must be');
    expect(() => siteConfig({ caseSets: ['everything'] })).toThrow('Unknown case set');
  });

  it('tells the browser names, never keys or endpoints', () => {
    const shown = JSON.stringify(publicConfig(siteConfig({ models, ...keys })));
    expect(shown).toContain('Fine-tuned Qwen3.8-27B');
    for (const secret of ['sk-ant', 'runpod.test', 'rp"']) expect(shown).not.toContain(secret);
  });
});

describe('benchInput', () => {
  const cfg = siteConfig({ models, ...keys, crsLive: true, crsUsername: 'u', crsPassword: 'p' });

  it('turns a pick from the list into the bench Actor\'s input', () => {
    expect(benchInput(cfg, { model: 'ft', variant: 'no-charter', caseSet: 'held-out' })).toEqual({
      label: 'Fine-tuned Qwen3.8-27B',
      input: { benchmark: 'finance-desk', provider: 'custom', model: 'qwen38-27b-lora', apiKey: 'rp', baseUrl: 'https://runpod.test/v1', variant: 'no-charter', caseSet: 'held-out', repeat: 1, concurrency: 3, crsSource: 'live', crsUsername: 'u', crsPassword: 'p', viewerMinutes: 0 },
    });
    expect(benchInput(cfg, { model: 'script' }).input).not.toHaveProperty('apiKey');
  });

  it('rejects anything off the list', () => {
    expect(() => benchInput(cfg, { model: 'gpt-anything' })).toThrow(RequestError);
    expect(() => benchInput(cfg, { model: 'script', variant: 'win-at-all-costs' })).toThrow('listed policies');
    expect(() => benchInput(cfg, { model: 'script', caseSet: 'all' })).toThrow('listed case sets');
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
