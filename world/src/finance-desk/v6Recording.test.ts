import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { SCENARIO_BY_ID, forVariant } from '../../spacetimedb/src/finance/scenarios';
import { verify } from '../../spacetimedb/src/finance/verifier';
import { gateCase } from '../../spacetimedb/src/finance/gate';
import { benchmarkRows } from './insights';
import { financeDuration, financeFrameAt, parseFinanceRecording } from './replay';
import { officesFor, cohortKey } from './comparison';

const recording = () => parseFinanceRecording(JSON.parse(readFileSync(new URL('../../public/replays/finance-v6-luna.json', import.meta.url), 'utf8')));

test('the recorded v6 server scores match the offline benchmark under each actual prompt condition', () => {
  const data = recording();
  expect(data.cases).toHaveLength(10);
  expect(new Set(data.cases.map(c => c.variant)).size).toBe(4);
  for (const row of data.cases) {
    expect(row.benchmarkVersion).toBe(6);
    expect(row.status).toBe('closed');
    expect(row.stopped).toBe('');
    const office = officesFor(cohortKey(row), [row], data.steps, data.verdicts)[0];
    const scenario = forVariant(SCENARIO_BY_ID[row.scenarioId], row.variant);
    const gate = gateCase(scenario, office.steps);
    const { failures, actionNeeded, ...storedGate } = gate;
    expect(office.verdict).toMatchObject({ ...storedGate, actionNeeded, failures: JSON.stringify(failures) });
    expect(office.detail).toEqual(verify(scenario, office.steps));
  }
});

test('v6 replay hides future results and reports seven-case coverage separately for each condition', () => {
  const data = recording();
  expect(financeFrameAt(data, 0).verdicts).toEqual([]);
  const complete = financeFrameAt(data, financeDuration(data));
  expect(complete.verdicts).toHaveLength(10);
  const house = benchmarkRows(complete, 'house-rules', 6);
  expect(house).toHaveLength(1);
  expect(house[0]).toMatchObject({ completed: 7, cases: 7, totalCases: 70, compliant: 6, law: 2, lawPassed: 1, policy: 5, policyPassed: 5 });
  const old = parseFinanceRecording(JSON.parse(readFileSync(new URL('../../public/replays/finance-v5-luna.json', import.meta.url), 'utf8')));
  expect(benchmarkRows({ cases: [...complete.cases, ...old.cases], steps: [...complete.steps, ...old.steps], verdicts: [...complete.verdicts, ...old.verdicts] }, 'house-rules', 6)).toEqual(house);
});

test('recordings made before live CRS calls load with no call on any step', () => {
  const data = recording();
  expect(data.steps.length).toBeGreaterThan(0);
  expect(data.steps.every(s => s.crs === '')).toBe(true);
});
