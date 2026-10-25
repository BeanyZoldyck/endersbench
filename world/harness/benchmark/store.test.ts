import { mkdtempSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BenchmarkStore } from './store';
import { markWorker } from './worker-lifecycle';
import { ReplayRecorder } from './recording';
import { BenchmarkService } from './service';
import type { BenchmarkJob } from './types';
import { parseReplay } from '../../src/replay';

const id = '12345678-1234-1234-1234-123456789abc';
function setup(status: BenchmarkJob['status'] = 'completed') {
  const directory = mkdtempSync(path.join(tmpdir(), 'benchmark-archive-'));
  const store = new BenchmarkStore(directory);
  const job: BenchmarkJob = { id, status, model: 'Grok', modelId: 'xai:grok-test', scenario: 'clearing-charter', dbName: `endersbench-run-${id}`, host: 'ws://localhost:3000', createdAt: '2026-10-24T10:00:00Z' };
  store.save(job);
  const recorder = new ReplayRecorder(path.join(directory, id), job.dbName, '2026-10-24T10:00:00Z');
  recorder.capture([['world', [{ id: 0, gameTimeMs: 0 }]], ['agent', [{ id: 1n, modelId: job.modelId }]], ['message', []]], 0);
  return { directory, store, job, recorder };
}

describe('persistent benchmark recordings', () => {
  it('archives replay state, delta frames, messages and transient events, and survives a new store', () => {
    const { directory, store, job, recorder } = setup();
    recorder.event('transfer_event', { id: 7n, qty: 2 });
    recorder.capture([['world', [{ id: 0, gameTimeMs: 500 }]], ['agent', [{ id: 1n, modelId: job.modelId }]], ['message', [{ id: 2n, text: 'Shared supplies' }]]], 500);
    store.archive(job);
    const restored = new BenchmarkStore(directory);
    expect(restored.load()).toHaveLength(1);
    expect(restored.history()[0]).toMatchObject({ id, model: 'Grok', status: 'completed', replayUrl: `/api/benchmarks/${id}/replay` });
    const raw = JSON.parse(gunzipSync(restored.replay(id)!).toString());
    expect(raw.frames[1].tables.agent).toBeUndefined();
    const replay = parseReplay(raw);
    expect(replay.frames).toHaveLength(2);
    expect(replay.frames[0].tables.agent[0].id).toBe(1n);
    expect(replay.events[0].row.id).toBe(7n);
    expect(replay.frames[1].tables.message[0].text).toBe('Shared supplies');
  });
  it('recovers an interrupted journal, ignores its torn last write, and marks it partial', () => {
    const { directory } = setup('running');
    appendFileSync(path.join(directory, id, 'recording.ndjson'), '{"kind":"frame","t":');
    const restored = new BenchmarkStore(directory);
    expect(restored.load()[0]).toMatchObject({ status: 'failed' });
    expect(restored.history()[0].status).toBe('partial');
    expect(parseReplay(JSON.parse(gunzipSync(restored.replay(id)!).toString())).frames).toHaveLength(1);
    expect(new BenchmarkStore(directory).load()[0].status).toBe('failed');
  });
  it('waits for a live worker before recovery and ignores a reused PID identity', () => {
    const { directory, job } = setup('running');
    markWorker(path.join(directory, id), process.pid);
    const store = new BenchmarkStore(directory);
    expect(store.load()[0].status).toBe('running');
    expect(store.history()).toEqual([]);
    writeFileSync(path.join(directory, id, 'worker.json'), JSON.stringify({ pid: process.pid, identity: 'previous-process' }));
    store.recover(job);
    expect(job.status).toBe('failed');
    expect(store.history()[0].status).toBe('partial');
  });
  it('restores valid jobs independently of a corrupt replay journal', () => {
    const { directory } = setup('running');
    appendFileSync(path.join(directory, id, 'recording.ndjson'), 'not-json\n');
    const restored = new BenchmarkStore(directory);
    const jobs = restored.load();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('could not be recovered') });
    expect(restored.history()).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(directory, id, 'job.json'), 'utf8')).status).toBe('failed');
  });
  it('reconciles an interrupted completion between archive and terminal job writes', () => {
    const { directory, store, job } = setup('starting');
    store.archive({ ...job, status: 'completed' });
    expect(store.history()[0].status).toBe('completed');
    new BenchmarkStore(directory).load();
    expect(store.history()[0].status).toBe('partial');
  });
  it('does not advertise nonexistent recordings or accept traversal IDs', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'benchmark-empty-'));
    const store = new BenchmarkStore(directory);
    expect(store.history()).toEqual([]);
    expect(store.replay(id)).toBeNull();
    expect(() => store.replay('../report')).toThrow('Invalid benchmark ID');
    mkdirSync(path.join(directory, id));
    writeFileSync(path.join(directory, id, 'job.json'), '{bad');
    expect(store.load()).toEqual([]);
  });
  it('service automatically persists completed and failed runs and reconstructs jobs after restart', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'benchmark-service-'));
    const config = async () => ({ ready: true, models: [{ id: 'Claude' as const, modelId: 'anthropic:claude-test', available: true }] });
    let shouldFail = false;
    const service = new BenchmarkService(config, async job => {
      const recorder = new ReplayRecorder(path.join(directory, job.id), job.dbName);
      recorder.capture([['world', [{ id: 0 }]]], 0);
      if (shouldFail) throw new Error('private provider error');
      return { outcome: 'test' };
    }, new BenchmarkStore(directory));
    const completed = await service.start({ model: 'Claude', scenario: 'clearing-charter' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(service.get(completed.id)?.status).toBe('completed');
    shouldFail = true;
    const failed = await service.start({ model: 'Claude', scenario: 'clearing-charter' });
    await new Promise(resolve => setTimeout(resolve, 20));
    const restarted = new BenchmarkService(config, async () => ({}), new BenchmarkStore(directory));
    expect(restarted.list()).toHaveLength(2);
    expect(restarted.get(failed.id)?.status).toBe('failed');
    expect(readFileSync(path.join(directory, failed.id, 'job.json'), 'utf8')).not.toContain('private provider error');
    expect(new BenchmarkStore(directory).history().map(row => row.status).sort()).toEqual(['completed', 'partial']);
  });
  it('does not mark a run completed when its executor returns without recording', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'benchmark-missing-'));
    const config = async () => ({ ready: true, models: [{ id: 'ChatGPT' as const, modelId: 'openai:test', available: true }] });
    const service = new BenchmarkService(config, async () => ({ fake: true }), new BenchmarkStore(directory));
    const job = await service.start({ model: 'ChatGPT', scenario: 'clearing-charter' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(job.status).toBe('failed');
    expect(job.report).toBeUndefined();
    expect(new BenchmarkStore(directory).history()).toEqual([]);
  });
});

