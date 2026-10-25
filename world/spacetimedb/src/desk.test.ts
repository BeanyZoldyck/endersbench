import { describe, expect, test } from 'vitest';
import { ConnectionId, ScheduleAt, TimeDuration, Timestamp } from 'spacetimedb';
import { schema, SenderError, t } from 'spacetimedb/server';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import { admin, decisionRequest, harnessWorker, meta } from './schema';
import {
  DESK_CONCURRENCY,
  DESK_MAX_STALLS,
  DESK_REQUEST_TIMEOUT_MS,
  defineDeskReducers,
  deskMeta,
  deskSteps,
  financeCase,
  financeStep,
  financeTimer,
  financeVerdict,
  routeDeskDecision,
  type DeskCtx,
} from './desk';
import { policyFollower, runBrain } from './finance/brains';
import { deliver, execute, isCrsTool, observe } from './finance/engine';
import { SCENARIOS, SCENARIO_BY_ID } from './finance/scenarios';
import { financeTools } from './finance/tools';

// A stand-in for the world: the desk's tables beside the world's request
// queue, with submit and fail reducers shaped like index.ts's, so the desk is
// tested before the world mounts it.
const world = schema({ decisionRequest, harnessWorker, admin, meta, financeCase, financeStep, financeVerdict, financeTimer });
const { queueFinanceRun, financeTick } = defineDeskReducers(world);
const init = world.init(ctx => {
  ctx.db.admin.insert({ identity: ctx.sender });
});
const claimHarness = world.reducer(ctx => {
  ctx.db.harnessWorker.insert({ identity: ctx.sender });
});
const submitDecision = world.reducer(
  { requestId: t.u64(), action: t.string(), thought: t.string(), latencyMs: t.u32() },
  (ctx, { requestId, action, thought, latencyMs }) => {
    if (!ctx.db.harnessWorker.identity.find(ctx.sender)) throw new SenderError('not a harness worker');
    const req = ctx.db.decisionRequest.id.find(requestId);
    if (!req || req.status !== 'pending') throw new SenderError('request is not pending');
    if (routeDeskDecision(ctx, req, { action, thought, latencyMs })) return;
    throw new SenderError('not a desk request');
  }
);
const failDecision = world.reducer({ requestId: t.u64(), error: t.string(), latencyMs: t.u32() }, (ctx, { requestId, error, latencyMs }) => {
  const req = ctx.db.decisionRequest.id.find(requestId);
  if (!req || req.status !== 'pending') throw new SenderError('request is not pending');
  ctx.db.decisionRequest.id.update({ ...req, status: 'failed', error, latencyMs });
});
const moduleExports = { init, claimHarness, submitDecision, failDecision, queueFinanceRun, financeTick };

const publisher = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: 'publisher' }), new ConnectionId(1n));
const harness = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: 'harness' }), new ConnectionId(2n));
const stranger = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: 'stranger' }), new ConnectionId(3n));
const internal = TestAuth.internal();
const timerRow = { scheduledId: 0n, scheduledAt: ScheduleAt.interval(1_000_000n) };

function freshDesk() {
  const w = createModuleTestHarness(world, moduleExports);
  w.clock.set(new Timestamp(1_700_000_000_000_000n));
  w.withReducerTx(publisher, ctx => init(ctx, {}));
  w.withReducerTx(harness, ctx => claimHarness(ctx, {}));
  return w;
}
type W = ReturnType<typeof freshDesk>;

const queue = (w: W, args: { modelId?: string; variant?: string; repeat?: number; cases?: string } = {}) =>
  w.withReducerTx(harness, ctx => queueFinanceRun(ctx, { modelId: 'fake:script-a', variant: 'charter', repeat: 1, cases: '', ...args }));
const tick = (w: W) => w.withReducerTx(internal, ctx => financeTick(ctx, { timer: timerRow }));
const pending = (w: W) => [...w.db.decisionRequest.iter()].filter(r => r.status === 'pending');
const cases = (w: W) => [...w.db.financeCase.iter()];
const steps = (w: W, caseId: bigint) => w.withReducerTx(internal, ctx => deskSteps(ctx as DeskCtx, caseId));
const caseFor = (w: W, requestId: bigint) => cases(w).find(c => c.pendingRequestId === requestId)!;

// Answers a request the way a model would: from its observation alone.
function answerWithScriptA(w: W, req: { id: bigint; observation: string }) {
  const action = policyFollower(JSON.parse(req.observation));
  w.withReducerTx(harness, ctx =>
    submitDecision(ctx, { requestId: req.id, action: JSON.stringify({ name: action.tool, args: action.args }), thought: action.thought, latencyMs: 5 })
  );
}

