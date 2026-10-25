// Reducers only. The world's logic lives in sim.ts (body), actions.ts
// (what agents can do), ethics.ts (detectors), observe.ts (perception) and
// scenario.ts (the plane-crash clearing).

import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import spacetimedb, { brainTimer, LeaderboardRow, tickTimer } from './schema';
import { aggregateLeaderboard, checkRunEnd, closeRun, openRun } from './history';
import { TOOLS } from './tools';
import type { Agent, Ctx } from './ctx';
import { centre, clampToCircle, getWorld } from './ctx';
import { applyAction, type Outcome } from './actions';
import { updateCrateWindows } from './crate';
import { ensureScore, updateTemptations } from './ethics';
import { updateExploration } from './explore';
import { observe } from './observe';
import { noticeLosses } from './memory';
import { physicsContract, SCENARIO, seedWorld, settleSurvivor, updateFairShare } from './scenario';
import { dropAll, tickWorld } from './sim';
import { startTimers, stopTimers } from './timers';
import { defineDeskReducers, deskMeta, routeDeskDecision } from './desk';
import { applyDecision, failRequest, logAction, noteModel, parseAction, runBrains } from './decisions';
import { defineThink } from './brain/think';
import { DATABASE_PROVIDERS, splitModelId } from './brain/protocol';
import { promptVersion, systemPrompt } from './brain/prompt';
import {
  DAY_LENGTH_MS,
  DAY_OFFSET_MS,
  HEARTBEAT_MS,
  MAP_RADIUS,
  MAP_SIZE,
  REQUEST_TIMEOUT_MS,
  RESCUE_AT_MS,
  RETRY_MS,
  WINTER_AT_MS,
} from './rules';

export { default } from './schema';

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

// Scheduled reducers run as the database itself. A client calling one
// directly could step the world or count temptations outside the clock.
function requireScheduler(ctx: Ctx) {
  if (!ctx.sender.equals(ctx.databaseIdentity)) throw new SenderError('only the scheduler runs this');
}


// The tool catalog and physics contract. Refreshed whenever a harness
// connects, so a hot-published module's new actions reach the models.
function publishMeta(ctx: Ctx) {
  const entries = { tools: JSON.stringify(TOOLS), physics: physicsContract(getWorld(ctx)), scenario: JSON.stringify(SCENARIO), ...deskMeta() };
  for (const [key, value] of Object.entries(entries)) {
    if (ctx.db.meta.key.find(key)) ctx.db.meta.key.update({ key, value });
    else ctx.db.meta.insert({ key, value });
  }
}

function controlledBy(ctx: Ctx): Agent | undefined {
  return [...ctx.db.agent.iter()].find(a => a.controller?.equals(ctx.sender));
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
    role: '',
    backstory: '',
    x: f.x,
    y: f.y,
    vx: 0,
    vy: 0,
    kx: 0,
    ky: 0,
    stunnedUntilMs: 0,
    stuckMs: 0,
    intentKind: 'idle',
    targetX: f.x,
    targetY: f.y,
    targetAgentId: 0n,
    targetNodeId: 0n,
    intentSinceMs: 0,
    progressMs: 0,
    hp: 100,
    hunger: 100,
    warmth: 100,
    pinned: false,
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
    pendingAction: '',
    lastLatencyMs: 0,
  });
  ensureScore(ctx, a.id);
  return a;
}


// A fresh clearing at game time zero: map, supplies, hazards, clock running.
function startRun(ctx: Ctx, foodScale = 1, roleOffset = 0, rescueSeats = 0) {
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
    dayLengthMs: DAY_LENGTH_MS,
    dayOffsetMs: DAY_OFFSET_MS,
    daylight: 'day',
    rescueAtMs: RESCUE_AT_MS,
    rescueState: 'waiting',
    foodScale,
    roleOffset,
    rescueSeats,
  });
  publishMeta(ctx);
  seedWorld(ctx);
  updateFairShare(ctx);
  startTimers(ctx);
}

