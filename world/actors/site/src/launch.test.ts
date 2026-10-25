import { describe, expect, it } from 'vitest';
import { fieldReport, parseEnv, siteInputFromEnv } from './launch';
import { siteConfig } from './runs';

const models = [
  { id: 'script', label: 'Policy script', provider: 'script' },
  { id: 'haiku', label: 'Claude Haiku 5.5', provider: 'anthropic', model: 'claude-haiku-5-5' },
  { id: 'ender', label: 'Ender', provider: 'custom', model: 'ender' },
  { id: 'glm', label: 'GLM-5.3', provider: 'bitdeer', model: 'zai-org/GLM-5.3' },
];

describe('parseEnv', () => {
  it('reads KEY=value lines, quotes, comments and export', () => {
    expect(parseEnv('# keys\nA=1\nexport B="two words"\nC=\'x=y\'\r\n\nbad line\nD=')).toEqual({ A: '1', B: 'two words', C: 'x=y', D: '' });
  });
});

describe('siteInputFromEnv', () => {
  const env = {
    ANTHROPIC_API_KEY: 'sk-ant', BITDEER_API_KEY: 'bd', ENDER_BASE_URL: 'https://runpod.test/v1', RUNPOD_API_KEY: 'rp',
    CRS_USERNAME: 'u', CRS_PASSWORD: 'p', OPENAI_API_KEY: '  ',
  };

  it('fills the site input from the harness\'s env names, and passes the site\'s own checks', () => {
    const input = siteInputFromEnv(env, models);
    expect(input).toEqual({
      models, anthropicApiKey: 'sk-ant', bitdeerApiKey: 'bd', customBaseUrl: 'https://runpod.test/v1', customApiKey: 'rp',
      crsLive: true, crsUsername: 'u', crsPassword: 'p',
    });
    expect(() => siteConfig(input)).not.toThrow();
  });

  it('prefers ENDER_API_KEY to RUNPOD_API_KEY, and leaves CRS off without both halves of the login', () => {
    const input = siteInputFromEnv({ ...env, ENDER_API_KEY: 'ek', CRS_PASSWORD: undefined }, models);
    expect(input.customApiKey).toBe('ek');
    expect(input.crsLive).toBe(false);
    expect(input).not.toHaveProperty('crsUsername');
  });

  it('lets the site\'s checks name a missing key', () => {
    expect(() => siteConfig(siteInputFromEnv({ ...env, BITDEER_API_KEY: undefined }, models))).toThrow('bitdeer API key');
  });

  it('reports which fields are set, never their values', () => {
    const report = fieldReport(siteInputFromEnv(env, models));
    expect(report).toContain('anthropicApiKey: set');
    expect(report).toContain('openaiApiKey: missing');
    for (const secret of ['sk-ant', 'runpod.test', 'rp', 'bd']) expect(report).not.toContain(` ${secret}`);
  });
});
