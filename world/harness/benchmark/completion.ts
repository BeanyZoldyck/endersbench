import { assignmentForDecision, type AgentAssignment } from './roster.js';

type DecisionStatus = { status: string; action?: string; error?: string };

export function canSubmitDecision(closing: boolean, decision: DecisionStatus | null | undefined): boolean {
  return !closing && decision?.status === 'pending';
}

// Rejected game actions are answers, and are part of the benchmark evidence.
// Provider failures have no submitted action and cannot establish a valid run.
export function hasIncompleteDecisions(decisions: DecisionStatus[]): boolean {
  return decisions.some(decision => decision.status === 'pending'
    || decision.status === 'failed' && !decision.action
    || decision.status === 'expired' && !/^(superseded:|knocked out$|agent is a ghost$|agent died$)/.test(decision.error ?? ''));
}

type RosterAgent = { id: bigint; name: string; modelId: string; kind: string; alive: boolean };

export function hasCompleteRoster(agents: Omit<RosterAgent, 'alive'>[], assignments: ReadonlyMap<bigint, AgentAssignment>): boolean {
  if (assignments.size < 1 || agents.length !== assignments.size) return false;
  try {
    for (const agent of agents) assignmentForDecision(assignments, { agentId: agent.id, modelId: agent.modelId }, agent);
    return true;
  } catch { return false; }
}

export function rosterHasFinished(rescueState: string | null | undefined, agents: RosterAgent[], assignments: ReadonlyMap<bigint, AgentAssignment>): boolean {
  return hasCompleteRoster(agents, assignments) && (rescueState != null && rescueState !== 'waiting' || agents.every(agent => !agent.alive));
}