function addSurvivor(ctx: Ctx, name: string, modelId: string) {
  const a = newAgent(ctx, { name, kind: 'llm', modelId, x: 0, y: 0 });
  const { homeX, homeY, role, backstory } = settleSurvivor(ctx, a.id, name);
  ctx.db.agent.id.update({ ...ctx.db.agent.id.find(a.id)!, x: homeX, y: homeY, targetX: homeX, targetY: homeY, homeX, homeY, role, backstory });
  updateFairShare(ctx);
}

export const init = spacetimedb.init(ctx => {
  ctx.db.admin.insert({ identity: ctx.sender });
  startRun(ctx);
  openRun(ctx);
});

// Restart the experiment: the same model survivors in a fresh clearing at
// time zero. Humans leave and rejoin; the harness keeps its claim and simply
// answers the new run's requests. Only the harness or the publisher may: the
// shared world is public, and a viewer's reset would wipe a run in progress.
export const resetExperiment = spacetimedb.reducer(ctx => {
  requireWorkerOrAdmin(ctx);
  resetWorld(ctx, [...ctx.db.agent.iter()].filter(a => a.kind === 'llm').sort((a, b) => Number(a.id - b.id)));
});

// A fresh clearing at game time zero with exactly this roster; humans leave.
function resetWorld(ctx: Ctx, roster: { name: string; modelId: string }[]) {
  // A run that just ended is filed as it ended; an unfinished one as reset,
  // before its tables are cleared.
  checkRunEnd(ctx);
  closeRun(ctx, 'reset');
  const { foodScale, roleOffset, rescueSeats } = getWorld(ctx);
  stopTimers(ctx);
  const d = ctx.db;
  if (d.meta.key.find('interactive')) d.meta.key.delete('interactive');
  // Finance episodes have independent lifetimes; restarting the clearing must
  // not delete their pending requests and strand their live offices.
  for (const request of [...d.decisionRequest.iter()]) if (request.agentId !== 0n) d.decisionRequest.id.delete(request.id);
  for (const table of [d.world, d.agent, d.message, d.actionLog, d.resourceNode, d.container, d.item,
    d.structure, d.mob, d.hazard, d.memory, d.loss, d.temptation, d.ethicsEvent, d.score, d.modelHealth, d.explored, d.discovery, d.record, d.heardOf, d.crateWindow]) table.clear();
  startRun(ctx, foodScale || 1, roleOffset ?? 0, rescueSeats ?? 0);
  for (const a of roster) addSurvivor(ctx, a.name, a.modelId);
  openRun(ctx);
}

// The live leaderboard: finished runs aggregated by model, condition and
// rules version (history.ts), recomputed whenever a run closes.
export const leaderboard = spacetimedb.anonymousView({ name: 'leaderboard', public: true }, t.array(LeaderboardRow), ctx =>
  aggregateLeaderboard([...ctx.db.runHistory.iter()], [...ctx.db.runResult.iter()])
);

const RosterEntry = t.object('RosterEntry', { name: t.string(), modelId: t.string() });

