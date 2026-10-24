// Reducers only. The world's logic lives in sim.ts (body), actions.ts
// (what agents can do), ethics.ts (detectors), observe.ts (perception) and
// scenario.ts (the plane-crash clearing).

import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import spacetimedb, { brainTimer, tickTimer } from './schema';
import { TOOLS } from './tools';
import type { Agent, Ctx } from './ctx';
import { centre, clampToCircle, getWorld } from './ctx';
import { applyAction, type Outcome } from './actions';
import { ensureScore, updateTemptations } from './ethics';
import { observe } from './observe';
import { seedWorld, settleSurvivor, updateFairShare } from './scenario';
import { dropAll, tickWorld } from './sim';
import { HEARTBEAT_MS, MAP_RADIUS, MAP_SIZE, REQUEST_TIMEOUT_MS, RETRY_MS, WINTER_AT_MS } from './rules';

export { default } from './schema';

const TICK_MICROS = 50_000n;
const BRAIN_MICROS = 250_000n;
const MAX_TICK_MS = 250; // cap one tick's step so a pause doesn't teleport anyone
const COLORS = ['#c8553d', '#2e86ab', '#e0a030', '#6a994e', '#9b5de5', '#3bb273', '#d1495b', '#00798c'];

function isWorker(ctx: Ctx) {
  return ctx.db.harnessWorker.identity.find(ctx.sender) != null;
}

function isAdmin(ctx: Ctx) {
  return ctx.db.admin.identity.find(ctx.sender) != null;
}

function requireWorkerOrAdmin(ctx: Ctx) {
  if (!isWorker(ctx) && !isAdmin(ctx)) throw new SenderError('not authorised');
}

function startTimers(ctx: Ctx) {
  if (ctx.db.tickTimer.count() === 0n) {
    ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_MICROS) });
  }
  if (ctx.db.brainTimer.count() === 0n) {
    ctx.db.brainTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BRAIN_MICROS) });
  }
}

function controlledBy(ctx: Ctx): Agent | undefined {
  return [...ctx.db.agent.iter()].find(a => a.controller?.equals(ctx.sender));
}

function parseAction(raw: string): { name: string; args: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.name !== 'string') return null;
    const args = parsed.args && typeof parsed.args === 'object' ? parsed.args : {};
    return { name: parsed.name, args };
  } catch {
    return null;
  }
}

function newAgent(ctx: Ctx, f: { name: string; kind: string; modelId: string; x: number; y: number; controller?: Agent['controller'] }) {
  const index = Number(ctx.db.agent.count());
  const a = ctx.db.agent.insert({
    id: 0n,
    name: f.name,
    kind: f.kind,
    modelId: f.modelId,
    controller: f.controller,
    color: COLORS[index % COLORS.length],
    x: f.x,
    y: f.y,
    intentKind: 'idle',
    targetX: f.x,
    targetY: f.y,
    targetAgentId: 0n,
    targetNodeId: 0n,
    intentSinceMs: 0,
    progressMs: 0,
    hp: 100,
    hunger: 100,
    alive: true,
    ghostUntilMs: 0,
    homeX: f.x,
    homeY: f.y,
    lastHitById: 0n,
    lastHitAtMs: 0,
    thought: '',
    pendingRequestId: 0n,
    nextThinkAtMs: 0,
    wake: false,
    wakeReason: '',
  });
  ensureScore(ctx, a.id);
  return a;
}

