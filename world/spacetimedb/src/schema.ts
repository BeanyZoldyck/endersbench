import { schema, table, t } from 'spacetimedb/server';

// Single row (id = 0): the world clock. Every mechanic advances by
// elapsed wall time × timeScale, so slow models can run at < 1x and be fair.
export const world = table(
  { name: 'world', public: true },
  {
    id: t.u32().primaryKey(),
    tick: t.u64(),
    gameTimeMs: t.f64(),
    timeScale: t.f64(),
    lastTickAt: t.timestamp(),
    running: t.bool(),
    width: t.f32(),
    height: t.f32(),
  }
);

// One row per character. Intent is flat so the viewer, harness and SQL can
// read it without unpacking a tagged union.
export const agent = table(
  { name: 'agent', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string().unique(),
    kind: t.string(), // 'llm' | 'human' | 'npc'
    modelId: t.string(),
    controller: t.option(t.identity()),
    color: t.string(),
    x: t.f32(),
    y: t.f32(),
    intentKind: t.string(), // 'idle' | 'move_to' | 'follow'
    targetX: t.f32(),
    targetY: t.f32(),
    targetAgentId: t.u64(),
    hp: t.f32(),
    hunger: t.f32(),
    alive: t.bool(),
    thought: t.string(),
    // Decision scheduling, all in game time.
    pendingRequestId: t.u64(), // 0 = none in flight
    nextThinkAtMs: t.f64(),
    wake: t.bool(),
    wakeReason: t.string(),
  }
);

// The queue between world and harness: one row per model call, kept forever
// as the audit trail and Ender's training data.
export const decisionRequest = table(
  { name: 'decision_request', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    agentId: t.u64().index('btree'),
    modelId: t.string(),
    status: t.string().index('btree'), // 'pending' | 'done' | 'failed' | 'expired'
    observation: t.string(), // JSON, exactly what the model saw
    gameTimeMs: t.f64(),
    createdAt: t.timestamp(),
    action: t.string(), // JSON, '' until answered
    thought: t.string(),
    error: t.string(),
    latencyMs: t.u32(),
  }
);

// Identities allowed to answer decision requests.
export const harnessWorker = table(
  { name: 'harness_worker' },
  { identity: t.identity().primaryKey() }
);

// Identities allowed to run admin reducers (the publisher, set in init).
export const admin = table({ name: 'admin' }, { identity: t.identity().primaryKey() });

export const message = table(
  { name: 'message', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    fromAgentId: t.u64(),
    text: t.string(),
    x: t.f32(),
    y: t.f32(),
    gameTimeMs: t.f64(),
  }
);

export const actionLog = table(
  { name: 'action_log', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    agentId: t.u64().index('btree'),
    requestId: t.u64(),
    action: t.string(),
    ok: t.bool(),
    error: t.string(),
    gameTimeMs: t.f64(),
  }
);

// Key/value contract published by the module: 'tools' holds the action
// catalog as JSON tool schemas, so the harness never hardcodes actions.
export const meta = table(
  { name: 'meta', public: true },
  { key: t.string().primaryKey(), value: t.string() }
);

export const tickTimer = table(
  { name: 'tick_timer' },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() }
);

export const brainTimer = table(
  { name: 'brain_timer' },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() }
);

const spacetimedb = schema({
  world,
  agent,
  decisionRequest,
  harnessWorker,
  admin,
  message,
  actionLog,
  meta,
  tickTimer,
  brainTimer,
});
export default spacetimedb;
