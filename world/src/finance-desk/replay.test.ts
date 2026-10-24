import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { financeDuration, financeFrameAt, parseFinanceRecording, caseTimeline, snapshotRun } from './replay';
import { EVENT_STEP } from '../../spacetimedb/src/finance/engine';
import { cohorts, officesFor } from './comparison';
const json = JSON.parse(readFileSync(new URL('../../public/replays/finance-reference.json', import.meta.url), 'utf8'));
const recording = () => parseFinanceRecording(json);

test('live replay freezes the selected real episode without scripted references or later updates', () => {
  const data = recording();
  data.cases[0].modelId = 'codex:gpt-6-luna';
  const row = data.cases[0];
  const key = cohorts([row])[0].key;
  const snapshot = snapshotRun(data, key);
  expect(snapshot.cases.map(c => c.id)).toEqual([row.id]);
  expect(snapshot.steps.every(s => s.caseId === row.id)).toBe(true);
  expect(snapshot.verdicts.every(v => v.caseId === row.id)).toBe(true);
  const count = snapshot.steps.length;
  data.steps.push({ ...data.steps.find(s => s.caseId === row.id)!, seq: 999 });
  row.status = 'open';
  expect(snapshot.steps).toHaveLength(count);
  expect(snapshot.cases[0].status).toBe('closed');
  expect(financeFrameAt(snapshot, 0).verdicts).toEqual([]);
  expect(financeFrameAt(snapshot, financeDuration(snapshot)).verdicts).toEqual(snapshot.verdicts);
});

test('recorded scripts begin with agents present and no future decisions or scores', () => {
  const data = recording(), frame = financeFrameAt(data, 0);
  expect(data.cases).toHaveLength(12);
  expect(frame.steps.every(s => s.tool === EVENT_STEP)).toBe(true);
  expect(frame.verdicts).toEqual([]);
  expect(frame.cases.every(c => c.status === 'open' && c.stopped === '' && c.pendingRequestId === 0n)).toBe(true);
  const groups = cohorts(frame.cases);
  expect(groups).toHaveLength(3);
  for (const group of groups) expect(officesFor(group.key, frame.cases, frame.steps, frame.verdicts).filter(o => o.row)).toHaveLength(4);
});
test('scrubbing reveals each recorded action with its following messages and can seek backward', () => {
  const data = recording(), frame = financeFrameAt(data, data.stepMs);
  for (const row of data.cases) {
    const timeline = caseTimeline(data.steps.filter(s => s.caseId === row.id));
    expect(frame.steps.filter(s => s.caseId === row.id)).toEqual(timeline.filter(s => s.turn <= 1).map(s => s.step));
  }
  expect(financeFrameAt(data, financeDuration(data)).verdicts).toHaveLength(12);
  expect(financeFrameAt(data, 0).verdicts).toHaveLength(0);
});
test('the end matches stored evidence and verdicts, revealing a case score only after its last action', () => {
  const data = recording(), frame = financeFrameAt(data, financeDuration(data));
  expect(frame.cases).toEqual(data.cases);
  expect(frame.verdicts).toEqual(data.verdicts);
  for (const row of data.cases) {
    const ordered = data.steps.filter(s => s.caseId === row.id).sort((a, b) => a.seq - b.seq);
    expect(frame.steps.filter(s => s.caseId === row.id)).toEqual(ordered);
    const turns = ordered.filter(s => s.tool !== EVENT_STEP).length;
    expect(financeFrameAt(data, turns * data.stepMs).verdicts.some(v => v.caseId === row.id)).toBe(false);
    expect(financeFrameAt(data, (turns + 1) * data.stepMs).verdicts.some(v => v.caseId === row.id)).toBe(true);
  }
});
test('bad versions and orphaned evidence fail rather than inventing a replay', () => {
  expect(() => parseFinanceRecording({ ...json, version: 2 })).toThrow('Invalid finance replay');
  expect(() => parseFinanceRecording({ ...json, steps: [{ ...json.steps[0], caseId: { $big: '999999' } }] })).toThrow('Invalid replay evidence');
});
