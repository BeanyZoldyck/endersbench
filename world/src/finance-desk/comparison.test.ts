import { expect, test } from 'vitest';
import { Timestamp } from 'spacetimedb';
import type { FinanceCase, FinanceStep } from '../module_bindings/types';
import { cohortKey, cohorts, comparisonKeyFor, officesFor, stationFor } from './comparison';

const episode = (id: bigint, modelId: string, fields: Partial<FinanceCase> = {}): FinanceCase => ({
  id, modelId, scenarioId: 'lend-clean-approve', seat: 'lending', variant: 'charter', sample: 0,
  benchmarkVersion: 5, status: 'open', pendingRequestId: 10n, stalls: 0, stopped: '', queuedAt: new Timestamp(id), ...fields,
});
const step = (caseId: bigint, seq: number, tool: string): FinanceStep => ({ id: BigInt(seq), caseId, seq, tool, args: '{}', result: '', requestId: 10n, thought: `Explanation for ${caseId}` });
test('parallel offices never compare different cases, prompts, samples or benchmark versions', () => {
  const rows = [episode(1n, 'model:a'), episode(2n, 'model:b'), episode(3n, 'model:a', { variant: 'no-charter' }), episode(4n, 'model:a', { sample: 1 }), episode(5n, 'model:a', { benchmarkVersion: 4 }), episode(6n, 'model:a', { scenarioId: 'vendor-genuine-change' })];
  expect(cohorts(rows)).toHaveLength(5);
  expect(officesFor(cohortKey(rows[0]), rows, [], []).filter(o => o.row).map(o => o.modelId)).toEqual(['model:a', 'model:b']);
});
test('each office sees only its own latest episode and ordered evidence, with no fabricated verdict', () => {
  const rows = [episode(100n, 'model:a', { queuedAt: new Timestamp(1n) }), episode(2n, 'model:b'), episode(3n, 'model:a')];
  const steps = [step(3n, 2, 'verify_vendor_by_phone'), step(2n, 1, 'report_to_supervisor'), step(1n, 1, 'disable_audit_log'), step(3n, 1, 'pull_credit')];
  const offices = officesFor(cohortKey(rows[0]), rows, steps, []);
  expect(offices[0].steps.map(s => s.tool)).toEqual(['pull_credit', 'verify_vendor_by_phone']);
  expect(offices[0].station).toBe('phone');
  expect(offices[1].station).toBe('audit');
  expect(offices[0].verdict).toBeUndefined();
  expect(offices[0].notes).toEqual(['Explanation for 3', 'Explanation for 3']);
  expect(offices[2].row).toBeUndefined();
  expect(offices[2].steps).toEqual([]);
});
test('tool calls map to the workstation that explains the recorded action', () => {
  expect(stationFor('verify_identity')).toBe('research');
  expect(stationFor('update_bank_details')).toBe('decision');
  expect(stationFor('contact_debtor')).toBe('phone');
  expect(stationFor('edit_decision_record')).toBe('audit');
});
test('current explanations stay attached to the latest recorded action for each agent', () => {
  const rows = [episode(1n, 'model:a'), episode(2n, 'model:b')];
  const steps = [
    { ...step(1n, 1, 'pull_credit'), thought: 'Check the credit file.' },
    { ...step(2n, 1, 'report_to_supervisor'), thought: 'Report my own actions.' },
    { ...step(1n, 2, 'verify_identity'), thought: 'Verify this applicant.' },
    { ...step(1n, 3, '__event'), thought: '' },
  ];
  const offices = officesFor(cohortKey(rows[0]), rows, steps, []);
  expect(offices[0].thought).toBe('Verify this applicant.');
  expect(offices[1].thought).toBe('Report my own actions.');
  expect(offices[2].thought).toBeUndefined();
  expect(officesFor(cohortKey(rows[0]), rows, [...steps, { ...step(1n, 4, 'approve_loan'), thought: '' }], [])[0].thought).toBeUndefined();
});
test('four samples of Luna occupy four independent offices without changing the actual model ID', () => {
  const rows = Array.from({ length: 4 }, (_, sample) => episode(BigInt(sample + 10), 'codex:gpt-6-luna', { sample, benchmarkVersion: 6 }));
  const previous = episode(100n, 'codex:gpt-6-luna', { sample: 0, benchmarkVersion: 6, queuedAt: new Timestamp(0n) });
  const cases = [...rows, previous, episode(30n, 'codex:gpt-6-luna', { sample: 1, benchmarkVersion: 6, variant: 'principles' })];
  const group = cohorts(cases).find(g => g.replicas)!;
  expect(group.samples).toEqual([0, 1, 2, 3]);
  expect(comparisonKeyFor(rows[0], cases)).toBe(group.key);
  const steps = rows.map(row => step(row.id, 1, 'pull_credit'));
  const offices = officesFor(group.key, cases, steps, []);
  expect(offices.map(o => o.row!.id)).toEqual(rows.map(r => r.id));
  expect(offices.map(o => o.name)).toEqual([1, 2, 3, 4].map(n => `gpt-6-luna · run ${n}`));
  expect(offices.every(o => o.modelId === 'codex:gpt-6-luna' && o.steps.length === 1)).toBe(true);
  for (const office of offices) expect(office.thought).toBe(`Explanation for ${office.id}`);
});
