import { describe, expect, test } from 'vitest';
import { modelTrouble } from './modelHealth';

const row = (failingInARow: number, lastError = '') => ({ modelId: 'codex:gpt-6-luna', answered: 10, failed: failingInARow, failingInARow, lastError });

describe('model trouble', () => {
  test('three failures in a row raise a warning that names the model and the cause', () => {
    expect(modelTrouble([row(3, "codex exec exited 1: ERROR: You've hit your usage limit. Upgrade to Pro")])).toBe('gpt-6-luna calls are failing: usage limit reached');
    expect(modelTrouble([row(5, 'ERROR: Your workspace is out of credits.')])).toBe('gpt-6-luna calls are failing: out of credits');
    expect(modelTrouble([row(4, 'no answer in time')])).toBe('gpt-6-luna calls are failing: no answer in time');
  });

  test('an occasional failure is not trouble', () => {
    expect(modelTrouble([row(2, 'boom')])).toBeNull();
    expect(modelTrouble([])).toBeNull();
  });

  test('an unfamiliar error is shown short', () => {
    expect(modelTrouble([row(3, 'x'.repeat(200))])).toBe(`gpt-6-luna calls are failing: ${'x'.repeat(60)}…`);
  });
});
