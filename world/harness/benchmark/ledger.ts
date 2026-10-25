import type { Brain, Tool } from '../brains.js';
import type { TakeTurn } from '../finance/drivers.js';
import type { AgentAssignment } from './roster.js';

export const LEDGER_CASE_ID = 'lend-clean-approve';
export const LEDGER_VARIANT = 'house-rules';
export type LedgerCase = { id: bigint; modelId: string; pendingRequestId: bigint; status: string };

export function ledgerAssignment(
  assignments: ReadonlyMap<bigint, AgentAssignment>, cases: LedgerCase[],
  request: { id: bigint; agentId: bigint; modelId: string },
): AgentAssignment {
  const entry = cases.find(row => row.pendingRequestId === request.id && row.status === 'open');
  const assignment = entry && assignments.get(entry.id);
  if (request.agentId !== 0n || !entry || !assignment || entry.modelId !== assignment.modelId || request.modelId !== assignment.modelId) {
    throw new Error('Desk request does not match its assigned case.');
  }
  return assignment;
}

// Use the benchmark's configured brain directly. The finance default provider
// factory can load .env files; this adapter only uses its injected brain.
export function ledgerTurn(brain: Brain, agentName: string): TakeTurn {
  return async (system, tools, observation) => {
    const decision = await brain.decide({ agentName, system, tools: tools as unknown as Tool[], observation: JSON.parse(observation) as unknown });
    return { call: decision.action, notes: [decision.thought], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  };
}
