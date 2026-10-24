import { describe, expect, test } from 'vitest';
import { anthropicBrain, brainFor, fakeBrain, openAiCompatibleBrain, withThought, type Tool } from './brains';

const tools: Tool[] = [
  {
    name: 'move_to',
    description: 'Walk',
    parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
  },
  { name: 'say', description: 'Talk', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'idle', description: 'Wait', parameters: { type: 'object', properties: {} } },
];

const observation = {
  you: { id: 1, name: 'Ada', x: 10, y: 10, hp: 100, hunger: 100, doing: 'idle' },
  time: { gameSeconds: 3 },
  map: { width: 64, height: 64 },
  wakeReason: 'heartbeat',
  nearby: { agents: [{ id: 2, name: 'Bo', x: 12, y: 10, distance: 2, doing: 'idle' }] },
  heard: [],
  lastAction: null,
};

type Call = { url: string; body: any; headers: Record<string, string> };

function recordingFetch(reply: unknown) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe('withThought', () => {
  test('adds a required thought argument to every tool', () => {
    for (const tool of withThought(tools)) {
      expect(tool.parameters.properties.thought.type).toBe('string');
      expect(tool.parameters.required).toContain('thought');
    }
  });
});

describe('fake brain', () => {
  test('always answers with one of the offered tools, inside the map', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0] });
    for (let i = 0; i < 200; i++) {
      const d = await brain.decide({ agentName: 'Ada', observation, tools, system: '' });
      expect(tools.map(t => t.name)).toContain(d.action.name);
      if (d.action.name === 'move_to') {
        expect(d.action.args.x).toBeGreaterThanOrEqual(0);
        expect(d.action.args.x).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe('fake brain survival', () => {
  const survivalTools: Tool[] = ['move_to', 'say', 'idle', 'eat', 'gather', 'take', 'attack', 'follow', 'give', 'store'].map(name => ({
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
  }));

  test('a hungry fake survivor carrying food eats it', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const hungry = { ...observation, you: { ...observation.you, hunger: 30, inventory: { berries: 2 } } };
    const d = await brain.decide({ agentName: 'Ada', observation: hungry, tools: survivalTools, system: '' });
    expect(d.action).toEqual({ name: 'eat', args: { item: 'berries' } });
  });

  test('a hungry fake survivor with no food goes to gather at a bush that has berries', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const hungry = {
      ...observation,
      you: { ...observation.you, hunger: 30, inventory: {} },
      nearby: {
        agents: [],
        containers: [],
        resources: [
          { id: 7, kind: 'berry_bush', x: 1, y: 1, distance: 3, remaining: 0 },
          { id: 8, kind: 'berry_bush', x: 2, y: 2, distance: 5, remaining: 4 },
        ],
      },
    };
    const d = await brain.decide({ agentName: 'Ada', observation: hungry, tools: survivalTools, system: '' });
    expect(d.action).toEqual({ name: 'gather', args: { node_id: 8 } });
  });
});

describe('openai-compatible brain', () => {
  test('sends the tools as functions and maps the first tool call to an action', async () => {
    const { calls, fetchImpl } = recordingFetch({
      choices: [
        {
          message: {
            tool_calls: [
              { type: 'function', function: { name: 'move_to', arguments: '{"x": 30, "y": 12, "thought": "berries east"}' } },
            ],
          },
        },
      ],
    });
    const brain = openAiCompatibleBrain({ baseUrl: 'http://spark:8000/v1', apiKey: 'k', model: 'ender', fetchImpl });

    const d = await brain.decide({ agentName: 'Ada', observation, tools, system: 'SYS' });

    expect(calls[0].url).toBe('http://spark:8000/v1/chat/completions');
    expect(calls[0].body.model).toBe('ender');
    expect(calls[0].body.tool_choice).toBe('required');
    expect(calls[0].body.tools[0].function.name).toBe('move_to');
    expect(calls[0].body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(d).toEqual({ action: { name: 'move_to', args: { x: 30, y: 12 } }, thought: 'berries east' });
  });

  test('throws when the model answers without calling a tool', async () => {
    const { fetchImpl } = recordingFetch({ choices: [{ message: { content: 'I think I will walk.' } }] });
    const brain = openAiCompatibleBrain({ baseUrl: 'http://x/v1', apiKey: '', model: 'm', fetchImpl });

    await expect(brain.decide({ agentName: 'Ada', observation, tools, system: '' })).rejects.toThrow(/tool/);
  });
});

describe('anthropic brain', () => {
  test('maps a tool_use block to an action', async () => {
    const { calls, fetchImpl } = recordingFetch({
      content: [{ type: 'tool_use', name: 'say', input: { text: 'hi Bo', thought: 'be friendly' } }],
    });
    const brain = anthropicBrain({ apiKey: 'k', model: 'claude-haiku-4-5', fetchImpl });

    const d = await brain.decide({ agentName: 'Ada', observation, tools, system: 'SYS' });

    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].body.system).toBe('SYS');
    expect(calls[0].body.tool_choice).toEqual({ type: 'any' });
    expect(calls[0].body.tools[0].input_schema.properties.thought.type).toBe('string');
    expect(d).toEqual({ action: { name: 'say', args: { text: 'hi Bo' } }, thought: 'be friendly' });
  });
});

describe('brainFor', () => {
  test('routes a model id to its provider by prefix', () => {
    const env = { ENDER_BASE_URL: 'http://spark:8000/v1', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' };
    expect(brainFor('fake', env).provider).toBe('fake');
    expect(brainFor('ender:qwen', env).provider).toBe('openai-compatible');
    expect(brainFor('openai:gpt-5-mini', env).provider).toBe('openai-compatible');
    expect(brainFor('anthropic:claude-haiku-4-5', env).provider).toBe('anthropic');
  });

  test('refuses an unknown provider or a missing endpoint', () => {
    expect(() => brainFor('mystery:x', {})).toThrow(/provider/);
    expect(() => brainFor('ender:qwen', {})).toThrow(/ENDER_BASE_URL/);
  });
});