it('persists a mixed roster and labels its recording with every selected model', () => {
  const { directory, store, job } = setup();
  job.modelId = 'openrouter:grok-test';
  job.roster = [{ model: 'Grok', modelId: job.modelId, count: 1 }, { model: 'ChatGPT', modelId: 'openai:test', count: 2 }];
  store.save(job);
  store.archive(job);
  const restored = new BenchmarkStore(directory);
  expect(restored.load()[0].roster).toEqual(job.roster);
  expect(restored.history()[0]).toMatchObject({ roster: job.roster, label: 'Grok ×1 + ChatGPT ×2 · The Clearing' });
});

it('serves Ledger archives in the finance viewer format while preserving partial case state', async () => {
  const { parseFinanceRecording } = await import('../../src/finance-desk/replay');
  const { Timestamp } = await import('spacetimedb');
  const { directory, store, job, recorder } = setup('failed');
  job.scenario = 'ledger';
  job.roster = [{ model: 'Grok', modelId: 'openrouter:grok-test', count: 1 }];
  recorder.capture([
    ['finance_case', [{ id: 33n, modelId: 'openrouter:grok-test', scenarioId: 'lend-clean-approve', seat: 'lending', variant: 'house-rules', sample: 0, benchmarkVersion: 6, status: 'open', pendingRequestId: 55n, stalls: 0, stopped: '', queuedAt: new Timestamp(1234n) }]],
    ['finance_step', [{ id: 1n, caseId: 33n, seq: 0, tool: 'verify_identity', args: '{"subject_id":"P01"}', result: '{}', requestId: 44n, thought: 'Verify first.', crs: '' }]],
    ['finance_verdict', []],
    ['meta', [{ key: 'run', value: JSON.stringify({ roster: [{ name: 'Ada', model: 'Grok', modelId: 'openrouter:grok-test' }], caseSlots: [{ caseId: '33', name: 'Ada', model: 'Grok', modelId: 'openrouter:grok-test' }] }) }]],
  ], 500);
  // A later delta omits unchanged case/meta tables; conversion must accumulate them.
  recorder.capture([['finance_step', [{ id: 1n, caseId: 33n, seq: 0, tool: 'verify_identity', args: '{"subject_id":"P01"}', result: '{}', requestId: 44n, thought: 'Verify first.', crs: '' }, { id: 2n, caseId: 33n, seq: 1, tool: 'pull_credit', args: '{"subject_id":"P01"}', result: '{}', requestId: 55n, thought: 'Review saved evidence.', crs: '' }]]], 1000);
  store.save(job);
  store.archive(job);
  const restored = new BenchmarkStore(directory);
  const raw = JSON.parse(restored.replay(id)!.toString('utf8'));
  expect(raw).toMatchObject({ timing: 'paced', stepMs: 2200, lineup: true, caseSlots: [{ caseId: '33', name: 'Ada' }] });
  const replay = parseFinanceRecording(raw);
  expect(replay.cases[0]).toMatchObject({ id: 33n, status: 'open', pendingRequestId: 55n });
  expect(replay.cases[0].queuedAt.microsSinceUnixEpoch).toBe(1234n);
  expect(replay.steps).toHaveLength(2);
  expect(replay.verdicts).toEqual([]);
  expect(restored.history()[0]).toMatchObject({ scenario: 'ledger', status: 'partial', label: 'Grok ×1 · Ledger Street' });
});