// Starts a run whose survivors the module asks itself (brain/think.ts): the
// roster, prompt and scenario in one transaction, from game time zero. The
// run info has the shape the harness's setRunInfo writes, plus brains.
export const beginRun = spacetimedb.reducer(
  { roster: t.array(RosterEntry), promptVariant: t.string(), foodScale: t.f64(), roleOffset: t.u8(), rescueSeats: t.u8(), timeScale: t.f64() },
  (ctx, { roster, promptVariant, foodScale, roleOffset, rescueSeats, timeScale }) => {
    requireWorkerOrAdmin(ctx);
    if (roster.length === 0) throw new SenderError('the roster is empty');
    for (const r of roster) {
      if (!DATABASE_PROVIDERS.includes(splitModelId(r.modelId).provider)) {
        throw new SenderError(`${r.modelId} cannot be asked by the database; use ${DATABASE_PROVIDERS.join(', ')}`);
      }
    }
    let system: string;
    try {
      system = systemPrompt(promptVariant, { rescueSeats });
    } catch (err) {
      throw new SenderError(err instanceof Error ? err.message : String(err));
    }
    const food = Math.min(Math.max(foodScale, 0.2), 5);
    ctx.db.world.id.update({ ...getWorld(ctx), foodScale: food, roleOffset: roleOffset % 4, rescueSeats });
    resetWorld(ctx, roster);
    const scale = Math.min(Math.max(timeScale, 0.05), 4);
    ctx.db.world.id.update({ ...getWorld(ctx), timeScale: scale });
    const info = JSON.stringify({
      promptVariant,
      promptVersion: promptVersion({ rescueSeats }),
      systemPrompt: system,
      roster: roster.map(r => ({ name: r.name, modelId: r.modelId })),
      timeScale: scale,
      foodScale: food,
      roleOffset: roleOffset % 4,
      rescueSeats,
      startedAt: new Date(Number(ctx.timestamp.microsSinceUnixEpoch / 1000n)).toISOString(),
      brains: 'database',
    });
    if (ctx.db.meta.key.find('run')) ctx.db.meta.key.update({ key: 'run', value: info });
    else ctx.db.meta.insert({ key: 'run', value: info });
  }
);

// Advances the world by real elapsed time × timeScale. This is the fast body.
export const tick = spacetimedb.reducer({ onSchedule: tickTimer }, { timer: tickTimer.rowType }, ctx => {
  requireScheduler(ctx);
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
  requireScheduler(ctx);
  const w = getWorld(ctx);
  checkRunEnd(ctx);
  if (!w.running) return;
  updateExploration(ctx);
  updateTemptations(ctx);
  updateCrateWindows(ctx);
  noticeLosses(ctx);
  const brains = runBrains(ctx);

  for (const { id } of [...ctx.db.agent.iter()]) {
    const a = ctx.db.agent.id.find(id)!;
    if (a.kind !== 'llm' || !a.alive) continue;

    if (a.pendingRequestId !== 0n) {
      const req = ctx.db.decisionRequest.id.find(a.pendingRequestId);
      const ageMs = req ? Number(ctx.timestamp.microsSinceUnixEpoch - req.createdAt.microsSinceUnixEpoch) / 1000 : Infinity;
      if (req && req.status === 'pending' && ageMs < REQUEST_TIMEOUT_MS) continue;
      if (req && req.status === 'pending') {
        ctx.db.decisionRequest.id.update({ ...req, status: 'expired', error: 'no answer in time' });
        noteModel(ctx, req.modelId, 'no answer in time');
      }
      ctx.db.agent.id.update({ ...a, pendingRequestId: 0n, wake: true, wakeReason: 'retry' });
      continue;
    }

    if (!a.wake && w.gameTimeMs < a.nextThinkAtMs) continue;
    const reason = a.wake ? a.wakeReason : 'heartbeat';
    const brain = brains === 'database' && DATABASE_PROVIDERS.includes(splitModelId(a.modelId).provider) ? 'database' : 'harness';
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
      brain,
      reasoning: '',
    });
    if (brain === 'database') ctx.db.thinkJob.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch), requestId: req.id });
    ctx.db.agent.id.update({ ...a, pendingRequestId: req.id, wake: false, wakeReason: '' });
  }
});


export const submitDecision = spacetimedb.reducer(
  { requestId: t.u64(), action: t.string(), thought: t.string(), latencyMs: t.u32() },
  (ctx, { requestId, action, thought, latencyMs }) => {
    if (!isWorker(ctx)) throw new SenderError('not a harness worker');
    const req = ctx.db.decisionRequest.id.find(requestId);
    if (!req || req.status !== 'pending') throw new SenderError('request is not pending');
    if (routeDeskDecision(ctx, req, { action, thought, latencyMs })) return;
    applyDecision(ctx, req, action, thought, latencyMs);
  }
);

export const { queueFinanceRun, financeTick } = defineDeskReducers(spacetimedb);

