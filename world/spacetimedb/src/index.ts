import { t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import spacetimedb, { brainTimer, tickTimer } from './schema';
import { TOOLS } from './tools';

export { default } from './schema';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type Agent = NonNullable<ReturnType<Ctx['db']['agent']['id']['find']>>;
type World = NonNullable<ReturnType<Ctx['db']['world']['id']['find']>>;

const TICK_MICROS = 50_000n;
const BRAIN_MICROS = 250_000n;
const MAX_TICK_MS = 250; // cap one tick's step so a pause doesn't teleport anyone
const WALK_SPEED = 3; // tiles per game second
const FOLLOW_DISTANCE = 1.5;
const VIEW_RADIUS = 12;
const HEAR_RADIUS = 8;
const HEARD_WINDOW_MS = 15_000;
const HEARTBEAT_MS = 5_000; // think at least this often (game time)
const RETRY_MS = 1_000; // re-ask this soon after a failed action
const REQUEST_TIMEOUT_MS = 30_000; // wall time before a pending request expires
const COLORS = ['#e4572e', '#2e86ab', '#f3a712', '#7a9e3f', '#a23b72', '#3bb273', '#6c5ce7', '#ff7f50'];

function getWorld(ctx: Ctx): World {
  const w = ctx.db.world.id.find(0);
  if (!w) throw new SenderError('world not initialised');
  return w;
}

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

function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(bx - ax, by - ay);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function describeIntent(ctx: Ctx, a: Agent) {
  switch (a.intentKind) {
    case 'move_to':
      return `walking to (${round1(a.targetX)}, ${round1(a.targetY)})`;
    case 'follow': {
      const target = ctx.db.agent.id.find(a.targetAgentId);
      return `following ${target?.name ?? 'someone'}`;
    }
    default:
      return 'idle';
  }
}

function wakeAgent(ctx: Ctx, a: Agent, reason: string) {
  ctx.db.agent.id.update({ ...a, wake: true, wakeReason: reason });
}

// Everything the model is allowed to know, computed on the server so no
// client can see more than its agent perceives.
function observe(ctx: Ctx, me: Agent, w: World, reason: string) {
  const others = [...ctx.db.agent.iter()]
    .filter(o => o.id !== me.id && o.alive)
    .map(o => ({ o, d: distance(me.x, me.y, o.x, o.y) }))
    .filter(({ d }) => d <= VIEW_RADIUS)
    .sort((a, b) => a.d - b.d)
    .map(({ o, d }) => ({
      id: Number(o.id),
      name: o.name,
      x: round1(o.x),
      y: round1(o.y),
      distance: round1(d),
      doing: describeIntent(ctx, o),
    }));

  const names = new Map([...ctx.db.agent.iter()].map(a => [a.id, a.name]));
  const heard = [...ctx.db.message.iter()]
    .filter(
      m =>
        w.gameTimeMs - m.gameTimeMs <= HEARD_WINDOW_MS &&
        distance(me.x, me.y, m.x, m.y) <= HEAR_RADIUS
    )
    .sort((a, b) => a.gameTimeMs - b.gameTimeMs)
    .map(m => ({
      from: m.fromAgentId === me.id ? 'you' : names.get(m.fromAgentId) ?? 'someone',
      text: m.text,
      secondsAgo: round1((w.gameTimeMs - m.gameTimeMs) / 1000),
    }));

  const last = [...ctx.db.actionLog.agentId.filter(me.id)].sort(
    (a, b) => b.gameTimeMs - a.gameTimeMs
  )[0];

  return JSON.stringify({
    you: {
      id: Number(me.id),
      name: me.name,
      x: round1(me.x),
      y: round1(me.y),
      hp: round1(me.hp),
      hunger: round1(me.hunger),
      doing: describeIntent(ctx, me),
    },
    time: { gameSeconds: round1(w.gameTimeMs / 1000) },
    map: { width: w.width, height: w.height },
    wakeReason: reason,
    nearby: { agents: others },
    heard,
    lastAction: last ? { action: JSON.parse(last.action), ok: last.ok, error: last.error } : null,
  });
}

type Outcome = { ok: true } | { ok: false; error: string };

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clampTo(v: number, max: number) {
  return Math.min(Math.max(v, 0), max);
}

// Validates an action against the world as it is now (it moved while the
// model was thinking) and applies it. Never throws for a bad action, so the
// failure is recorded rather than rolled back.
function applyAction(ctx: Ctx, me: Agent, w: World, name: string, args: Record<string, unknown>): Outcome {
  switch (name) {
    case 'move_to': {
      const x = num(args.x);
      const y = num(args.y);
      if (x == null || y == null) return { ok: false, error: 'move_to needs numeric x and y' };
      ctx.db.agent.id.update({
        ...me,
        intentKind: 'move_to',
        targetX: clampTo(x, w.width),
        targetY: clampTo(y, w.height),
        targetAgentId: 0n,
      });
      return { ok: true };
    }
    case 'follow': {
      const id = num(args.agent_id);
      const target = id == null ? null : ctx.db.agent.id.find(BigInt(Math.trunc(id)));
      if (!target || !target.alive || target.id === me.id) {
        return { ok: false, error: 'follow needs the id of another living agent' };
      }
      ctx.db.agent.id.update({ ...me, intentKind: 'follow', targetAgentId: target.id });
      return { ok: true };
    }
    case 'say': {
      const text = typeof args.text === 'string' ? args.text.trim().slice(0, 200) : '';
      if (!text) return { ok: false, error: 'say needs non-empty text' };
      ctx.db.message.insert({
        id: 0n,
        fromAgentId: me.id,
        text,
        x: me.x,
        y: me.y,
        gameTimeMs: w.gameTimeMs,
      });
      for (const other of [...ctx.db.agent.iter()]) {
        if (other.id !== me.id && other.alive && distance(me.x, me.y, other.x, other.y) <= HEAR_RADIUS) {
          wakeAgent(ctx, other, 'spoken_to');
        }
      }
      return { ok: true };
    }
    case 'idle':
      ctx.db.agent.id.update({ ...me, intentKind: 'idle', targetAgentId: 0n });
      return { ok: true };
    default:
      return { ok: false, error: `unknown action '${name}'` };
  }
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

function newAgent(ctx: Ctx, fields: { name: string; kind: string; modelId: string; x: number; y: number; controller?: Agent['controller'] }) {
  const index = Number(ctx.db.agent.count());
  return ctx.db.agent.insert({
    id: 0n,
    name: fields.name,
    kind: fields.kind,
    modelId: fields.modelId,
    controller: fields.controller,
    color: COLORS[index % COLORS.length],
    x: fields.x,
    y: fields.y,
    intentKind: 'idle',
    targetX: fields.x,
    targetY: fields.y,
    targetAgentId: 0n,
    hp: 100,
    hunger: 100,
    alive: true,
    thought: '',
    pendingRequestId: 0n,
    nextThinkAtMs: 0,
    wake: false,
    wakeReason: '',
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
    width: 64,
    height: 64,
  });
  ctx.db.admin.insert({ identity: ctx.sender });
  ctx.db.meta.insert({ key: 'tools', value: JSON.stringify(TOOLS) });
  startTimers(ctx);
});

// Advances the world by real elapsed time × timeScale and carries out each
// agent's current intent. Models never run here; this is the fast body.
export const tick = spacetimedb.reducer({ onSchedule: tickTimer }, { timer: tickTimer.rowType }, ctx => {
  const w = getWorld(ctx);
  const elapsedMs = Number(ctx.timestamp.microsSinceUnixEpoch - w.lastTickAt.microsSinceUnixEpoch) / 1000;
  const realMs = Math.min(Math.max(elapsedMs, 0), MAX_TICK_MS);
  const gameDtMs = w.running ? realMs * w.timeScale : 0;
  ctx.db.world.id.update({
    ...w,
    tick: w.tick + 1n,
    gameTimeMs: w.gameTimeMs + gameDtMs,
    lastTickAt: ctx.timestamp,
  });
  if (gameDtMs === 0) return;

  const step = (WALK_SPEED * gameDtMs) / 1000;
  for (const a of [...ctx.db.agent.iter()]) {
    if (!a.alive || (a.intentKind !== 'move_to' && a.intentKind !== 'follow')) continue;

    let tx = a.targetX;
    let ty = a.targetY;
    let stopAt = 0;
    if (a.intentKind === 'follow') {
      const target = ctx.db.agent.id.find(a.targetAgentId);
      if (!target || !target.alive) {
        ctx.db.agent.id.update({ ...a, intentKind: 'idle', wake: true, wakeReason: 'lost_target' });
        continue;
      }
      tx = target.x;
      ty = target.y;
      stopAt = FOLLOW_DISTANCE;
    }

    const d = distance(a.x, a.y, tx, ty);
    if (d <= stopAt) continue;
    if (d - stopAt <= step) {
      if (a.intentKind === 'move_to') {
        ctx.db.agent.id.update({ ...a, x: tx, y: ty, intentKind: 'idle', wake: true, wakeReason: 'arrived' });
      } else {
        const k = (d - stopAt) / d;
        ctx.db.agent.id.update({ ...a, x: a.x + (tx - a.x) * k, y: a.y + (ty - a.y) * k });
      }
      continue;
    }
    const k = step / d;
    ctx.db.agent.id.update({ ...a, x: a.x + (tx - a.x) * k, y: a.y + (ty - a.y) * k });
  }
});

// The slow brain's clock: opens a decision request for each LLM agent that
// has nothing in flight and is due to think (heartbeat) or was woken by an event.
export const brainTick = spacetimedb.reducer({ onSchedule: brainTimer }, { timer: brainTimer.rowType }, ctx => {
  const w = getWorld(ctx);
  if (!w.running) return;
  for (const a of [...ctx.db.agent.iter()]) {
    if (a.kind !== 'llm' || !a.alive) continue;

    if (a.pendingRequestId !== 0n) {
      const req = ctx.db.decisionRequest.id.find(a.pendingRequestId);
      const ageMs = req ? Number(ctx.timestamp.microsSinceUnixEpoch - req.createdAt.microsSinceUnixEpoch) / 1000 : Infinity;
      if (req && req.status === 'pending' && ageMs < REQUEST_TIMEOUT_MS) continue;
      if (req && req.status === 'pending') {
        ctx.db.decisionRequest.id.update({ ...req, status: 'expired', error: 'no answer in time' });
      }
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

    const parsed = parseAction(action);
    const outcome: Outcome = parsed
      ? applyAction(ctx, me, w, parsed.name, parsed.args)
      : { ok: false, error: 'action is not {"name": string, "args": object} JSON' };
    const error = outcome.ok ? '' : outcome.error;

    ctx.db.actionLog.insert({
      id: 0n,
      agentId: me.id,
      requestId,
      action: parsed ? JSON.stringify(parsed) : JSON.stringify({ raw: action }),
      ok: outcome.ok,
      error,
      gameTimeMs: w.gameTimeMs,
    });
    ctx.db.decisionRequest.id.update({
      ...req,
      status: outcome.ok ? 'done' : 'failed',
      action,
      thought: thought.slice(0, 120),
      error,
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
    if (me) {
      const w = getWorld(ctx);
      ctx.db.agent.id.update({ ...me, pendingRequestId: 0n, nextThinkAtMs: w.gameTimeMs + RETRY_MS });
    }
  }
);

// Trust on first use: the first harness to connect to a fresh world owns it.
export const claimHarness = spacetimedb.reducer(ctx => {
  if (isWorker(ctx)) return;
  if (ctx.db.harnessWorker.count() > 0n && !isAdmin(ctx)) {
    throw new SenderError('harness already claimed');
  }
  ctx.db.harnessWorker.insert({ identity: ctx.sender });
});

export const spawnAgent = spacetimedb.reducer(
  { name: t.string(), modelId: t.string(), x: t.f32(), y: t.f32() },
  (ctx, { name, modelId, x, y }) => {
    requireWorkerOrAdmin(ctx);
    if (ctx.db.agent.name.find(name)) return; // idempotent, so a restarted harness can re-send its roster
    const w = getWorld(ctx);
    newAgent(ctx, { name, kind: 'llm', modelId, x: clampTo(x, w.width), y: clampTo(y, w.height) });
  }
);

export const setTimeScale = spacetimedb.reducer({ timeScale: t.f64() }, (ctx, { timeScale }) => {
  requireWorkerOrAdmin(ctx);
  const w = getWorld(ctx);
  ctx.db.world.id.update({ ...w, timeScale: Math.min(Math.max(timeScale, 0.05), 4) });
});

export const setRunning = spacetimedb.reducer({ running: t.bool() }, (ctx, { running }) => {
  requireWorkerOrAdmin(ctx);
  const w = getWorld(ctx);
  ctx.db.world.id.update({ ...w, running });
  if (running) startTimers(ctx);
});

export const joinAsHuman = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed) throw new SenderError('name required');
  const existing = [...ctx.db.agent.iter()].find(a => a.controller?.equals(ctx.sender));
  if (existing) return;
  if (ctx.db.agent.name.find(trimmed)) throw new SenderError('name taken');
  const w = getWorld(ctx);
  newAgent(ctx, { name: trimmed, kind: 'human', modelId: 'human', x: w.width / 2, y: w.height / 2, controller: ctx.sender });
});

export const humanMoveTo = spacetimedb.reducer({ x: t.f32(), y: t.f32() }, (ctx, { x, y }) => {
  const me = [...ctx.db.agent.iter()].find(a => a.controller?.equals(ctx.sender));
  if (!me) throw new SenderError('you do not control a character');
  const w = getWorld(ctx);
  ctx.db.agent.id.update({
    ...me,
    intentKind: 'move_to',
    targetX: clampTo(x, w.width),
    targetY: clampTo(y, w.height),
    targetAgentId: 0n,
  });
});

export const humanSay = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  const me = [...ctx.db.agent.iter()].find(a => a.controller?.equals(ctx.sender));
  if (!me) throw new SenderError('you do not control a character');
  const outcome = applyAction(ctx, me, getWorld(ctx), 'say', { text });
  if (!outcome.ok) throw new SenderError(outcome.error);
});

// A human's character leaves with them, so the world isn't full of ghosts.
export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  for (const a of [...ctx.db.agent.iter()]) {
    if (a.kind === 'human' && a.controller?.equals(ctx.sender)) ctx.db.agent.id.delete(a.id);
  }
});
