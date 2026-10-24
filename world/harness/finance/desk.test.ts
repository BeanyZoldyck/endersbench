import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, test } from 'vitest';
import { policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { deliver, observe, phase, takeStep } from '../../spacetimedb/src/finance/engine';
import { SCENARIOS, SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import { financeTools } from '../../spacetimedb/src/finance/tools';
import type { Seat } from '../../spacetimedb/src/finance/types';
import { answerDesk, answerDeskRequest, deskTurnFor, type DeskConnection } from './desk';
import { claudeTurn, messagesDriver } from './drivers';

const seats: Seat[] = ['lending', 'collections', 'vendor_payments'];
// What the module publishes under meta 'finance_tools', as the harness reads it.
const published = JSON.parse(JSON.stringify(Object.fromEntries(seats.map(s => [s, financeTools(s)]))));
const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 };

function fakeClaude(reply: (request: any) => any) {
  const requests: any[] = [];
  const client = { messages: { create: async (request: any) => (requests.push(request), { usage, ...reply(request) }) } };
  return { requests, client: client as unknown as Anthropic };
}

const scriptA = (request: any) => {
  const text: string = request.messages[0].content;
  const action = policyFollower(JSON.parse(text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n\nChoose'))));
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: action.tool, input: action.args }] };
};

const request = (observation: string, id = 1n) => ({ id, agentId: 0n, modelId: 'anthropic:claude-opus-5-5', observation });

describe('finance desk in the harness', () => {
  test('sends the world exactly the call the bench loop makes, turn for turn', async () => {
    for (const scenario of SCENARIOS) {
      const bench = fakeClaude(scriptA);
      await messagesDriver(bench.client, { model: 'claude-opus-5-5' })(scenario, 'no-charter');
      const world = fakeClaude(scriptA);
      const turn = claudeTurn(world.client, { model: 'claude-opus-5-5' });
      // Play the case the way the module does: observation in, action JSON out.
      let steps = deliver(scenario, []);
      while (phase(scenario, steps) !== 'closed') {
        const answer = await answerDesk(turn, request(observe(scenario, steps)), 'no-charter', published);
        if ('error' in answer) throw new Error(answer.error);
        const action = JSON.parse(answer.action);
        steps = takeStep(scenario, steps, action.name, action.args);
      }
      expect(steps, scenario.id).toEqual(runBrain(policyFollower, scenario));
      expect(world.requests, scenario.id).toEqual(bench.requests);
    }
  });

  test('reports a turn without a tool call, or a refusal, in the words the desk tick reads', async () => {
    const scenario = SCENARIO_BY_ID['lend-clean-approve'];
    const obs = observe(scenario, deliver(scenario, []));
    const chatty = claudeTurn(fakeClaude(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Let me think.' }] })).client, { model: 'm' });
    expect(await answerDesk(chatty, request(obs), 'charter', published)).toEqual({ error: 'no tool call: Let me think.' });
    const refuser = claudeTurn(fakeClaude(() => ({ stop_reason: 'refusal', content: [] })).client, { model: 'm' });
    expect(await answerDesk(refuser, request(obs), 'charter', published)).toEqual({ error: 'refusal' });
  });

  test('plays a test script with no API call', async () => {
    const scenario = SCENARIO_BY_ID['collect-chapter13'];
    const answer = await answerDesk(deskTurnFor('script:policy'), request(observe(scenario, deliver(scenario, []))), 'charter', published);
    expect('action' in answer && JSON.parse(answer.action).name).toBe(policyFollower(JSON.parse(observe(scenario, deliver(scenario, [])))).tool);
    expect(() => deskTurnFor('script:nobody')).toThrow(/no test script/);
    expect(() => deskTurnFor('nowhere:model')).toThrow(/unknown provider/);
  });

  test('answers on the connection with the case’s own prompt variant', async () => {
    const scenario = SCENARIO_BY_ID['lend-clean-approve'];
    const calls: any[] = [];
    const seen: string[] = [];
    const conn: DeskConnection = {
      db: {
        meta: { key: { find: key => (key === 'finance_tools' ? { value: JSON.stringify(published) } : undefined) } },
        financeCase: { iter: () => [{ pendingRequestId: 7n, status: 'open', variant: 'no-charter' }] },
      },
      reducers: {
        submitDecision: async args => calls.push({ submit: args }),
        failDecision: async args => calls.push({ fail: args }),
      },
    };
    const recorder = () => async (system: string, tools: unknown[], observation: string) => {
      seen.push(system);
      return { call: { name: 'verify_identity', args: { subject_id: 'P01' } }, notes: ['checking'], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    };
    await answerDeskRequest(conn, request(observe(scenario, deliver(scenario, [])), 7n), { turnFor: recorder });
    expect(seen[0]).not.toContain('Desk policy');
    expect(calls).toEqual([{ submit: { requestId: 7n, action: '{"name":"verify_identity","args":{"subject_id":"P01"}}', thought: 'checking', latencyMs: expect.any(Number) } }]);

    // A request with no open case is failed, not answered.
    await answerDeskRequest(conn, request('{}', 8n), { turnFor: recorder, caseWaitMs: 200 });
    expect(calls[1]).toEqual({ fail: { requestId: 8n, error: 'no open finance case for this request', latencyMs: expect.any(Number) } });
  });
});
