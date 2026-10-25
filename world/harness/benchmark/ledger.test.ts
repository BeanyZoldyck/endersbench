import { expect, it, vi } from 'vitest';
import { answerDeskRequest } from '../finance/desk.js';
import type { DeskConnection } from '../finance/desk.js';
import { ledgerAssignment, ledgerTurn } from './ledger.js';
import type { AgentAssignment } from './roster.js';
import { financeTools } from '../../spacetimedb/src/finance/tools.js';

it('binds desk decisions to the actual case ID, not merely an allowed model', () => {
  const assignments = new Map<bigint, AgentAssignment>([
    [5n, { name: 'Ada', model: 'ChatGPT', modelId: 'openai:test' }],
    [9n, { name: 'Bo', model: 'Grok', modelId: 'openrouter:test' }],
  ]);
  const cases = [
    { id: 5n, modelId: 'openai:test', pendingRequestId: 25n, status: 'open' },
    { id: 9n, modelId: 'openrouter:test', pendingRequestId: 29n, status: 'open' },
  ];
  expect(ledgerAssignment(assignments, cases, { id: 25n, agentId: 0n, modelId: 'openai:test' }).name).toBe('Ada');
  expect(() => ledgerAssignment(assignments, cases, { id: 25n, agentId: 0n, modelId: 'openrouter:test' })).toThrow();
  expect(() => ledgerAssignment(assignments, cases, { id: 99n, agentId: 0n, modelId: 'openai:test' })).toThrow();
  expect(() => ledgerAssignment(assignments, cases, { id: 25n, agentId: 1n, modelId: 'openai:test' })).toThrow();
  expect(() => ledgerAssignment(assignments, cases.map(row => ({ ...row, status: 'closed' })), { id: 25n, agentId: 0n, modelId: 'openai:test' })).toThrow();
});

it('submits a finance decision through the existing desk path using only an injected brain', async () => {
  const decide = vi.fn(async () => ({ action: { name: 'request_credit_report', args: { subject: 'P01' } }, thought: 'Check the saved credit report.' }));
  const submitDecision = vi.fn(async () => undefined);
  const failDecision = vi.fn(async () => undefined);
  const request = { id: 8125n, agentId: 0n, modelId: 'openai:ledger-test', observation: JSON.stringify({ desk: 'lending', caseId: 'L-1001' }) };
  const conn: DeskConnection = {
    db: {
      meta: { key: { find: () => ({ value: JSON.stringify({ lending: financeTools('lending') }) }) } },
      financeCase: { iter: () => [{ pendingRequestId: request.id, status: 'open', variant: 'house-rules' }] },
    },
    reducers: { submitDecision, failDecision },
  };
  const result = await answerDeskRequest(conn, request, { turnFor: () => ledgerTurn({ provider: 'injected-test', decide }, 'Ledger analyst'), timeoutMs: 100 });
  expect(result).toEqual({ action: JSON.stringify({ name: 'request_credit_report', args: { subject: 'P01' } }), thought: 'Check the saved credit report.' });
  expect(decide).toHaveBeenCalledOnce();
  expect(decide.mock.calls[0]).toEqual([expect.objectContaining({ agentName: 'Ledger analyst', observation: { desk: 'lending', caseId: 'L-1001' }, tools: expect.any(Array), system: expect.any(String) })]);
  expect(submitDecision).toHaveBeenCalledWith(expect.objectContaining({ requestId: request.id, action: JSON.stringify({ name: 'request_credit_report', args: { subject: 'P01' } }) }));
  expect(failDecision).not.toHaveBeenCalled();
});