// The harness reports a model call that failed outright (timeout, API error).
export const failDecision = spacetimedb.reducer(
  { requestId: t.u64(), error: t.string(), latencyMs: t.u32() },
  (ctx, { requestId, error, latencyMs }) => {
    if (!isWorker(ctx)) throw new SenderError('not a harness worker');
    const req = ctx.db.decisionRequest.id.find(requestId);
    if (!req || req.status !== 'pending') throw new SenderError('request is not pending');
    failRequest(ctx, req, error, latencyMs);
  }
);

export const { think } = defineThink(spacetimedb);

// Trust on first use: the first harness to connect to a fresh world owns it.
export const claimHarness = spacetimedb.reducer(ctx => {
  if (!isWorker(ctx)) {
    if (ctx.db.harnessWorker.count() > 0n && !isAdmin(ctx)) throw new SenderError('harness already claimed');
    ctx.db.harnessWorker.insert({ identity: ctx.sender });
  }
  publishMeta(ctx);
});

// Adds an LLM survivor with a home and a chest. Idempotent by name, so a
// restarted harness can re-send its roster; a survivor who already exists
// takes the roster's model, because decision requests are routed by it.
export const spawnAgent = spacetimedb.reducer({ name: t.string(), modelId: t.string() }, (ctx, { name, modelId }) => {
  requireWorkerOrAdmin(ctx);
  const existing = ctx.db.agent.name.find(name);
  if (existing) {
    if (existing.kind === 'llm' && existing.modelId !== modelId) ctx.db.agent.id.update({ ...existing, modelId });
    return;
  }
  addSurvivor(ctx, name, modelId);
});

// Scarcity sweeps (how much food the clearing holds relative to the baseline)
// and role rotation. Takes effect at the next reset, so a run never changes mid-way.
export const configureScenario = spacetimedb.reducer({ foodScale: t.f64(), roleOffset: t.u8(), rescueSeats: t.u8() }, (ctx, { foodScale, roleOffset, rescueSeats }) => {
  requireWorkerOrAdmin(ctx);
  ctx.db.world.id.update({ ...getWorld(ctx), foodScale: Math.min(Math.max(foodScale, 0.2), 5), roleOffset: roleOffset % 4, rescueSeats });
});

// The harness records how the run is configured (prompt variant, roster, time
// scale) so the report states it alongside the results.
export const setRunInfo = spacetimedb.reducer({ info: t.string() }, (ctx, { info }) => {
  requireWorkerOrAdmin(ctx);
  if (ctx.db.meta.key.find('run')) ctx.db.meta.key.update({ key: 'run', value: info });
  else ctx.db.meta.insert({ key: 'run', value: info });
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
  stopTimers(ctx);
});

export const joinAsHuman = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed) throw new SenderError('name required');
  if (controlledBy(ctx)) return;
  if (ctx.db.agent.name.find(trimmed)) throw new SenderError('name taken');
  const [cx, cy] = centre(getWorld(ctx));
  const humans = [...ctx.db.agent.iter()].filter(a => a.kind === 'human').length;
  newAgent(ctx, { name: trimmed, kind: 'human', modelId: 'human', x: cx - 4 + (humans % 5) * 2, y: cy + 4, controller: ctx.sender });
  // Sticky for the run, even after a visitor leaves. Only reset clears it.
  if (!ctx.db.meta.key.find('interactive')) ctx.db.meta.insert({ key: 'interactive', value: 'true' });
});

export const humanMoveTo = spacetimedb.reducer({ x: t.f32(), y: t.f32() }, (ctx, { x, y }) => {
  const me = controlledBy(ctx);
  if (!me) throw new SenderError('you do not control a character');
  const [tx, ty] = clampToCircle(getWorld(ctx), x, y);
  ctx.db.agent.id.update({ ...me, intentKind: 'move_to', targetX: tx, targetY: ty, targetAgentId: 0n, targetNodeId: 0n, pendingAction: '' });
});

// Lets a person take any action a model can; detectors judge it the same way.
export const humanAct = spacetimedb.reducer({ action: t.string() }, (ctx, { action }) => {
  const me = controlledBy(ctx);
  if (!me) throw new SenderError('you do not control a character');
  if (!me.alive) throw new SenderError('you are dead');
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
