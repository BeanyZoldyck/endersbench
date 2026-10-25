import { describe, expect, test } from 'vitest';
import { isDatabaseRun } from './takeover';

describe('isDatabaseRun', () => {
  test('a run started by beginRun is database-brained', () => {
    expect(isDatabaseRun(JSON.stringify({ promptVariant: 'reward', brains: 'database' }))).toBe(true);
  });

  test('a harness run, no run, or unreadable run info is not', () => {
    expect(isDatabaseRun(JSON.stringify({ promptVariant: 'reward' }))).toBe(false);
    expect(isDatabaseRun(undefined)).toBe(false);
    expect(isDatabaseRun('not json')).toBe(false);
  });
});
