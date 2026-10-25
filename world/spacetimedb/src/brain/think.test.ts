import { describe, expect, test } from 'vitest';
import { ConnectionId, ScheduleAt, Timestamp } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import spacetimedb from '../schema';
import * as moduleExports from '../index';

const { init, brainTick, claimHarness, beginRun, think } = moduleExports;
const publisher = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: 'publisher' }), new ConnectionId(1n));
const harness = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: 'harness' }), new ConnectionId(2n));
const stranger = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: 'stranger' }), new ConnectionId(3n));
const internal = TestAuth.internal();
const timerRow = { scheduledId: 0n, scheduledAt: ScheduleAt.interval(50_000n) };
const run = (name: string) => ({ roster: [{ name, modelId: 'bitdeer:m' }], promptVariant: 'reward', foodScale: 1, roleOffset: 0, rescueSeats: 0, timeScale: 0.5 });
const answer = JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'idle', arguments: '{"thought":"rest"}' } }] } }] });

// A database-brained world with one pending request and its think job.
function world() {
  const t = createModuleTestHarness(spacetimedb, moduleExports);
  t.clock.set(new Timestamp(1_700_000_000_000_000n));
  t.withReducerTx(publisher, ctx => init(ctx, {}));
  t.withReducerTx(harness, ctx => claimHarness(ctx, {}));
  t.withReducerTx(publisher, ctx => beginRun(ctx, run('Ivy')));
  t.withReducerTx(internal, ctx => brainTick(ctx, { timer: timerRow }));
  const job = [...t.db.thinkJob.iter()][0];
  return { t, job, request: () => t.db.decisionRequest.id.find(job.requestId)! };
}

// The unit-test host has no env syscall, so the procedure's env is stubbed.
function withEnv<C extends object>(ctx: C, vars: Record<string, string>): C {
  return new Proxy(ctx, {
    get(target, p) {
      if (p === 'env') return { get: (n: string) => vars[n] ?? null };
      const v = Reflect.get(target, p, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

const reply = (code: number, body: string) => ({ code, headers: { entries: [] }, version: { tag: 'Http11' }, body }) as any;

function thinkAs(t: ReturnType<typeof world>['t'], auth: typeof internal, job: any, vars: Record<string, string>, respond: () => any) {
  let calls = 0;
  const ctx = t.procedureContextBuilder(auth).http(() => { calls++; return respond(); }).build();
  think(withEnv(ctx, vars) as any, { job });
  return calls;
}

describe('think', () => {
  test('only the scheduler may run it: a client calling think spends nothing', () => {
    const { t, job, request } = world();
    expect(thinkAs(t, stranger, job, { BITDEER_API_KEY: 'k' }, () => reply(200, answer))).toBe(0);
    expect(request().status).toBe('pending');
  });

  test('a missing key fails the request at once, without calling the provider', () => {
    const { t, job, request } = world();
    expect(thinkAs(t, internal, job, {}, () => reply(200, answer))).toBe(0);
    expect(request().status).toBe('failed');
    expect(request().error).toBe('bitdeer models need BITDEER_API_KEY');
    expect(t.db.modelHealth.modelId.find('bitdeer:m')!.lastError).toBe('bitdeer models need BITDEER_API_KEY');
  });

  test('an error page is recorded with its status and body', () => {
    const { t, job, request } = world();
    thinkAs(t, internal, job, { BITDEER_API_KEY: 'k' }, () => reply(502, '<html>bad gateway'));
    expect(request().status).toBe('failed');
    expect(request().error).toBe('https://api-inference.bitdeer.ai/v1/chat/completions answered 502: <html>bad gateway');
  });

  test('an answer is applied to the survivor', () => {
    const { t, job, request } = world();
    expect(thinkAs(t, internal, job, { BITDEER_API_KEY: 'k' }, () => reply(200, answer))).toBe(1);
    expect(request().status).toBe('done');
    expect(JSON.parse(request().action)).toEqual({ name: 'idle', args: {} });
    const ivy = [...t.db.agent.iter()][0];
    expect(ivy.thought).toBe('rest');
    expect(ivy.pendingRequestId).toBe(0n);
  });

  test('an answer that arrives after beginRun replaced the roster changes nothing', () => {
    const { t, job } = world();
    thinkAs(t, internal, job, { BITDEER_API_KEY: 'k' }, () => {
      t.withReducerTx(publisher, ctx => beginRun(ctx, run('Rook')));
      return reply(200, answer);
    });
    const agents = [...t.db.agent.iter()];
    expect(agents.map(a => a.name)).toEqual(['Rook']);
    expect(agents[0].thought).toBe('');
    expect(t.db.decisionRequest.id.find(job.requestId)).toBeNull();
  });

  test('an answer for a survivor who died meanwhile is filed as expired', () => {
    const { t, job, request } = world();
    thinkAs(t, internal, job, { BITDEER_API_KEY: 'k' }, () => {
      const ivy = [...t.db.agent.iter()][0];
      t.db.agent.id.update({ ...ivy, alive: false, hp: 0 });
      return reply(200, answer);
    });
    expect(request().status).toBe('expired');
    expect(request().error).toBe('agent is a ghost');
  });
});
