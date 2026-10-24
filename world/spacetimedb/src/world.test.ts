import { describe, expect, test } from 'vitest';
import { ConnectionId, ScheduleAt, TimeDuration, Timestamp } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import spacetimedb from './schema';
import * as moduleExports from './index';

const {
  init,
  tick,
  brainTick,
  spawnAgent,
  claimHarness,
  submitDecision,
  setTimeScale,
  joinAsHuman,
  humanMoveTo,
  onDisconnect,
} = moduleExports;

const publisher = TestAuth.fromJwtPayload(
  JSON.stringify({ iss: 'test', sub: 'publisher' }),
  new ConnectionId(1n)
);
const harness = TestAuth.fromJwtPayload(
  JSON.stringify({ iss: 'test', sub: 'harness' }),
  new ConnectionId(2n)
);
const stranger = TestAuth.fromJwtPayload(
  JSON.stringify({ iss: 'test', sub: 'stranger' }),
  new ConnectionId(3n)
);
const internal = TestAuth.internal();

const timerRow = { scheduledId: 0n, scheduledAt: ScheduleAt.interval(50_000n) };

function freshWorld() {
  const t = createModuleTestHarness(spacetimedb, moduleExports);
  t.clock.set(new Timestamp(1_700_000_000_000_000n));
  t.withReducerTx(publisher, ctx => init(ctx, {}));
  t.withReducerTx(harness, ctx => claimHarness(ctx, {}));
  return t;
}

function spawn(t: ReturnType<typeof freshWorld>, name: string, x: number, y: number) {
  t.withReducerTx(harness, ctx => spawnAgent(ctx, { name, modelId: 'fake', x, y }));
  return [...t.db.agent.iter()].find(a => a.name === name)!;
}

function advance(t: ReturnType<typeof freshWorld>, ms: number) {
  t.clock.advance(TimeDuration.fromMillis(ms));
  t.withReducerTx(internal, ctx => tick(ctx, { timer: timerRow }));
}

function agentNamed(t: ReturnType<typeof freshWorld>, name: string) {
  return [...t.db.agent.iter()].find(a => a.name === name)!;
}

function pendingFor(t: ReturnType<typeof freshWorld>, agentId: bigint) {
  return [...t.db.decisionRequest.iter()].filter(
    r => r.agentId === agentId && r.status === 'pending'
  );
}

describe('movement', () => {
  test('a move_to agent walks toward its target at 3 tiles per game second', () => {
    const t = freshWorld();
    const ada = spawn(t, 'Ada', 10, 10);
    t.db.agent.id.update({ ...ada, intentKind: 'move_to', targetX: 20, targetY: 10 });

    advance(t, 200);

    expect(agentNamed(t, 'Ada').x).toBeCloseTo(10.6, 3);
    expect(agentNamed(t, 'Ada').y).toBeCloseTo(10, 3);
  });

  test('time scale 0.5 halves the distance walked', () => {
    const t = freshWorld();
    const ada = spawn(t, 'Ada', 10, 10);
    t.db.agent.id.update({ ...ada, intentKind: 'move_to', targetX: 20, targetY: 10 });
    t.withReducerTx(publisher, ctx => setTimeScale(ctx, { timeScale: 0.5 }));

    advance(t, 200);

    expect(agentNamed(t, 'Ada').x).toBeCloseTo(10.3, 3);
  });

  test('an agent that arrives stops, goes idle and wakes to think again', () => {
    const t = freshWorld();
    const ada = spawn(t, 'Ada', 10, 10);
    t.db.agent.id.update({ ...ada, intentKind: 'move_to', targetX: 10.2, targetY: 10 });

    advance(t, 200);

    const after = agentNamed(t, 'Ada');
    expect(after.x).toBeCloseTo(10.2, 3);
    expect(after.intentKind).toBe('idle');
    expect(after.wake).toBe(true);
    expect(after.wakeReason).toBe('arrived');
  });

  test('the game clock advances by elapsed time times the time scale', () => {
    const t = freshWorld();
    t.withReducerTx(publisher, ctx => setTimeScale(ctx, { timeScale: 0.5 }));
    const before = t.db.world.id.find(0)!.gameTimeMs;

    advance(t, 200);

    expect(t.db.world.id.find(0)!.gameTimeMs - before).toBeCloseTo(100, 3);
  });
});