function logAction(ctx: Ctx, agentId: bigint, requestId: bigint, action: string, outcome: Outcome) {
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

export const init = spacetimedb.init(ctx => {
  ctx.db.world.insert({
    id: 0,
    tick: 0n,
    gameTimeMs: 0,
    timeScale: 1,
    lastTickAt: ctx.timestamp,
    running: true,
    width: MAP_SIZE,
    height: MAP_SIZE,
    radius: MAP_RADIUS,
    phase: 'autumn',
    winterAtMs: WINTER_AT_MS,
    fairShare: 0,
  });
  ctx.db.admin.insert({ identity: ctx.sender });
  ctx.db.meta.insert({ key: 'tools', value: JSON.stringify(TOOLS) });
  seedWorld(ctx);
  updateFairShare(ctx);
  startTimers(ctx);
});

// Advances the world by real elapsed time × timeScale. This is the fast body.
export const tick = spacetimedb.reducer({ onSchedule: tickTimer }, { timer: tickTimer.rowType }, ctx => {
  const w = getWorld(ctx);
  const elapsedMs = Number(ctx.timestamp.microsSinceUnixEpoch - w.lastTickAt.microsSinceUnixEpoch) / 1000;
  const realMs = Math.min(Math.max(elapsedMs, 0), MAX_TICK_MS);
  const gameDtMs = w.running ? realMs * w.timeScale : 0;
  ctx.db.world.id.update({ ...w, tick: w.tick + 1n, gameTimeMs: w.gameTimeMs + gameDtMs, lastTickAt: ctx.timestamp });
  tickWorld(ctx, w.gameTimeMs, w.gameTimeMs + gameDtMs);
});

// The slow brain's clock: counts temptation exposures, then opens a decision
// request for each LLM agent with nothing in flight that is due to think.
export const brainTick = spacetimedb.reducer({ onSchedule: brainTimer }, { timer: brainTimer.rowType }, ctx => {
  const w = getWorld(ctx);
  if (!w.running) return;
  updateTemptations(ctx);

  for (const { id } of [...ctx.db.agent.iter()]) {
    const a = ctx.db.agent.id.find(id)!;
    if (a.kind !== 'llm' || !a.alive) continue;

    if (a.pendingRequestId !== 0n) {
      const req = ctx.db.decisionRequest.id.find(a.pendingRequestId);
      const ageMs = req ? Number(ctx.timestamp.microsSinceUnixEpoch - req.createdAt.microsSinceUnixEpoch) / 1000 : Infinity;
      if (req && req.status === 'pending' && ageMs < REQUEST_TIMEOUT_MS) continue;
      if (req && req.status === 'pending') ctx.db.decisionRequest.id.update({ ...req, status: 'expired', error: 'no answer in time' });
      ctx.db.agent.id.update({ ...a, pendingRequestId: 0n, wake: true, wakeReason: 'retry' });
      continue;
    }

    if (!a.wake && w.gameTimeMs < a.nextThinkAtMs) continue;
    const reason = a.wake ? a.wakeReason : 'heartbeat';
    const req = ctx.db.decisionRequest.insert({
      id: 0n,
      agentId: a.id,
      modelId: a.modelId,
      status: 'pending',
      observation: observe(ctx, a, w, reason),
      gameTimeMs: w.gameTimeMs,
      createdAt: ctx.timestamp,
      action: '',
      thought: '',
      error: '',
      latencyMs: 0,
    });
    ctx.db.agent.id.update({ ...a, pendingRequestId: req.id, wake: false, wakeReason: '' });
  }
});

// The only door for model output.
export const submitDecision = spacetimedb.reducer(
  { requestId: t.u64(), action: t.string(), thought: t.string(), latencyMs: t.u32() },
  (ctx, { requestId, action, thought, latencyMs }) => {
    if (!isWorker(ctx)) throw new SenderError('not a harness worker');
    const req = ctx.db.decisionRequest.id.find(requestId);
    if (!req || req.status !== 'pending') throw new SenderError('request is not pending');
    const me = ctx.db.agent.id.find(req.agentId);
    if (!me) throw new SenderError('agent is gone');
    const w = getWorld(ctx);

    if (!me.alive) {
      ctx.db.decisionRequest.id.update({ ...req, status: 'expired', action, thought: thought.slice(0, 120), error: 'agent is a ghost', latencyMs });
      ctx.db.agent.id.update({ ...me, pendingRequestId: 0n });
      return;
    }

    const parsed = parseAction(action);
    const outcome: Outcome = parsed
      ? applyAction(ctx, me, parsed.name, parsed.args)
      : { ok: false, error: 'action is not {"name": string, "args": object} JSON' };

    logAction(ctx, me.id, requestId, parsed ? JSON.stringify(parsed) : JSON.stringify({ raw: action }), outcome);
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
      thought: thought ? thought.slice(0, 120) : after.thought,
      pendingRequestId: 0n,
      nextThinkAtMs: w.gameTimeMs + (outcome.ok ? HEARTBEAT_MS : RETRY_MS),
    });
  }
);

// The harness reports a model call that failed outright (timeout, API error).
export const failDecision = spacetimedb.reducer(
  { requestId: t.u64(), error: t.string(), latencyMs: t.u32() },
  (ctx, { requestId, error, latencyMs }) => {
    if (!isWorker(ctx)) throw new SenderError('not a harness worker');
    const req = ctx.db.decisionRequest.id.find(requestId);
    if (!req || req.status !== 'pending') throw new SenderError('request is not pending');
    ctx.db.decisionRequest.id.update({ ...req, status: 'failed', error: error.slice(0, 500), latencyMs });
    const me = ctx.db.agent.id.find(req.agentId);
    if (me) ctx.db.agent.id.update({ ...me, pendingRequestId: 0n, nextThinkAtMs: getWorld(ctx).gameTimeMs + RETRY_MS });
  }
);

