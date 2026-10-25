import { describe, expect, test } from 'vitest';
import { anthropicBrain, brainFor, codexBrain, codexError, fakeBrain, mcpServerNames, openAiCompatibleBrain, withThought, type CodexRun, type Tool } from './brains';

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
  you: { id: 1, name: 'Ada', x: 10, y: 10, hp: 100, fullness: 100, doing: 'idle' },
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
  const survivalTools: Tool[] = ['move_to', 'say', 'idle', 'eat', 'gather', 'take', 'attack', 'follow', 'give', 'store', 'feed_fire', 'heal', 'help', 'build'].map(name => ({
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
  }));

  test('a hungry fake survivor carrying food eats it', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const hungry = { ...observation, you: { ...observation.you, fullness: 30, inventory: { berries: 2 } } };
    const d = await brain.decide({ agentName: 'Ada', observation: hungry, tools: survivalTools, system: '' });
    expect(d.action).toEqual({ name: 'eat', args: { item: 'berries' } });
  });

  const shelter = (over: Record<string, unknown>) => ({ id: 9, x: 64, y: 64, radius: 8, woodNeeded: 10, built: false, youAreInside: false, distance: 20, ...over });

  test('a fake survivor carrying wood takes it to the unfinished shelter, then builds', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const far = { ...observation, you: { ...observation.you, inventory: { wood: 4 } }, shelter: shelter({}) };
    expect((await brain.decide({ agentName: 'Ada', observation: far, tools: survivalTools, system: '' })).action).toEqual({ name: 'move_to', args: { x: 64, y: 64 } });

    const there = { ...far, shelter: shelter({ distance: 6, youAreInside: true }) };
    expect((await brain.decide({ agentName: 'Ada', observation: there, tools: survivalTools, system: '' })).action).toEqual({ name: 'build', args: { structure_id: 9, qty: 4 } });
  });

  test('at night a fake survivor gathers inside a finished shelter', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const night = { ...observation, time: { daylight: 'night' }, you: { ...observation.you, inventory: {} }, shelter: shelter({ woodNeeded: 0, built: true }) };
    expect((await brain.decide({ agentName: 'Ada', observation: night, tools: survivalTools, system: '' })).action).toEqual({ name: 'move_to', args: { x: 64, y: 64 } });
  });

  test('a cold fake survivor heads for a lit fire', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const cold = {
      ...observation,
      you: { ...observation.you, warmth: 30, inventory: {} },
      nearby: { agents: [], containers: [], resources: [], fires: [{ id: 1, kind: 'campfire', lit: true, x: 64, y: 64, distance: 12 }] },
    };
    const d = await brain.decide({ agentName: 'Ada', observation: cold, tools: survivalTools, system: '' });
    expect(d.action).toEqual({ name: 'move_to', args: { x: 64, y: 64 } });
  });

  test('a fake survivor with a medkit treats someone critically hurt within reach', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const o = {
      ...observation,
      you: { ...observation.you, inventory: { medkit: 1 } },
      nearby: { agents: [{ id: 2, name: 'Bo', x: 12, y: 10, distance: 1.8, health: 'critical', doing: 'idle' }], containers: [], resources: [], fires: [] },
    };
    const d = await brain.decide({ agentName: 'Ada', observation: o, tools: survivalTools, system: '' });
    expect(d.action).toEqual({ name: 'heal', args: { agent_id: 2 } });
  });

  test('a fake survivor carrying plenty of wood takes it to an unbuilt signal fire', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const o = {
      ...observation,
      you: { ...observation.you, warmth: 90, inventory: { wood: 4 } },
      nearby: { agents: [], containers: [], resources: [], fires: [{ id: 2, kind: 'signal_fire', lit: false, woodNeeded: 15, x: 38, y: 52, distance: 20 }] },
    };
    const d = await brain.decide({ agentName: 'Ada', observation: o, tools: survivalTools, system: '' });
    expect(d.action).toEqual({ name: 'move_to', args: { x: 38, y: 52 } });
  });

  test('a fake survivor hunted by a wolf runs for a lit fire, or fights if there is none', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const wolf = { id: 9, x: 14, y: 10, distance: 4, doing: 'hunting you' };
    const fire = { id: 1, kind: 'campfire', lit: true, x: 64, y: 64, distance: 15 };
    const hunted = (fires: any[]) => ({ ...observation, nearby: { agents: [], containers: [], resources: [], fires, wolves: [wolf] } });
    expect((await brain.decide({ agentName: 'Ada', observation: hunted([fire]), tools: survivalTools, system: '' })).action).toEqual({
      name: 'move_to',
      args: { x: 64, y: 64 },
    });
    expect((await brain.decide({ agentName: 'Ada', observation: hunted([]), tools: survivalTools, system: '' })).action).toEqual({
      name: 'attack',
      args: { wolf_id: 9 },
    });
  });

  test('a fake survivor goes to help someone pinned under a tree', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const o = {
      ...observation,
      nearby: { agents: [{ id: 2, name: 'Bo', x: 12, y: 10, distance: 6, health: 'healthy', pinned: true }], containers: [], resources: [], fires: [], wolves: [] },
    };
    const d = await brain.decide({ agentName: 'Ada', observation: o, tools: survivalTools, system: '' });
    expect(d.action).toEqual({ name: 'help', args: { agent_id: 2 } });
  });

  test('a fake survivor carrying wood at a fire feeds it', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const atFire = {
      ...observation,
      you: { ...observation.you, warmth: 80, inventory: { wood: 3 } },
      nearby: { agents: [], containers: [], resources: [], fires: [{ id: 1, kind: 'campfire', lit: true, x: 64, y: 64, distance: 1.6 }] },
    };
    const d = await brain.decide({ agentName: 'Ada', observation: atFire, tools: survivalTools, system: '' });
    expect(d.action).toEqual({ name: 'feed_fire', args: { structure_id: 1, qty: 3 } });
  });

  test('a hungry fake survivor with no food goes to gather at a bush that has berries', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const hungry = {
      ...observation,
      you: { ...observation.you, fullness: 30, inventory: {} },
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

describe('fake brain in rules v11', () => {
  const v11Tools: Tool[] = ['move_to', 'say', 'idle', 'eat', 'gather', 'feed_fire', 'explore', 'craft'].map(name => ({
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
  }));
  const decide = (brain: ReturnType<typeof fakeBrain>, o: unknown, tools = v11Tools) => brain.decide({ agentName: 'Ada', observation: o, tools, system: '' });

  test('the fake brain explores and crafts sometimes', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });

    // Crafts whenever the observation says something can be made, and asks for the item the tool names.
    const spearable = { ...observation, you: { ...observation.you, inventory: { wood: 3 }, canCraft: 'spear' } };
    const flamable = { ...observation, you: { ...observation.you, inventory: { spear: 1 }, canCraft: 'flaming spear' } };
    for (let i = 0; i < 40; i++) {
      expect((await decide(brain, spearable)).action).toEqual({ name: 'craft', args: { item: 'spear' } });
      expect((await decide(brain, flamable)).action).toEqual({ name: 'craft', args: { item: 'flaming_spear' } });
    }

    // Explores some of the time, when it is idle and fed, and otherwise does what it did before.
    const names = new Set<string>();
    let explored = 0;
    for (let i = 0; i < 400; i++) {
      const d = await decide(brain, observation);
      names.add(d.action.name);
      if (d.action.name === 'explore') {
        explored++;
        expect(d.action.args).toEqual({});
      }
    }
    expect(explored).toBeGreaterThan(10);
    expect(explored).toBeLessThan(200);
    expect(names.size).toBeGreaterThan(2);
  });

  test('it never explores while hungry or busy, and never asks for an action it was not offered', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const hungry = { ...observation, you: { ...observation.you, fullness: 20, inventory: { berries: 1 } } };
    const busy = { ...observation, you: { ...observation.you, doing: 'walking to (30, 40)' } };
    const crafty = { ...observation, you: { ...observation.you, canCraft: 'spear' } };
    for (let i = 0; i < 200; i++) {
      expect((await decide(brain, hungry)).action.name).not.toBe('explore');
      expect((await decide(brain, busy)).action.name).not.toBe('explore');
      expect((await decide(brain, observation, tools)).action.name).not.toBe('explore');
      expect((await decide(brain, crafty, tools)).action.name).not.toBe('craft');
    }
  });

  test('crafting a flaming spear comes before feeding the fire with the wood it needs', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const atFire = {
      ...observation,
      you: { ...observation.you, warmth: 80, inventory: { wood: 3, spear: 1 }, canCraft: 'flaming spear' },
      nearby: { agents: [], containers: [], resources: [], fires: [{ id: 1, kind: 'campfire', lit: true, x: 64, y: 64, distance: 1.6 }] },
    };
    expect((await decide(brain, atFire)).action).toEqual({ name: 'craft', args: { item: 'flaming_spear' } });
  });

  test('a fake survivor with a plain spear walks to a lit fire to make it flaming', async () => {
    const brain = fakeBrain({ latencyMs: [0, 0], mischief: 0 });
    const fire = { id: 1, kind: 'campfire', lit: true, x: 64, y: 64, distance: 30 };
    const armed = {
      ...observation,
      you: { ...observation.you, warmth: 80, inventory: { spear: 1 }, holding: 'spear' },
      nearby: { agents: [], containers: [], resources: [], fires: [fire] },
    };
    for (let i = 0; i < 40; i++) expect((await decide(brain, armed)).action).toEqual({ name: 'move_to', args: { x: 64, y: 64 } });

    // Not to a fire that is out, not once it is there, and not once the spear is flaming.
    const out = { ...armed, nearby: { ...armed.nearby, fires: [{ ...fire, lit: false }] } };
    const there = { ...armed, nearby: { ...armed.nearby, fires: [{ ...fire, distance: 2.3 }] } };
    const flaming = { ...armed, you: { ...armed.you, inventory: { flaming_spear: 1 }, holding: 'flaming spear' } };
    for (let i = 0; i < 40; i++) {
      for (const o of [out, there, flaming]) expect((await decide(brain, o)).action).not.toEqual({ name: 'move_to', args: { x: 64, y: 64 } });
    }
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

  test('sends a provider’s extra request fields', async () => {
    const { calls, fetchImpl } = recordingFetch({
      choices: [{ message: { tool_calls: [{ function: { name: 'idle', arguments: '{"thought":"rest"}' } }] } }],
    });
    const brain = openAiCompatibleBrain({ baseUrl: 'http://x/v1', apiKey: '', model: 'm', extraBody: { reasoning_effort: 'none' }, fetchImpl });

    await brain.decide({ agentName: 'Ada', observation, tools, system: '' });
    expect(calls[0].body.reasoning_effort).toBe('none');
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

describe('codexBrain', () => {
  function recordingRun(reply: string) {
    const calls: Array<Parameters<CodexRun>[0]> = [];
    const run: CodexRun = async call => { calls.push(call); return reply; };
    return { run, calls };
  }

  test('asks the Codex CLI for one structured action, with the chosen profile and model', async () => {
    const { run, calls } = recordingRun(JSON.stringify({ action: 'move_to', args_json: '{"x":20,"y":12}', thought: 'head to the wreck' }));
    const brain = codexBrain({ model: 'gpt-6-luna', codexHome: '/home/m/.codex-mdl', run });

    const d = await brain.decide({ agentName: 'Luna', observation, tools, system: 'SYSTEM' });

    expect(d).toEqual({ action: { name: 'move_to', args: { x: 20, y: 12 } }, thought: 'head to the wreck' });
    expect(calls[0].model).toBe('gpt-6-luna');
    expect(calls[0].codexHome).toBe('/home/m/.codex-mdl');
    // The game's system prompt replaces Codex's own coding-agent instructions.
    expect(calls[0].instructions).toBe('SYSTEM');
    expect(calls[0].prompt).not.toContain('SYSTEM');
    expect(calls[0].prompt).toContain('You are Luna');
    expect(calls[0].prompt).toContain('"name":"move_to"');
    // Codex has no callable game tools; telling it to call one makes it give up and idle.
    expect(calls[0].prompt).not.toMatch(/calling exactly one tool|Tools \(/);
    expect(calls[0].schema.properties.action.enum).toEqual(['move_to', 'say', 'idle']);
  });

  test("finds the Codex login's MCP servers so a game call can switch them off", () => {
    const config = ['model = "gpt-6-astra"', '[projects."/home/m"]', 'trust_level = "trusted"', '[mcp_servers.playwright]', 'command = "npx"',
      '[mcp_servers.playwright.tools.browser_click]', '[mcp_servers.Roblox_Studio]', '[mcp_servers."my server"]', '[tui]'].join('\n');
    expect(mcpServerNames(config)).toEqual(['playwright', 'Roblox_Studio', 'my server']);
  });

  test('reports the real Codex error, not the sandbox notice printed on every run', () => {
    const stderr = [
      'ERROR: HTTP error: 403 Forbidden, url: wss://chatgpt.com/backend-api/codex/responses',
      'warning: see https://developers.openai.com/codex/concepts/sandboxing#prerequisites. Codex will use the bundled bubblewrap in the meantime.',
    ].join('\n');
    expect(codexError(stderr)).toBe('ERROR: HTTP error: 403 Forbidden, url: wss://chatgpt.com/backend-api/codex/responses');
  });

  test('rejects a reply that is not one of the offered actions', async () => {
    const { run } = recordingRun(JSON.stringify({ action: 'teleport', args_json: '{}', thought: '' }));
    const brain = codexBrain({ model: 'gpt-6-luna', run });
    await expect(brain.decide({ agentName: 'Luna', observation, tools, system: 'S' })).rejects.toThrow(/teleport/);
  });

  test('rejects args that are not a JSON object', async () => {
    const { run } = recordingRun(JSON.stringify({ action: 'move_to', args_json: 'north', thought: '' }));
    const brain = codexBrain({ model: 'gpt-6-luna', run });
    await expect(brain.decide({ agentName: 'Luna', observation, tools, system: 'S' })).rejects.toThrow(/args/);
  });
});

describe('brainFor', () => {
  test('routes a model id to its provider by prefix', () => {
    const env = { ENDER_BASE_URL: 'http://spark:8000/v1', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' };
    expect(brainFor('fake', env).provider).toBe('fake');
    expect(brainFor('ender:qwen', env).provider).toBe('openai-compatible');
    expect(brainFor('openai:gpt-5-mini', env).provider).toBe('openai-compatible');
    expect(brainFor('anthropic:claude-haiku-4-5', env).provider).toBe('anthropic');
    expect(brainFor('codex:gpt-6-luna', env).provider).toBe('codex');
  });

  test('refuses an unknown provider or a missing endpoint', () => {
    expect(() => brainFor('mystery:x', {})).toThrow(/provider/);
    expect(() => brainFor('ender:qwen', {})).toThrow(/ENDER_BASE_URL/);
  });
});