describe('finance desk in the world', () => {
  test('Script A plays every case through the request queue exactly as offline, and passes the gate', () => {
    const w = freshDesk();
    queue(w);
    let maxOpen = 0;
    for (let turn = 0; turn < 2000 && cases(w).some(c => c.status !== 'closed'); turn++) {
      tick(w);
      maxOpen = Math.max(maxOpen, cases(w).filter(c => c.status === 'open').length);
      for (const req of pending(w)) answerWithScriptA(w, req);
    }
    expect(maxOpen).toBe(DESK_CONCURRENCY);
    for (const c of cases(w)) {
      const scenario = SCENARIO_BY_ID[c.scenarioId];
      expect(c.status, c.scenarioId).toBe('closed');
      expect(steps(w, c.id), c.scenarioId).toEqual(runBrain(policyFollower, scenario));
      const verdict = w.db.financeVerdict.caseId.find(c.id)!;
      expect(verdict.pass, `${c.scenarioId}: ${verdict.failures}`).toBe(true);
    }
    expect(cases(w)).toHaveLength(SCENARIOS.length);
    // Every desk request is in the world's queue, answered, and belongs to no survivor.
    const requests = [...w.db.decisionRequest.iter()];
    expect(requests.every(r => r.status === 'done' && r.agentId === 0n && r.modelId === 'fake:script-a')).toBe(true);
    // An idle desk stops its clock.
    tick(w);
    expect(w.db.financeTimer.count()).toBe(0n);
  });

  test('each request carries exactly the observation the bench loop sends', () => {
    const w = freshDesk();
    queue(w, { cases: 'lend-clean-approve' });
    tick(w);
    const [req] = pending(w);
    const scenario = SCENARIO_BY_ID['lend-clean-approve'];
    expect(req.observation).toBe(observe(scenario, deliver(scenario, [])));
    answerWithScriptA(w, req);
    const [next] = pending(w);
    expect(next.observation).toBe(observe(scenario, steps(w, caseFor(w, next.id).id)));
  });

  test('queues repeated runs, sample by sample', () => {
    const w = freshDesk();
    queue(w, { repeat: 3, cases: 'lend-clean-approve,collect-chapter13' });
    expect(cases(w).map(c => `${c.scenarioId}#${c.sample}`)).toEqual([
      'lend-clean-approve#0',
      'collect-chapter13#0',
      'lend-clean-approve#1',
      'collect-chapter13#1',
      'lend-clean-approve#2',
      'collect-chapter13#2',
    ]);
    expect(cases(w).every(c => c.status === 'queued' && c.seat === SCENARIO_BY_ID[c.scenarioId].seat)).toBe(true);
    expect(w.db.financeTimer.count()).toBe(1n);
  });

  test('asks again after a turn without a tool call, then gives the case up', () => {
    const w = freshDesk();
    queue(w, { cases: 'lend-clean-approve' });
    tick(w);
    for (let i = 0; i <= DESK_MAX_STALLS; i++) {
      const [req] = pending(w);
      w.withReducerTx(harness, ctx => failDecision(ctx, { requestId: req.id, error: 'no tool call', latencyMs: 5 }));
      tick(w);
    }
    const [c] = cases(w);
    expect(c.status).toBe('closed');
    expect(c.stopped).toBe('no tool call');
    expect(pending(w)).toHaveLength(0);
    expect([...w.db.decisionRequest.iter()]).toHaveLength(DESK_MAX_STALLS + 1);
    expect(w.db.financeVerdict.caseId.find(c.id)!.pass).toBe(false);
  });

  test('a good action resets the stall count', () => {
    const w = freshDesk();
    queue(w, { cases: 'lend-clean-approve' });
    tick(w);
    const [req] = pending(w);
    w.withReducerTx(harness, ctx => failDecision(ctx, { requestId: req.id, error: 'no tool call', latencyMs: 5 }));
    tick(w);
    expect(cases(w)[0].stalls).toBe(1);
    answerWithScriptA(w, pending(w)[0]);
    expect(cases(w)[0].stalls).toBe(0);
  });

  test('a refusal ends the case at once', () => {
    const w = freshDesk();
    queue(w, { cases: 'lend-clean-approve' });
    tick(w);
    const [req] = pending(w);
    w.withReducerTx(harness, ctx => failDecision(ctx, { requestId: req.id, error: 'refusal', latencyMs: 5 }));
    tick(w);
    expect(cases(w)[0]).toMatchObject({ status: 'closed', stopped: 'refusal' });
  });

  test('a request nobody answers expires and is asked again', () => {
    const w = freshDesk();
    queue(w, { cases: 'lend-clean-approve' });
    tick(w);
    const [first] = pending(w);
    w.clock.advance(TimeDuration.fromMillis(DESK_REQUEST_TIMEOUT_MS - 1000));
    tick(w);
    expect(pending(w).map(r => r.id)).toEqual([first.id]);
    w.clock.advance(TimeDuration.fromMillis(2000));
    tick(w);
    expect(w.db.decisionRequest.id.find(first.id)!.status).toBe('expired');
    expect(pending(w)).toHaveLength(1);
    expect(pending(w)[0].id).not.toBe(first.id);
  });

  test('an answer that is not an action counts as a stall and is asked again at once', () => {
    const w = freshDesk();
    queue(w, { cases: 'lend-clean-approve' });
    tick(w);
    const [req] = pending(w);
    w.withReducerTx(harness, ctx => submitDecision(ctx, { requestId: req.id, action: 'approve it', thought: '', latencyMs: 5 }));
    expect(w.db.decisionRequest.id.find(req.id)!.status).toBe('failed');
    expect(pending(w)).toHaveLength(1);
    expect(cases(w)[0].stalls).toBe(1);
  });

  test('leaves requests that are not the desk’s to the world', () => {
    const w = freshDesk();
    const req = w.db.decisionRequest.insert({
      id: 0n,
      agentId: 7n,
      modelId: 'fake',
      status: 'pending',
      observation: '{}',
      gameTimeMs: 0,
      createdAt: w.clock.now(),
      action: '',
      thought: '',
      error: '',
      latencyMs: 0,
      brain: 'harness',
      reasoning: '',
    });
    expect(w.withReducerTx(harness, ctx => routeDeskDecision(ctx, req, { action: '{"name":"idle","args":{}}', thought: '', latencyMs: 1 }))).toBe(false);
    expect(w.db.decisionRequest.id.find(req.id)!.status).toBe('pending');
  });

  test('only the harness or an admin can queue a run, and only for real cases and prompts', () => {
    const w = freshDesk();
    expect(() => w.withReducerTx(stranger, ctx => queueFinanceRun(ctx, { modelId: 'fake', variant: 'charter', repeat: 1, cases: '' }))).toThrow(/not authorised/);
    expect(() => queue(w, { variant: 'win-at-all-costs' })).toThrow(/variant/);
    expect(() => queue(w, { cases: 'lend-clean-approve,no-such-case' })).toThrow(/no-such-case/);
    expect(cases(w)).toHaveLength(0);
  });

  test('publishes each seat’s tools for the harness', () => {
    const tools = JSON.parse(deskMeta().finance_tools);
    expect(Object.keys(tools)).toEqual(['lending', 'collections', 'vendor_payments']);
    expect(tools.lending).toEqual(financeTools('lending'));
  });

  test('takes the worker’s live CRS answer: the step keeps the call, the verifier reads the answer, the agent never sees the call', () => {
    const w = freshDesk();
    queue(w, { cases: 'lend-clean-approve' });
    tick(w);
    const scenario = SCENARIO_BY_ID['lend-clean-approve'];
    const call = { source: 'live', endpoint: 'POST /test', requestId: 'crs-req-1', status: 200, latencyMs: 160, at: '2026-10-24T19:03:00.000Z' };
    for (let turn = 0; turn < 40 && cases(w).some(c => c.status !== 'closed'); turn++) {
      for (const req of pending(w)) {
        expect(req.observation).not.toContain('crs-req-1');
        const action = policyFollower(JSON.parse(req.observation));
        // A crs answer on a tool that is not a CRS tool is ignored.
        const result = isCrsTool(action.tool) ? execute(scenario, action.tool, action.args) : { ok: true };
        const payload = { name: action.tool, args: action.args, crs: { result, call } };
        w.withReducerTx(harness, ctx => submitDecision(ctx, { requestId: req.id, action: JSON.stringify(payload), thought: action.thought, latencyMs: 5 }));
      }
      tick(w);
    }
    const [c] = cases(w);
    const recorded = steps(w, c.id);
    expect(recorded.some(s => isCrsTool(s.tool))).toBe(true);
    for (const s of recorded) expect(s.crs, s.tool).toEqual(isCrsTool(s.tool) ? call : undefined);
    expect(recorded.map(s => ({ ...s, crs: undefined }))).toEqual(runBrain(policyFollower, scenario));
    expect(w.db.financeVerdict.caseId.find(c.id)!.pass).toBe(true);
  });

  test('scores what CRS answered live, not the saved card', () => {
    const w = freshDesk();
    queue(w, { cases: 'lend-clean-approve' });
    tick(w);
    const [req] = pending(w);
    const live = { result: 'fail', messages: ['INPUT SSN NOT ASSOCIATED WITH INPUT NAME'] };
    const call = { source: 'live', endpoint: 'POST /test', requestId: 'crs-req-2', status: 200, latencyMs: 90, at: '2026-10-24T19:03:00.000Z', drift: ['result', 'messages'] };
    const action = { name: 'verify_identity', args: { subject_id: 'P01' }, crs: { result: live, call } };
    w.withReducerTx(harness, ctx => submitDecision(ctx, { requestId: req.id, action: JSON.stringify(action), thought: '', latencyMs: 5 }));
    const c = caseFor(w, pending(w)[0].id);
    expect(steps(w, c.id).find(s => s.tool === 'verify_identity')).toMatchObject({ result: live, crs: call });
    expect(JSON.parse(pending(w)[0].observation).timeline.find((e: any) => e.action?.tool === 'verify_identity').action.result).toEqual(live);
  });
});
