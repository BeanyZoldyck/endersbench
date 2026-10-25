import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, test } from 'vitest';
import { policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { EVENT_STEP, deliver, takeStep } from '../../spacetimedb/src/finance/engine';
import { financeSystemPrompt } from '../../spacetimedb/src/finance/prompt';
import { SCENARIOS, SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import type { Observation } from '../../spacetimedb/src/finance/types';
import { managedDriver, messagesDriver, openAiDriver, openAiTurn, setupManaged, toolReply } from './drivers';

const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 };

function observationOf(request: any): Observation {
  const text: string = request.messages[0].content;
  return JSON.parse(text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n\nChoose')));
}

// A stand-in for client.messages.create that answers with whatever `reply` returns.
function fakeMessages(reply: (request: any) => any) {
  const requests: any[] = [];
  const client = { messages: { create: async (request: any) => (requests.push(request), { usage, ...reply(request) }) } };
  return { requests, client: client as unknown as Anthropic };
}

// Script A behind the Messages API: it reads the same observation a model would.
const scriptA = fakeMessages(request => {
  const action = policyFollower(observationOf(request));
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: action.tool, input: action.args }] };
});

describe('messages driver', () => {
  test('plays every case exactly as the offline run does', async () => {
    const run = messagesDriver(scriptA.client, { model: 'claude-opus-5-5', effort: 'medium' });
    for (const scenario of SCENARIOS) {
      const result = await run(scenario, 'charter');
      expect(result.steps, scenario.id).toEqual(runBrain(policyFollower, scenario));
      expect(result.stopped).toBeUndefined();
    }
  });

  test('sends the neutral prompt, cached, and never forces a tool', async () => {
    const request = scriptA.requests[0];
    expect(request.system).toEqual([{ type: 'text', text: financeSystemPrompt('lending', 'charter'), cache_control: { type: 'ephemeral' } }]);
    expect(request.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(request).not.toHaveProperty('temperature');
    expect(request.messages).toHaveLength(1);
  });

  test('gives up after repeated turns without a tool call', async () => {
    const chatty = fakeMessages(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Let me think.' }] }));
    const result = await messagesDriver(chatty.client, { model: 'claude-opus-5-5', effort: 'medium' })(SCENARIOS[0], 'charter');
    expect(result.stopped).toBe('no tool call');
    expect(chatty.requests).toHaveLength(3);
    expect(result.usage.calls).toBe(3);
  });

  test('records a refusal instead of retrying', async () => {
    const refuser = fakeMessages(() => ({ stop_reason: 'refusal', content: [] }));
    const result = await messagesDriver(refuser.client, { model: 'claude-opus-5-5', effort: 'medium' })(SCENARIOS[0], 'charter');
    expect(result.stopped).toBe('refusal');
    expect(refuser.requests).toHaveLength(1);
  });
});

// A stand-in Managed Agents session whose agent takes the given actions in
// order, one per message or tool result it receives.
function fakeManaged(actions: { tool: string; args: Record<string, unknown> }[]) {
  const emitted: any[] = [];
  const sent: any[] = [];
  const created: any[] = [];
  let next = 0;
  const emit = (e: any) => {
    const processed_at = new Date(Date.UTC(2026, 9, 24, 0, 0, 0, emitted.length)).toISOString();
    emitted.push({ id: `sevt_${emitted.length + 1}`, processed_at, ...e });
  };
  const respond = () => {
    emit({ type: 'span.model_request_end' });
    if (next < actions.length) {
      const a = actions[next++];
      emit({ type: 'agent.custom_tool_use', name: a.tool, input: a.args });
      emit({ type: 'session.status_idle', stop_reason: { type: 'requires_action' } });
    } else {
      emit({ type: 'agent.message', content: [{ type: 'text', text: 'Case closed.' }] });
      emit({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
    }
  };
  const client = {
    beta: {
      environments: { create: async (p: any) => (created.push(p), { id: 'env_1' }) },
      agents: {
        create: async (p: any) => (created.push(p), { id: `agent_${created.length}`, version: 1 }),
        update: async (id: string, p: any) => (created.push(p), { id, version: 2 }),
      },
      sessions: {
        create: async (p: any) => (created.push(p), { id: 'sesn_1' }),
        retrieve: async () => ({ usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 400, list_cost: { amount: '7', currency: 'USD' } } }),
        events: {
          send: async (_id: string, { events }: { events: any[] }) => {
            sent.push(...events);
            if (events.some(e => e.type === 'user.message' || e.type === 'user.custom_tool_result')) respond();
          },
          list: (_id: string, params?: Record<string, string>) =>
            (async function* () {
              const since = params?.['created_at[gte]'];
              yield* emitted.filter(e => !since || e.processed_at >= since);
            })(),
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, sent, created };
}

// The agent actions Script A takes in a case, in order.
function actionsOf(id: string) {
  return runBrain(policyFollower, SCENARIO_BY_ID[id])
    .filter(s => s.tool !== EVENT_STEP)
    .map(s => ({ tool: s.tool, args: s.args }));
}

const setup = { environmentId: 'env_1', agents: { 'lending/charter': { id: 'agent_1', version: 1 }, 'collections/charter': { id: 'agent_2', version: 1 }, 'vendor_payments/charter': { id: 'agent_3', version: 1 } } };

describe('managed driver', () => {
  test('plays every case exactly as the offline run does', async () => {
    for (const scenario of SCENARIOS) {
      const fake = fakeManaged(actionsOf(scenario.id));
      const result = await managedDriver(fake.client, setup, { pollMs: 1 })(scenario, 'charter');
      expect(result.steps, scenario.id).toEqual(runBrain(policyFollower, scenario));
      expect(result.stopped).toBeUndefined();
      expect(result.usage.listCostUsd).toBe(0.07);
    }
  });

  test('opens a capped session on the pinned agent and sends the first observation', async () => {
    const fake = fakeManaged(actionsOf('lend-clean-approve'));
    await managedDriver(fake.client, setup, { pollMs: 1 })(SCENARIO_BY_ID['lend-clean-approve'], 'charter');
    const session = fake.created.find(p => p.environment_id);
    expect(session.agent).toEqual({ type: 'agent', id: 'agent_1', version: 1 });
    expect(session.budget).toEqual({ type: 'limit', max_list_cost: { amount: '200', currency: 'USD' } });
    const opening = fake.sent[0].content[0].text as string;
    expect(opening).toContain('"caseFile"');
    expect(opening).toContain('Price personal loans at 24.9%');
  });

  test('nudges an agent that stops without acting, then gives up', async () => {
    const fake = fakeManaged([]);
    const result = await managedDriver(fake.client, setup, { pollMs: 1 })(SCENARIOS[0], 'charter');
    expect(result.stopped).toBe('no tool call');
    expect(fake.sent.filter(e => e.type === 'user.message')).toHaveLength(3);
  });
});

describe('managed setup', () => {
  test('one agent per seat and prompt, with only the desk tools and no network', async () => {
    const fake = fakeManaged([]);
    const result = await setupManaged(fake.client, { model: 'claude-opus-5-5', effort: 'medium', seats: ['lending', 'collections', 'vendor_payments'], variants: ['charter', 'no-charter'] });
    expect(Object.keys(result.agents)).toHaveLength(6);
    expect(fake.created[0].config).toEqual({ type: 'cloud', networking: { type: 'limited' } });
    for (const agent of fake.created.slice(1)) {
      expect(agent.tools.every((t: any) => t.type === 'custom')).toBe(true);
      expect(agent.model).toEqual({ id: 'claude-opus-5-5', effort: 'medium' });
    }
  });

  test('updates recorded agents instead of creating new ones', async () => {
    const fake = fakeManaged([]);
    const result = await setupManaged(fake.client, { model: 'claude-opus-5-5', effort: 'medium', seats: ['lending'], variants: ['charter'] }, setup);
    expect(result.agents['lending/charter']).toEqual({ id: 'agent_1', version: 2 });
    expect(fake.created.some(p => p.config)).toBe(false);
  });
});

describe('tool replies in a session', () => {
  test('carry pushback that arrives after a decision, and the supervisor question', () => {
    const scenario = SCENARIO_BY_ID['lend-subprime-pushback'];
    const actions = actionsOf(scenario.id);
    let steps = deliver(scenario, []);
    const replies = actions.map(a => {
      const before = steps;
      steps = takeStep(scenario, steps, a.tool, a.args);
      return toolReply(scenario, before, steps);
    });
    const decision = actions.findIndex(a => a.tool === 'decline_application');
    expect(replies[decision].messages?.[0].text).toMatch(/.+/);
    expect(replies.some(r => r.supervisor)).toBe(true);
    expect(replies.every(r => 'result' in r)).toBe(true);
  });
});

// A stand-in for an OpenAI-compatible chat API, answering through `reply`.
function fakeChat(reply: (body: any) => { status?: number; json?: any }) {
  const bodies: any[] = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const r = reply(body);
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      headers: { get: () => '0.001' }, // retry-after, in seconds
      json: async () => r.json,
      text: async () => 'busy',
    };
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

const chatObservation = (body: any): Observation => {
  const text: string = body.messages[1].content;
  return JSON.parse(text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n\nChoose')));
};

describe('OpenAI-compatible driver', () => {
  test('plays every case exactly as the offline run does', async () => {
    const chat = fakeChat(body => {
      const action = policyFollower(chatObservation(body));
      const call = { id: 'call_1', type: 'function', function: { name: action.tool, arguments: JSON.stringify(action.args) } };
      return { json: { choices: [{ message: { content: null, tool_calls: [call] } }], usage: { prompt_tokens: 120, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 100 } } } };
    });
    const run = openAiDriver({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', fetchImpl: chat.fetchImpl });
    for (const scenario of SCENARIOS) {
      const result = await run(scenario, 'no-charter');
      expect(result.steps, scenario.id).toEqual(runBrain(policyFollower, scenario));
    }
    const first = chat.bodies[0];
    expect(first.messages[0]).toEqual({ role: 'system', content: financeSystemPrompt('lending', 'no-charter') });
    expect(first.tool_choice).toBe('auto');
    expect(first).not.toHaveProperty('reasoning_effort');
  });

  test('retries a rate limit, then gives up on a model that never calls a tool', async () => {
    let calls = 0;
    const chat = fakeChat(() => (++calls === 1 ? { status: 429 } : { json: { choices: [{ message: { content: 'Thinking it over.' } }], usage: {} } }));
    const result = await openAiDriver({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', fetchImpl: chat.fetchImpl })(SCENARIOS[0], 'charter');
    expect(result.stopped).toBe('no tool call');
    expect(chat.bodies).toHaveLength(4);
    expect(result.notes).toContain('Thinking it over.');
  });

  // vLLM without a tool parser hands back the call a Qwen model wrote as text
  // (Ender on Runpod does this): the call is still the model's call.
  const asText = (render: (tool: string, args: Record<string, unknown>) => string) =>
    fakeChat(body => {
      const action = policyFollower(chatObservation(body));
      return { json: { choices: [{ message: { content: render(action.tool, action.args), tool_calls: [] } }], usage: {} } };
    });
  const xmlValue = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

  test('reads a tool call written as Qwen XML text, typing each value by the tool schema', async () => {
    const chat = asText((tool, args) =>
      `<tool_call>\n<function=${tool}>\n${Object.entries(args).map(([k, v]) => `<parameter=${k}>\n${xmlValue(v)}\n</parameter>\n`).join('')}</function>\n</tool_call>`
    );
    const run = openAiDriver({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', fetchImpl: chat.fetchImpl });
    for (const scenario of SCENARIOS) {
      const result = await run(scenario, 'house-rules');
      expect(result.steps, scenario.id).toEqual(runBrain(policyFollower, scenario));
    }
  });

  test('reads a tool call written as Hermes JSON text', async () => {
    const chat = asText((tool, args) => `<tool_call>\n${JSON.stringify({ name: tool, arguments: args })}\n</tool_call>`);
    const run = openAiDriver({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', fetchImpl: chat.fetchImpl });
    for (const scenario of SCENARIOS.slice(0, 5)) {
      const result = await run(scenario, 'house-rules');
      expect(result.steps, scenario.id).toEqual(runBrain(policyFollower, scenario));
    }
  });
});

// Qwen, DeepSeek and Ender return their thinking beside the reply, not in it: it is
// kept as a (thinking) note first, as Claude's is, so a step records it.
describe('reasoning from an OpenAI-compatible model', () => {
  const call = { id: 'call_1', type: 'function', function: { name: 'decline_loan', arguments: '{}' } };
  const turnWith = async (message: Record<string, unknown>) => {
    const chat = fakeChat(() => ({ json: { choices: [{ message: { tool_calls: [call], ...message } }], usage: {} } }));
    return openAiTurn({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', fetchImpl: chat.fetchImpl })('SYS', [], '{}');
  };

  test('keeps reasoning_content as thinking, before the reply', async () => {
    const turn = await turnWith({ content: 'Declining.', reasoning_content: 'No verified income.' });
    expect(turn.notes).toEqual(['(thinking) No verified income.', 'Declining.']);
    expect(turn.call?.name).toBe('decline_loan');
  });

  test('keeps reasoning sent as `reasoning`, as OpenRouter names it', async () => {
    const turn = await turnWith({ content: null, reasoning: 'Policy says decline.' });
    expect(turn.notes).toEqual(['(thinking) Policy says decline.']);
  });

  test('moves a <think> block out of the reply into thinking', async () => {
    const turn = await turnWith({ content: '<think>\nCheck the score first.\n</think>\n\nDeclining.' });
    expect(turn.notes).toEqual(['(thinking) Check the score first.', 'Declining.']);
  });

  test('caps long thinking so the reply still fits in a step', async () => {
    const turn = await turnWith({ content: 'Declining.', reasoning_content: 'x'.repeat(10_000) });
    expect(turn.notes[0].length).toBeLessThanOrEqual(3_100);
    expect(turn.notes[0]).toMatch(/^\(thinking\) x+… \(first 3000 of 10000 characters\)$/);
    expect(turn.notes[1]).toBe('Declining.');
  });
});

describe('OpenAI Responses API', () => {
  test('plays every case exactly as the offline run does, with reasoning left on', async () => {
    const chat = fakeChat(body => {
      const text: string = body.input[0].content;
      const action = policyFollower(JSON.parse(text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n\nChoose'))));
      return {
        json: {
          output: [
            { type: 'reasoning', summary: [] },
            { type: 'function_call', call_id: 'call_1', name: action.tool, arguments: JSON.stringify(action.args) },
          ],
          usage: { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 100 } },
        },
      };
    });
    const run = openAiDriver({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'm', api: 'responses', fetchImpl: chat.fetchImpl });
    for (const scenario of SCENARIOS) {
      expect((await run(scenario, 'no-charter')).steps, scenario.id).toEqual(runBrain(policyFollower, scenario));
    }
    const first = chat.bodies[0];
    expect(first.instructions).toBe(financeSystemPrompt('lending', 'no-charter'));
    expect(first.tools[0]).toMatchObject({ type: 'function', name: 'pull_credit', strict: false });
    expect(first).not.toHaveProperty('reasoning');
    expect(first.store).toBe(false);
  });
});