// Trust on first use: the first harness to connect to a fresh world owns it.
export const claimHarness = spacetimedb.reducer(ctx => {
  if (isWorker(ctx)) return;
  if (ctx.db.harnessWorker.count() > 0n && !isAdmin(ctx)) throw new SenderError('harness already claimed');
  ctx.db.harnessWorker.insert({ identity: ctx.sender });
});

// Adds an LLM survivor with a home and a chest. Idempotent by name, so a
// restarted harness can re-send its roster.
export const spawnAgent = spacetimedb.reducer({ name: t.string(), modelId: t.string() }, (ctx, { name, modelId }) => {
  requireWorkerOrAdmin(ctx);
  if (ctx.db.agent.name.find(name)) return;
  const a = newAgent(ctx, { name, kind: 'llm', modelId, x: 0, y: 0 });
  const { homeX, homeY } = settleSurvivor(ctx, a.id, name);
  ctx.db.agent.id.update({ ...ctx.db.agent.id.find(a.id)!, x: homeX, y: homeY, targetX: homeX, targetY: homeY, homeX, homeY });
  updateFairShare(ctx);
});

export const setTimeScale = spacetimedb.reducer({ timeScale: t.f64() }, (ctx, { timeScale }) => {
  requireWorkerOrAdmin(ctx);
  const w = getWorld(ctx);
  ctx.db.world.id.update({ ...w, timeScale: Math.min(Math.max(timeScale, 0.05), 4) });
});

// Pausing deletes the timers, so a paused world costs no Maincloud energy.
// Resuming restarts the clock from now, with no time jump.
export const setRunning = spacetimedb.reducer({ running: t.bool() }, (ctx, { running }) => {
  requireWorkerOrAdmin(ctx);
  ctx.db.world.id.update({ ...getWorld(ctx), running, lastTickAt: ctx.timestamp });
  if (running) {
    startTimers(ctx);
    return;
  }
  for (const timer of [...ctx.db.tickTimer.iter()]) ctx.db.tickTimer.scheduledId.delete(timer.scheduledId);
  for (const timer of [...ctx.db.brainTimer.iter()]) ctx.db.brainTimer.scheduledId.delete(timer.scheduledId);
});

export const joinAsHuman = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed) throw new SenderError('name required');
  if (controlledBy(ctx)) return;
  if (ctx.db.agent.name.find(trimmed)) throw new SenderError('name taken');
  const [cx, cy] = centre(getWorld(ctx));
  const humans = [...ctx.db.agent.iter()].filter(a => a.kind === 'human').length;
  newAgent(ctx, { name: trimmed, kind: 'human', modelId: 'human', x: cx - 4 + (humans % 5) * 2, y: cy + 4, controller: ctx.sender });
});

export const humanMoveTo = spacetimedb.reducer({ x: t.f32(), y: t.f32() }, (ctx, { x, y }) => {
  const me = controlledBy(ctx);
  if (!me) throw new SenderError('you do not control a character');
  const [tx, ty] = clampToCircle(getWorld(ctx), x, y);
  ctx.db.agent.id.update({ ...me, intentKind: 'move_to', targetX: tx, targetY: ty, targetAgentId: 0n, targetNodeId: 0n });
});

// Lets a person take any action a model can; detectors judge it the same way.
export const humanAct = spacetimedb.reducer({ action: t.string() }, (ctx, { action }) => {
  const me = controlledBy(ctx);
  if (!me) throw new SenderError('you do not control a character');
  if (!me.alive) throw new SenderError('you are a ghost until you respawn');
  const parsed = parseAction(action);
  if (!parsed) throw new SenderError('action is not {"name": string, "args": object} JSON');
  const outcome = applyAction(ctx, me, parsed.name, parsed.args);
  if (!outcome.ok) throw new SenderError(outcome.error);
  logAction(ctx, me.id, 0n, JSON.stringify(parsed), outcome);
});

export const humanSay = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  const me = controlledBy(ctx);
  if (!me) throw new SenderError('you do not control a character');
  const outcome = applyAction(ctx, me, 'say', { text });
  if (!outcome.ok) throw new SenderError(outcome.error);
});

// A human's character leaves with them; what they carried stays on the ground.
export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  for (const a of [...ctx.db.agent.iter()]) {
    if (a.kind !== 'human' || !a.controller?.equals(ctx.sender)) continue;
    dropAll(ctx, a);
    ctx.db.agent.id.delete(a.id);
  }
});
