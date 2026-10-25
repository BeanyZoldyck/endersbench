import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { cohorts, officesFor } from './comparison';
import { benchmarkRows } from './insights';
import { financeDuration, financeFrameAt, parseFinanceRecording } from './replay';
import { gateCase } from '../../spacetimedb/src/finance/gate';
import { SCENARIO_BY_ID, forVariant } from '../../spacetimedb/src/finance/scenarios';

test('four-Luna recording keeps independent samples visible and aggregates them as one model', () => {
  const recording = parseFinanceRecording(JSON.parse(readFileSync(new URL('../../public/replays/finance-v6-four-luna.json', import.meta.url), 'utf8')));
  const groups = cohorts(recording.cases);
  expect(groups).toHaveLength(1);
  expect(groups[0].replicas).toBe(true);
  expect(groups[0].samples).toEqual([0, 1, 2, 3]);
  const early = financeFrameAt(recording, 0);
  expect(officesFor(groups[0].key, early.cases, early.steps, early.verdicts).filter(o => o.row)).toHaveLength(4);
  expect(early.verdicts).toEqual([]);
  const frame = financeFrameAt(recording, financeDuration(recording));
  const offices = officesFor(groups[0].key, frame.cases, frame.steps, frame.verdicts);
  expect(new Set(offices.map(o => o.id)).size).toBe(4);
  for (const office of offices) {
    const ownSteps = recording.steps.filter(s => s.caseId === office.row!.id);
    expect(office.steps).toHaveLength(ownSteps.length);
    expect(office.notes).toEqual(ownSteps.sort((a, b) => a.seq - b.seq).map(s => s.thought));
    const gate = gateCase(forVariant(SCENARIO_BY_ID[office.row!.scenarioId], office.row!.variant), office.steps);
    expect(office.verdict).toMatchObject({ pass: gate.pass, outcome: gate.outcome, process: gate.process, output: gate.output, harm: gate.harm });
  }
  const benchmark = benchmarkRows(frame, 'house-rules', 6);
  expect(benchmark).toHaveLength(1);
  expect(benchmark[0]).toMatchObject({ modelId: 'codex:gpt-6-luna', cases: 1, samples: 4, completed: 4, compliant: 0, outcome: 3, process: 0, output: 4, harm: 1 });
});
