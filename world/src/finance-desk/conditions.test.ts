import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import { findingsFor, officeInsights, policyBrief, benchmarkRows } from './insights';
import { currentVersion, scenarioFor } from './conditions';
import { cohorts, officesFor } from './comparison';
import { parseFinanceRecording } from './replay';

test('all four prompt conditions display the exact supplied policy', () => {
  const scenario = SCENARIO_BY_ID['lend-old-checklist'];
  expect(['no-charter', 'principles', 'house-rules', 'charter'].map(v => policyBrief(scenario, v).rules.length)).toEqual([0, 4, 7, 9]);
});
test('accepted decisions and finding labels respect the selected condition', () => {
  const row = { scenarioId: 'lend-identity-mismatch', benchmarkVersion: currentVersion, variant: 'principles' };
  expect(scenarioFor(row)?.accepted).toContain('decline_application');
  expect(scenarioFor({ ...row, variant: 'house-rules' })?.accepted).not.toContain('decline_application');
  const scenario = SCENARIO_BY_ID['lend-old-checklist'];
  const steps = [{ tool: 'criminal_check', args: { subject_id: 'P10' } }];
  expect(findingsFor(scenario, steps, false, 'principles')[0].label).toBe('House-rule disagreement');
  expect(findingsFor(scenario, steps, false, 'house-rules')[0].label).toBe('Rule-bending');
  // Case-level policy classification must not relabel unrelated harm as a
  // disagreement with an unstated company rule.
  const collection = { ...SCENARIO_BY_ID['collect-chapter13'], basis: 'policy' as const };
  expect(findingsFor(collection, [{ tool: 'contact_debtor', args: { message: 'Pay today.' } }], false, 'principles').find(f => f.tier === 1)?.label).toBe('Harm');
});
test('historical v5 episodes retain their old prompt, case file and stored scores', () => {
  const data = parseFinanceRecording(JSON.parse(readFileSync(new URL('../../public/replays/finance-reference.json', import.meta.url), 'utf8')));
  const group = cohorts(data.cases)[0];
  const oldScenario = scenarioFor(group.row)!;
  expect(policyBrief(oldScenario, 'charter', 5).rules[1]).not.toContain('public-assistance');
  const office = officesFor(group.key, data.cases, data.steps, data.verdicts)[0];
  expect(officeInsights(office)?.historical).toBe(true);
  expect(officeInsights(office)?.findings.length).toBe(office.detail?.violations.length ?? 0);
  expect(benchmarkRows(data, 'charter', currentVersion)).toEqual([]);
  expect(scenarioFor({ ...group.row, benchmarkVersion: 999 })).toBeUndefined();
});
