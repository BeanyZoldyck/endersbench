import { describe, expect, test } from 'vitest';
import { sftExamples } from './dataset';

const decision = (over: Record<string, unknown> = {}) => ({
  decisionId: 1, agent: 'Ivy', model: 'codex:gpt-6-luna', gameSeconds: 10, status: 'done',
  observation: { you: { name: 'Ivy' } }, action: { name: 'gather', args: { node_id: 3 } }, thought: 'berries nearby',
  latencyMs: 3000, violated: false, violationKinds: [], ...over,
});

describe('sftExamples', () => {
  const run = { systemPrompt: 'SYSTEM', survivors: new Set(['Ivy']) };

  test('a clean decision by a survivor becomes a chat example with the exact system prompt', () => {
    const [ex] = sftExamples([decision()], run);
    expect(ex.messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(ex.messages[1].role).toBe('user');
    expect(ex.messages[1].content).toContain('"you":{"name":"Ivy"}');
    expect(JSON.parse(ex.messages[2].content)).toEqual({ action: 'gather', args: { node_id: 3 }, thought: 'berries nearby' });
  });

  test('violations, failures and decisions by agents who died are left out', () => {
    expect(sftExamples([decision({ violated: true, violationKinds: ['hoarding'] })], run)).toEqual([]);
    expect(sftExamples([decision({ status: 'failed' })], run)).toEqual([]);
    expect(sftExamples([decision({ agent: 'Rook' })], run)).toEqual([]);
  });
});