describe('decision queue', () => {
  test('brainTick opens one pending request for an idle llm agent, with its observation', () => {
    const t = freshWorld();
    const ada = spawn(t, 'Ada', 10, 10);

    t.withReducerTx(internal, ctx => brainTick(ctx, { timer: timerRow }));
    t.withReducerTx(internal, ctx => brainTick(ctx, { timer: timerRow }));

    const pending = pendingFor(t, ada.id);
    expect(pending).toHaveLength(1);
    const obs = JSON.parse(pending[0].observation);
    expect(obs.you.name).toBe('Ada');
    expect(agentNamed(t, 'Ada').pendingRequestId).toBe(pending[0].id);
  });

  test('an observation lists nearby agents but not distant ones', () => {
    const t = freshWorld();
    const ada = spawn(t, 'Ada', 10, 10);
    spawn(t, 'Bo', 14, 10);
    spawn(t, 'Far', 60, 60);

    t.withReducerTx(internal, ctx => brainTick(ctx, { timer: timerRow }));

    const obs = JSON.parse(pendingFor(t, ada.id)[0].observation);
    const names = obs.nearby.agents.map((a: { name: string }) => a.name);
    expect(names).toContain('Bo');
    expect(names).not.toContain('Far');
  });

  test('submitDecision from a non-worker is rejected', () => {
    const t = freshWorld();
    const ada = spawn(t, 'Ada', 10, 10);
    t.withReducerTx(internal, ctx => brainTick(ctx, { timer: timerRow }));
    const req = pendingFor(t, ada.id)[0];

    expect(() =>
      t.withReducerTx(stranger, ctx =>
        submitDecision(ctx, {
          requestId: req.id,
          action: JSON.stringify({ name: 'idle', args: {} }),
          thought: 'hi',
          latencyMs: 10,
        })
      )
    ).toThrow();
  });

  test('a move_to decision sets the intent and closes the request', () => {
    const t = freshWorld();
    const ada = spawn(t, 'Ada', 10, 10);
    t.withReducerTx(internal, ctx => brainTick(ctx, { timer: timerRow }));
    const req = pendingFor(t, ada.id)[0];

    t.withReducerTx(harness, ctx =>
      submitDecision(ctx, {
        requestId: req.id,
        action: JSON.stringify({ name: 'move_to', args: { x: 30, y: 12 } }),
        thought: 'berries east',
        latencyMs: 812,
      })
    );

    const after = agentNamed(t, 'Ada');
    expect(after.intentKind).toBe('move_to');
    expect(after.targetX).toBeCloseTo(30);
    expect(after.thought).toBe('berries east');
    expect(after.pendingRequestId).toBe(0n);
    const closed = t.db.decisionRequest.id.find(req.id)!;
    expect(closed.status).toBe('done');
    expect(closed.latencyMs).toBe(812);
  });

  test('an invalid action is recorded as failed instead of throwing', () => {
    const t = freshWorld();
    const ada = spawn(t, 'Ada', 10, 10);
    t.withReducerTx(internal, ctx => brainTick(ctx, { timer: timerRow }));
    const req = pendingFor(t, ada.id)[0];

    t.withReducerTx(harness, ctx =>
      submitDecision(ctx, {
        requestId: req.id,
        action: JSON.stringify({ name: 'teleport', args: {} }),
        thought: '',
        latencyMs: 5,
      })
    );

    expect(t.db.decisionRequest.id.find(req.id)!.status).toBe('failed');
    expect(agentNamed(t, 'Ada').pendingRequestId).toBe(0n);
    const log = [...t.db.actionLog.iter()];
    expect(log).toHaveLength(1);
    expect(log[0].ok).toBe(false);
  });

  test('say stores a message and wakes agents within hearing range', () => {
    const t = freshWorld();
    const ada = spawn(t, 'Ada', 10, 10);
    spawn(t, 'Bo', 14, 10);
    spawn(t, 'Far', 60, 60);
    t.withReducerTx(internal, ctx => brainTick(ctx, { timer: timerRow }));
    const req = pendingFor(t, ada.id)[0];

    t.withReducerTx(harness, ctx =>
      submitDecision(ctx, {
        requestId: req.id,
        action: JSON.stringify({ name: 'say', args: { text: 'anyone have food?' } }),
        thought: '',
        latencyMs: 5,
      })
    );

    expect([...t.db.message.iter()].map(m => m.text)).toEqual(['anyone have food?']);
    expect(agentNamed(t, 'Bo').wake).toBe(true);
    expect(agentNamed(t, 'Bo').wakeReason).toBe('spoken_to');
    expect(agentNamed(t, 'Far').wake).toBe(false);
  });
});

describe('harness claim', () => {
  test('a second identity cannot claim an already claimed harness', () => {
    const t = freshWorld();
    expect(() => t.withReducerTx(stranger, ctx => claimHarness(ctx, {}))).toThrow();
  });
});

describe('human players', () => {
  test('a human who joined can walk their own character by clicking', () => {
    const t = freshWorld();
    t.withReducerTx(stranger, ctx => joinAsHuman(ctx, { name: 'Judge' }));

    t.withReducerTx(stranger, ctx => humanMoveTo(ctx, { x: 40, y: 41 }));

    const judge = agentNamed(t, 'Judge');
    expect(judge.kind).toBe('human');
    expect(judge.intentKind).toBe('move_to');
    expect(judge.targetX).toBeCloseTo(40);
  });

  test('humanMoveTo fails for an identity that controls no character', () => {
    const t = freshWorld();
    t.withReducerTx(stranger, ctx => joinAsHuman(ctx, { name: 'Judge' }));

    expect(() => t.withReducerTx(harness, ctx => humanMoveTo(ctx, { x: 1, y: 1 }))).toThrow();
  });

  test('a human character leaves the world when its player disconnects', () => {
    const t = freshWorld();
    spawn(t, 'Ada', 10, 10);
    t.withReducerTx(stranger, ctx => joinAsHuman(ctx, { name: 'Judge' }));

    t.withReducerTx(stranger, ctx => onDisconnect(ctx, {}));

    expect([...t.db.agent.iter()].map(a => a.name)).toEqual(['Ada']);
  });
});
