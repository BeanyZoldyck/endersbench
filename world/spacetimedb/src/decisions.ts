// The only door for model output, whoever asked the model: the harness
// (submitDecision, failDecision) or the module's own think procedure
// (settleThought). Both settle a request the same way.

import { SenderError } from 'spacetimedb/server';
import type { Ctx } from './ctx';
import { getWorld } from './ctx';
import { applyAction, type Outcome } from './actions';
import type { Decision } from './brain/protocol';
import { HEARTBEAT_MS, RETRY_MS } from './rules';

export type DecisionRequest = NonNullable<ReturnType<Ctx['db']['decisionRequest']['id']['find']>>;

export function parseAction(raw: string): { name: string; args: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.name !== 'string') return null;
    const args = parsed.args && typeof parsed.args === 'object' ? parsed.args : {};
    return { name: parsed.name, args };
  } catch {
    return null;
  }
}

export function logAction(ctx: Ctx, agentId: bigint, requestId: bigint, action: string, outcome: Outcome) {
  ctx.db.actionLog.insert({
    id: 0n,
    agentId,
    requestId,
    action,
    ok: outcome.ok,
    error: outcome.ok ? '' : outcome.error,
    gameTimeMs: getWorld(ctx).gameTimeMs,
  });
}

// Records a model's answer, or its failure with the error, for the viewer's warning.
export function noteModel(ctx: Ctx, modelId: string, error?: string) {
  const h = ctx.db.modelHealth.modelId.find(modelId)
    ?? ctx.db.modelHealth.insert({ modelId, answered: 0, failed: 0, failingInARow: 0, lastError: '', lastErrorAt: ctx.timestamp });
  ctx.db.modelHealth.modelId.update(error === undefined
    ? { ...h, answered: h.answered + 1, failingInARow: 0 }
    : { ...h, failed: h.failed + 1, failingInARow: h.failingInARow + 1, lastError: error.slice(0, 200), lastErrorAt: ctx.timestamp });
}

// Whether this run's survivors are asked by the module itself (beginRun) or by the harness.
export function runBrains(ctx: Ctx): 'database' | 'harness' {
  try {
    return JSON.parse(ctx.db.meta.key.find('run')?.value ?? '{}').brains === 'database' ? 'database' : 'harness';
  } catch {
    return 'harness';
  }
}

export function applyDecision(ctx: Ctx, req: DecisionRequest, action: string, thought: string, latencyMs: number) {
  const me = ctx.db.agent.id.find(req.agentId);
  if (!me) throw new SenderError('agent is gone');
  noteModel(ctx, req.modelId);
  const w = getWorld(ctx);

  if (!me.alive) {
    ctx.db.decisionRequest.id.update({ ...req, status: 'expired', action, thought: thought.slice(0, 120), error: 'agent is a ghost', latencyMs });
    ctx.db.agent.id.update({ ...me, pendingRequestId: 0n });
    return;
  }

  // The thought is recorded before the action, so a violation the action
  // causes is filed with the words of the decision that caused it.
  // Empty output is evidence too: never attach an earlier explanation.
  ctx.db.agent.id.update({ ...me, thought: thought.slice(0, 120) });
  const parsed = parseAction(action);
  const outcome: Outcome = parsed
    ? applyAction(ctx, ctx.db.agent.id.find(me.id)!, parsed.name, parsed.args)
    : { ok: false, error: 'action is not {"name": string, "args": object} JSON' };

  logAction(ctx, me.id, req.id, parsed ? JSON.stringify(parsed) : JSON.stringify({ raw: action }), outcome);
  ctx.db.decisionRequest.id.update({
    ...req,
    status: outcome.ok ? 'done' : 'failed',
    action,
    thought: thought.slice(0, 120),
    error: outcome.ok ? '' : outcome.error,
    latencyMs,
  });

  const after = ctx.db.agent.id.find(me.id)!;
  ctx.db.agent.id.update({
    ...after,
    thought: thought.slice(0, 120),
    pendingRequestId: 0n,
    nextThinkAtMs: w.gameTimeMs + (outcome.ok ? HEARTBEAT_MS : RETRY_MS),
    lastLatencyMs: latencyMs,
  });
}

// A model call that failed outright (timeout, API error, no tool call).
export function failRequest(ctx: Ctx, req: DecisionRequest, error: string, latencyMs: number) {
  ctx.db.decisionRequest.id.update({ ...req, status: 'failed', error: error.slice(0, 500), latencyMs });
  noteModel(ctx, req.modelId, error);
  const me = ctx.db.agent.id.find(req.agentId);
  if (me) ctx.db.agent.id.update({ ...me, pendingRequestId: 0n, nextThinkAtMs: getWorld(ctx).gameTimeMs + RETRY_MS });
}

// The think procedure's answer. A request that expired, or whose survivor is
// gone, while the model was thinking is left as it is: returns false.
export function settleThought(ctx: Ctx, requestId: bigint, result: { decision: Decision } | { error: string }, latencyMs: number): boolean {
  const req = ctx.db.decisionRequest.id.find(requestId);
  if (!req || req.status !== 'pending') return false;
  if (!ctx.db.agent.id.find(req.agentId)) {
    ctx.db.decisionRequest.id.update({ ...req, status: 'expired', error: 'agent is gone', latencyMs });
    return false;
  }
  if ('decision' in result) applyDecision(ctx, req, JSON.stringify(result.decision.action), result.decision.thought, latencyMs);
  else failRequest(ctx, req, result.error, latencyMs);
  return true;
}
