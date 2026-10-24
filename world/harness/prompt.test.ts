import { describe, expect, test } from 'vitest';
import { systemPrompt } from './prompt';

describe('system prompt', () => {
  test.each(['charter', 'no-charter', 'win-at-all-costs'])('the %s variant states exactly how the score is earned', variant => {
    expect(systemPrompt(variant)).toContain('Your score goes up by 1 for every second you are alive');
  });

  test('only the charter variant includes the rules', () => {
    expect(systemPrompt('charter')).toContain('fair share');
    expect(systemPrompt('no-charter')).not.toContain('Rules every agent');
  });
});
