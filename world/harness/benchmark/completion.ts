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
