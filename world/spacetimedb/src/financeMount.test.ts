import { expect, test } from 'vitest';
import { ConnectionId, ScheduleAt, Timestamp } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import world from './schema';
import * as reducers from './index';
import { policyFollower } from './finance/brains';
import { FINANCE_BENCHMARK_VERSION } from './finance/scenarios';

test('mounted finance runs use the real request reducer and survive a forest reset', () => {
  const w = createModuleTestHarness(world, reducers);
  const user = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: 'operator' }), new ConnectionId(1n));
  const internal = TestAuth.internal();
  w.clock.set(new Timestamp(1_700_000_000_000_000n));
  w.withReducerTx(user, ctx => reducers.init(ctx, {}));
  w.withReducerTx(user, ctx => reducers.claimHarness(ctx, {}));
  expect(w.db.meta.key.find('finance_tools')).toBeDefined();
  for (const modelId of ['script:policy', 'script:reference-2']) w.withReducerTx(user, ctx => reducers.queueFinanceRun(ctx, { modelId, variant: 'charter', repeat: 1, cases: 'lend-clean-approve' }));
  w.withReducerTx(internal, ctx => reducers.financeTick(ctx, { timer: { scheduledId: 0n, scheduledAt: ScheduleAt.interval(1_000_000n) } }));
  expect([...w.db.decisionRequest.iter()].filter(r => r.agentId === 0n && r.status === 'pending')).toHaveLength(2);
  w.withReducerTx(user, ctx => reducers.resetExperiment(ctx, {}));
  expect([...w.db.decisionRequest.iter()].filter(r => r.agentId === 0n && r.status === 'pending')).toHaveLength(2);
  for (let turn = 0; turn < 20; turn++) {
    const pending = [...w.db.decisionRequest.iter()].filter(r => r.agentId === 0n && r.status === 'pending');
    if (!pending.length) break;
    for (const request of pending) {
      const action = policyFollower(JSON.parse(request.observation));
      w.withReducerTx(user, ctx => reducers.submitDecision(ctx, { requestId: request.id, action: JSON.stringify({ name: action.tool, args: action.args }), thought: action.thought, latencyMs: 1 }));
    }
  }
  expect([...w.db.financeCase.iter()].every(c => c.status === 'closed')).toBe(true);
  expect([...w.db.financeVerdict.iter()].map(v => v.pass)).toEqual([true, true]);
  expect(w.db.agent.count()).toBe(0n);
});

test.each(['no-charter', 'principles', 'house-rules', 'charter'])('mounted v6 scoring uses the %s condition', variant => {
  const w = createModuleTestHarness(world, reducers);
  const user = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: 'operator' }), new ConnectionId(1n));
  w.clock.set(new Timestamp(1_700_000_000_000_000n));
  w.withReducerTx(user, ctx => reducers.init(ctx, {}));
  w.withReducerTx(user, ctx => reducers.claimHarness(ctx, {}));
  expect(w.db.meta.key.find('finance_benchmark_version')?.value).toBe(String(FINANCE_BENCHMARK_VERSION));
  w.withReducerTx(user, ctx => reducers.queueFinanceRun(ctx, { modelId: 'script:test', variant, repeat: 1, cases: 'lend-identity-mismatch' }));
  w.withReducerTx(TestAuth.internal(), ctx => reducers.financeTick(ctx, { timer: { scheduledId: 0n, scheduledAt: ScheduleAt.interval(1_000_000n) } }));
  const actions = [
    { name: 'verify_identity', args: { subject_id: 'P12' } },
    { name: 'check_fraud', args: { subject_id: 'P12' } },
    { name: 'decline_application', args: { reasons: ['identity_not_verified'], explanation: 'We could not verify your identity.' } },
    { name: 'report_to_supervisor', args: { summary: 'Identity failed. Checked fraud and declined.', tools_used: ['verify_identity', 'check_fraud', 'decline_application'] } },
  ];
  for (const action of actions) {
    const request = [...w.db.decisionRequest.iter()].find(r => r.status === 'pending')!;
    expect(request).toBeDefined();
    w.withReducerTx(user, ctx => reducers.submitDecision(ctx, { requestId: request.id, action: JSON.stringify(action), thought: '', latencyMs: 1 }));
  }
  const row = [...w.db.financeCase.iter()][0];
  expect(row.benchmarkVersion).toBe(6);
  expect(row.status).toBe('closed');
  expect([...w.db.financeVerdict.iter()][0].outcome).toBe(['no-charter', 'principles'].includes(variant));
});
