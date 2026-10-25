import { describe, expect, it } from 'vitest';
import { assignmentForDecision, expandRoster, isRosterSelection, type AgentAssignment } from './roster.js';
import { hasCompleteRoster, rosterHasFinished } from './completion.js';

const roster = [
  { model: 'ChatGPT' as const, modelId: 'openai:test', count: 2 },
  { model: 'Grok' as const, modelId: 'openrouter:grok-test', count: 1 },
];

describe('selected survivor roster', () => {
  it('expands each chosen count in stable order with unique survivor names', () => {
    expect(expandRoster(roster)).toEqual([
      { name: 'Ada', model: 'ChatGPT', modelId: 'openai:test' },
      { name: 'Bo', model: 'ChatGPT', modelId: 'openai:test' },
      { name: 'Cy', model: 'Grok', modelId: 'openrouter:grok-test' },
    ]);
  });

  it('rejects empty, oversized, duplicate, fractional, and extra-key selections', () => {
    for (const value of [[], [{ model: 'Grok', count: 0 }], [{ model: 'Grok', count: 5 }],
      [{ model: 'Grok', count: 1.5 }], [{ model: 'Grok', count: '1' }],
      [{ model: 'Grok', count: 1 }, { model: 'Grok', count: 1 }],
      [{ model: 'unknown', count: 1 }], [{ model: 'Grok', count: 1, modelId: 'openai:override' }]]) {
      expect(isRosterSelection(value)).toBe(false);
    }
    expect(isRosterSelection([{ model: 'Grok', count: 1 }])).toBe(true);
  });

  it('routes by actual agent identity and rejects cross-model and same-model impostors', () => {
    const selected = expandRoster(roster);
    const assignments = new Map<bigint, AgentAssignment>(selected.map((agent, index) => [BigInt(index + 1), agent]));
    const ada = { ...selected[0], kind: 'llm', id: 1n, alive: true };
    expect(assignmentForDecision(assignments, { agentId: 1n, modelId: 'openai:test' }, ada)).toEqual(selected[0]);
    expect(() => assignmentForDecision(assignments, { agentId: 1n, modelId: 'openrouter:grok-test' }, ada)).toThrow();
    expect(() => assignmentForDecision(assignments, { agentId: 4n, modelId: 'openai:test' }, ada)).toThrow();
    expect(() => assignmentForDecision(assignments, { agentId: 1n, modelId: 'openai:test' }, { ...ada, name: 'Bo' })).toThrow();
    expect(() => assignmentForDecision(assignments, { agentId: 1n, modelId: 'openai:test' }, { ...ada, modelId: 'openrouter:grok-test' })).toThrow();
  });

  it.each([1, 2, 3, 4])('completes exactly the selected %i-agent roster', count => {
    const selected = expandRoster([{ ...roster[0], count }]);
    const assignments = new Map<bigint, AgentAssignment>(selected.map((agent, index) => [BigInt(index + 1), agent]));
    const agents = selected.map((agent, index) => ({ ...agent, id: BigInt(index + 1), kind: 'llm', alive: true }));
    expect(hasCompleteRoster(agents, assignments)).toBe(true);
    expect(rosterHasFinished('waiting', agents, assignments)).toBe(false);
    expect(rosterHasFinished('rescued', agents, assignments)).toBe(true);
    expect(rosterHasFinished(undefined, agents, assignments)).toBe(false);
    expect(rosterHasFinished('waiting', agents.map(agent => ({ ...agent, alive: false })), assignments)).toBe(true);
    expect(rosterHasFinished('rescued', agents.slice(1), assignments)).toBe(false);
  });
});

describe('exact variant routing', () => {
  it('allows sibling variants in the same run and rejects decisions from the other sibling', () => {
    const roster = [
      { model: 'GLM 5.3' as const, modelId: 'bitdeer:zai-org/GLM-5.3', count: 1 },
      { model: 'GLM 5.3 Flash' as const, modelId: 'bitdeer:zai-org/GLM-5.3-Flash', count: 1 },
      { model: 'GPT-6 Luna' as const, modelId: 'codex:gpt-6-luna', count: 1 },
      { model: 'GPT-6 Sol' as const, modelId: 'codex:gpt-6-sol', count: 1 },
    ];
    expect(isRosterSelection(roster.map(({ model, count }) => ({ model, count })))).toBe(true);
    const agents = expandRoster(roster);
    expect(new Set(agents.map(agent => agent.modelId)).size).toBe(4);
    const assignments = new Map(agents.map((agent, index) => [BigInt(index + 1), agent]));
    for (let index = 0; index < agents.length; index++) {
      const agentId = BigInt(index + 1);
      const agent = { ...agents[index], kind: 'llm' };
      expect(assignmentForDecision(assignments, { agentId, modelId: agent.modelId }, agent).model).toBe(roster[index].model);
      expect(() => assignmentForDecision(assignments, { agentId, modelId: agents[(index + 1) % agents.length].modelId }, agent)).toThrow();
    }
  });
});
