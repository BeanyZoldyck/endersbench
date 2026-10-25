import { describe, expect, test } from 'vitest';
import { Timestamp } from 'spacetimedb';
import type { LeaderboardRow, RunHistory, RunResult } from './module_bindings/types';
import { leaderboardSections, recentRuns, shortModel } from './LiveLeaderboard';

const row = (f: Partial<LeaderboardRow>): LeaderboardRow => ({ modelId: 'bitdeer:deepseek-ai/DeepSeek-V4.1-Flash', rulesVersion: 14, condition: 'reward · time 0.5x', runs: 1, agents: 4, survived: 4, rescued: 4, meanReward: 700, violations: 2, temptations: 20, violationRate: 0.1, meanLatencyMs: 1100, ...f });
const run = (id: bigint, f: Partial<RunHistory> = {}): RunHistory => ({ id, outcome: 'rescued', startedAt: new Timestamp(0n), endedAt: new Timestamp(0n), rulesVersion: 14, promptVariant: 'reward', promptVersion: 1, timeScale: 0.5, foodScale: 1, roleOffset: 0, rescueSeats: 0, brains: 'database', interactive: false, gameSeconds: 466, requests: 589, unanswered: 6, ...f });
const result = (runId: bigint, modelId: string, survived = true) => ({ id: 0n, runId, name: 'Ivy', modelId, role: 'pilot', reward: 0, ethics: 100, violations: 0, temptations: 0, resisted: 0, survived, rescued: survived, diedOf: '', requests: 0, unanswered: 0, meanLatencyMs: 0 }) as RunResult;

describe('live leaderboard', () => {
  test('groups rows by rules version and condition, keeping the view\'s order', () => {
    const sections = leaderboardSections([row({ modelId: 'b:y' }), row({ modelId: 'a:x' }), row({ condition: 'charter · time 0.5x' }), row({ rulesVersion: 13 })]);
    expect(sections.map(s => `${s.title}: ${s.rows.length}`)).toEqual(['Rules v14 · reward · time 0.5x: 2', 'Rules v14 · charter · time 0.5x: 1', 'Rules v13 · reward · time 0.5x: 1']);
  });

  test('lists the most recent finished runs first, with their models and survivors', () => {
    const runs = recentRuns([run(1n), run(2n, { outcome: '' }), run(3n, { outcome: 'missed', interactive: true })], [result(1n, 'bitdeer:m'), result(1n, 'bitdeer:m', false), result(3n, 'openai:gpt-6-luna')], 8);
    expect(runs.map(r => [String(r.id), r.outcome, r.interactive, r.models, r.survived])).toEqual([
      ['3', 'missed', true, 'gpt-6-luna', '1/1'],
      ['1', 'rescued', false, 'm', '1/2'],
    ]);
  });

  test('a model id reads without its provider or organisation', () => {
    expect(shortModel('bitdeer:deepseek-ai/DeepSeek-V4.1-Flash')).toBe('DeepSeek-V4.1-Flash');
    expect(shortModel('anthropic:claude-haiku-5-5')).toBe('claude-haiku-5-5');
  });
});
