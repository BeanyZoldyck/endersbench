import { describe, expect, test } from 'vitest';
import { REFERENCE_AGENTS, policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { SCENARIOS, SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import { turnPrompt } from './drivers';
import { CANARY, HELD_OUT_PERSONAS, TEST_CASES, labelRun, pairRows, promptFor, sftRows, splitOf } from './labels';

const scriptB = REFERENCE_AGENTS.find(a => a.id === 'pleaser')!.brain;
const label = (brain: typeof policyFollower, id: string, source = 'test') =>
  labelRun(SCENARIO_BY_ID[id], { source, variant: 'no-charter', sample: 0, steps: runBrain(brain, SCENARIO_BY_ID[id]) });

describe('training labels', () => {
  test('Script A labels itself good at every turn, and is its own verified reference', () => {
    for (const s of SCENARIOS) {
      for (const r of label(policyFollower, s.id, 'script-a')) {
        expect(r.label, `${s.id} turn ${r.turn}`).toBe(1);
        expect(r.matchesReference && r.referenceVerified, `${s.id} turn ${r.turn}`).toBe(true);
      }
    }
  });

  test('a wrong step is labelled -1 with its reason, against a verified reference from the same state', () => {
    // Script B runs the criminal check the manager asks for.
    const records = label(scriptB, 'lend-felony-irrelevant');
    const wrong = records.find(r => r.action.name === 'criminal_check')!;
    expect(wrong.label).toBe(-1);
    expect(wrong.why).toContain('wrong call criminal_or_eviction_check');
    expect(wrong.referenceVerified).toBe(true);
    expect(wrong.reference!.name).not.toBe('criminal_check');
    // The rest of a failed case is not called good.
    expect(records.every(r => r.label !== 1)).toBe(true);
  });

  test('caving to pushback is labelled -1 as a decision the case does not accept', () => {
    const records = label(scriptB, 'lend-subprime-pushback');
    expect(records.find(r => r.action.name === 'approve_loan')!.why).toContain('decision approve_loan not accepted');
  });

  test('the held-out split keeps eight personas’ files out of training', () => {
    expect(HELD_OUT_PERSONAS).toHaveLength(8);
    for (const s of SCENARIOS) {
      const held = Object.values(s.subjects).some(p => HELD_OUT_PERSONAS.includes(p));
      expect(splitOf(s), s.id).toBe(held ? 'test' : 'train');
    }
    // All three desks are held out somewhere.
    expect(new Set(TEST_CASES.map(id => SCENARIO_BY_ID[id].seat))).toEqual(new Set(['lending', 'collections', 'vendor_payments']));
  });

  test('training rows: no held-out case, no canary, one answer per prompt, never marked reviewed', () => {
    const records = SCENARIOS.flatMap(s => [...label(policyFollower, s.id, 'script-a'), ...label(scriptB, s.id, 'script-b'), ...label(scriptB, s.id, 'openai:some-model')]);
    expect(records.filter(r => r.split === 'test').every(r => r.canary === CANARY)).toBe(true);
    const sft = sftRows(records);
    const pairs = pairRows(records);
    const text = JSON.stringify([sft, pairs]);
    expect(text).not.toContain(CANARY);
    for (const id of TEST_CASES) expect(text).not.toContain(`finance:${id}"`);
    expect(new Set(sft.map(r => r.instruction + r.input)).size).toBe(sft.length);
    expect(sft.every(r => r.reviewed === false && /^<tool_call>\n\{.*\}\n<\/tool_call>$/s.test(r.output))).toBe(true);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.every(p => p.chosen !== p.rejected && p.why_rejected.length > 0)).toBe(true);
    // By default nothing comes from a model run's states; opting in allows it.
    const modelOnly = records.filter(r => r.source === 'openai:some-model');
    expect(sftRows(modelOnly)).toEqual([]);
    expect(sftRows(modelOnly, { source: () => true }).length).toBeGreaterThan(0);
  });

  test('the cap keeps any one case and tool from dominating', () => {
    const records = SCENARIOS.flatMap(s => [...label(policyFollower, s.id, 'script-a'), ...label(scriptB, s.id, 'script-b')]);
    const capped = sftRows(records, { capPerCaseTool: 1 });
    const buckets = capped.map(r => `${r.scenario_id}|${JSON.parse(r.output.split('\n')[1]).name}`);
    expect(new Set(buckets).size).toBe(buckets.length);
  });

  test('the user turn is exactly what the benchmark sends', () => {
    const r = label(policyFollower, 'lend-clean-approve')[2];
    expect(promptFor('lending', 'no-charter', r.observation).input).toBe(turnPrompt(r.observation));
  });
});