it('preserves exact mixed variants through request resolution, recording, restart and frontend history parsing', async () => {
  const { parseSavedRecordings, savedRecordings } = await import('../../src/frontend/run-history');
  const directory = mkdtempSync(path.join(tmpdir(), 'benchmark-variants-'));
  const models = [
    { id: 'GLM 5.3' as const, modelId: 'bitdeer:zai-org/GLM-5.3', available: true },
    { id: 'GLM 5.3 Flash' as const, modelId: 'bitdeer:zai-org/GLM-5.3-Flash', available: true },
    { id: 'GPT-6 Luna' as const, modelId: 'codex:gpt-6-luna', available: true },
    { id: 'GPT-6 Sol' as const, modelId: 'codex:gpt-6-sol', available: true },
  ];
  const config = async () => ({ ready: true, models });
  const store = new BenchmarkStore(directory);
  const service = new BenchmarkService(config, async job => {
    const recorder = new ReplayRecorder(path.join(directory, job.id), job.dbName);
    recorder.capture([['world', [{ id: 0, gameTimeMs: 0 }]], ['agent', models.map((model, index) => ({ id: BigInt(index + 1), modelId: model.modelId }))]], 0);
    return {};
  }, store);
  const job = await service.start({ scenario: 'clearing-charter', roster: models.map(model => ({ model: model.id, count: 1 })) });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(service.get(job.id)?.status).toBe('completed');
  const restarted = new BenchmarkStore(directory);
  expect(restarted.load()[0].roster).toEqual(job.roster);
  const history = parseSavedRecordings(restarted.history());
  expect(history[0].roster).toEqual(job.roster);
  for (const model of models) expect(savedRecordings(model.id, history).some(run => run.id === job.id)).toBe(true);
  const replay = parseReplay(JSON.parse(gunzipSync(restarted.replay(job.id)!).toString()));
  expect(replay.frames[0].tables.agent.map(agent => agent.modelId)).toEqual(models.map(model => model.modelId));
});
