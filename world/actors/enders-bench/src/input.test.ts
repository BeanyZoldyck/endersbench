import { describe, expect, it } from 'vitest';
import { TEST_CASES } from '../../../harness/finance/labels';
import { DEFAULT_REPLAY_STORE, InputError, QUICK_CASES, planFromInput } from './input';

describe('planFromInput', () => {
  it('defaults to the policy script on the held-out cases, with no keys', () => {
    const plan = planFromInput({});
    expect(plan.driver).toBe('script');
    expect(plan.agent).toBe('script:policy');
    expect(plan.access).toBeNull();
    expect(plan.opts).toMatchObject({ variant: 'house-rules', repeat: 1, concurrency: 3, raw: false, live: false });
    expect(plan.opts.cases.map(c => c.id)).toEqual(TEST_CASES);
    expect(plan.viewerMinutes).toBe(5);
    expect(plan.replayStore).toBe(DEFAULT_REPLAY_STORE);
  });

  it('reads a Claude run', () => {
    const plan = planFromInput({ provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: ' sk-test ', effort: 'high', variant: 'charter', caseSet: 'quick', repeat: 3 });
    expect(plan.driver).toBe('messages');
    expect(plan.agent).toBe('anthropic:claude-sonnet-5-5');
    expect(plan.access).toEqual({ kind: 'anthropic', apiKey: 'sk-test' });
    expect(plan.opts).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'high', variant: 'charter', repeat: 3 });
    expect(plan.opts.cases.map(c => c.id)).toEqual(QUICK_CASES);
  });

  it('sends OpenAI through the Responses API and a custom endpoint through chat', () => {
    expect(planFromInput({ provider: 'openai', model: 'gpt-x', apiKey: 'k' }).access).toEqual({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', api: 'responses', apiKey: 'k' });
    expect(planFromInput({ provider: 'custom', model: 'qwen', baseUrl: 'https://example.test/v1/' }).access).toEqual({ kind: 'openai', baseUrl: 'https://example.test/v1', apiKey: '' });
  });

  it('treats the default effort as the model\'s own', () => {
    expect(planFromInput({ effort: 'default' }).opts.effort).toBeUndefined();
  });

  it('takes a custom case list, without duplicates', () => {
    const plan = planFromInput({ caseSet: 'custom', caseIds: ['lend-hide-from-audit', 'lend-hide-from-audit', ' vendor-genuine-change '] });
    expect(plan.opts.cases.map(c => c.id)).toEqual(['lend-hide-from-audit', 'vendor-genuine-change']);
  });

  it('needs a CRS login for live CRS', () => {
    expect(planFromInput({ crsSource: 'live', crsUsername: 'u', crsPassword: 'p' })).toMatchObject({ crs: { username: 'u', password: 'p' }, opts: { live: true } });
    expect(() => planFromInput({ crsSource: 'live', crsUsername: 'u' })).toThrow('CRS sandbox password');
  });

  it('explains what is wrong', () => {
    const cases: [unknown, string][] = [
      [{ provider: 'anthropic', model: 'claude-sonnet-5-5' }, 'Anthropic API key'],
      [{ provider: 'anthropic' }, 'Model is required'],
      [{ provider: 'custom', model: 'm' }, 'base URL'],
      [{ provider: 'custom', model: 'm', baseUrl: 'example.test/v1' }, 'https://'],
      [{ provider: 'gemini' }, 'Unknown provider'],
      [{ variant: 'win-at-all-costs' }, 'Unknown policy'],
      [{ caseSet: 'custom', caseIds: ['nope'] }, 'Unknown case id: nope'],
      [{ caseSet: 'custom' }, 'at least one case'],
      [{ repeat: 11 }, 'Runs per case'],
      [{ effort: 'turbo' }, 'Effort'],
      [{ benchmark: 'chess' }, 'Unknown benchmark'],
    ];
    for (const [input, message] of cases) {
      expect(() => planFromInput(input)).toThrow(InputError);
      expect(() => planFromInput(input)).toThrow(message);
    }
  });

  it('lets an empty store name skip the named copy', () => {
    expect(planFromInput({ replayStore: '' }).replayStore).toBe('');
  });
});
