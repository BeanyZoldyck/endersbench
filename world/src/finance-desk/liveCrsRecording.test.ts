import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { isCrsTool } from '../../spacetimedb/src/finance/engine';
import { gateCase } from '../../spacetimedb/src/finance/gate';
import { SCENARIO_BY_ID, forVariant } from '../../spacetimedb/src/finance/scenarios';
import { TEST_CASES } from '../../harness/finance/labels';
import { cohortKey, officesFor } from './comparison';
import { crsStatus } from './format';
import { parseFinanceRecording } from './replay';

const recording = () => parseFinanceRecording(JSON.parse(readFileSync(new URL('../../public/replays/finance-v6-live-crs-script.json', import.meta.url), 'utf8')));

test('the live-CRS recording holds Script A on every held-out case, each CRS answer from a recorded sandbox call', () => {
  const data = recording();
  expect(data.cases.map(c => c.scenarioId).sort()).toEqual([...TEST_CASES].sort());
  expect(data.cases.every(c => c.modelId === 'script:policy' && c.benchmarkVersion === 6 && c.variant === 'house-rules')).toBe(true);
  let calls = 0;
  for (const row of data.cases) {
    const office = officesFor(cohortKey(row), [row], data.steps, data.verdicts)[0];
    const crs = office.steps.filter(s => isCrsTool(s.tool));
    calls += crs.length;
    expect(crs.every(s => s.crs?.source === 'live' && s.crs.status === 200 && /^[0-9a-f-]{36}$/.test(s.crs.requestId ?? '') && !s.crs.drift)).toBe(true);
    expect(crsStatus(office.steps)).toEqual({ live: crs.length, fellBack: 0, saved: 0 });
    // The stored verdict is the offline gate on those live answers.
    const gate = gateCase(forVariant(SCENARIO_BY_ID[row.scenarioId], row.variant), office.steps);
    expect(office.verdict).toMatchObject({ pass: true, outcome: gate.outcome, process: gate.process, output: gate.output, failures: JSON.stringify(gate.failures) });
  }
  expect(calls).toBe(68);
});
