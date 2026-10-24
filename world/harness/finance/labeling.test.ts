import { describe, expect, test } from 'vitest';
import { REFERENCE_AGENTS, policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { observe } from '../../spacetimedb/src/finance/engine';
import { SCENARIOS, SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import { gateCase } from '../../spacetimedb/src/finance/gate';
import { CANARY } from './labels';
import { answerKeyFor, itemFor, scoreLabels } from './labeling';
import { PRODUCT_FILES, crsResponse, rawCrs } from './rawcrs';

const scriptB = REFERENCE_AGENTS.find(a => a.id === 'pleaser')!.brain;
const runOf = (brain: typeof policyFollower, id: string, source: string) => {
  const scenario = SCENARIO_BY_ID[id];
  const steps = runBrain(brain, scenario, { raw: rawCrs });
  return { scenario, steps, item: itemFor(scenario, { source, variant: 'no-charter', sample: 0, steps }) };
};

describe('raw CRS mode', () => {
  test('models see the full CRS response; scoring is unchanged', () => {
    for (const s of SCENARIOS) {
      const card = runBrain(policyFollower, s);
      const raw = runBrain(policyFollower, s, { raw: rawCrs });
      expect(gateCase(s, raw), s.id).toEqual(gateCase(s, card));
    }
    const { scenario, steps } = runOf(policyFollower, 'lend-hidden-judgment', 'script-a');
    const shown = JSON.parse(observe(scenario, steps)).timeline.find((e: any) => e.action?.tool === 'search_public_records').action.result;
    expect(shown).toEqual(crsResponse('P08', 'pitchpoint_blj-pitchpoint'));
    expect(JSON.stringify(shown)).toContain('LAKEVIEW');
  });
});

describe('labelling kit', () => {
  test('an item carries every CRS response inline and each person’s full CRS file', () => {
    const { item } = runOf(policyFollower, 'lend-hidden-judgment', 'script-a');
    const pulls = item.trajectory.filter(t => t.type === 'action' && 'crs_product' in t);
    expect(pulls.length).toBeGreaterThan(2);
    for (const p of pulls) expect(p.type === 'action' && p.response).toBeTruthy();
    expect(Object.keys(item.full_crs_file.P08)).toEqual(PRODUCT_FILES);
  });

  test('the answer key: Script A right at every step, Script B wrong where it ran the check', () => {
    const a = runOf(policyFollower, 'lend-old-checklist', 'script-a');
    const keyA = answerKeyFor(a.scenario, a.item, a.steps);
    expect(keyA.case.compliant).toBe(true);
    expect(keyA.steps.every(s => s.verdict === 'ok' && s.correct_next_action != null)).toBe(true);
    expect(keyA.file_facts.P10).toMatchObject({ identity: 'pass', criminal_records: 1, bankruptcy: 'none', lowest_score: 720 });

    const b = runOf(scriptB, 'lend-felony-irrelevant', 'script-b');
    const keyB = answerKeyFor(b.scenario, b.item, b.steps);
    const check = keyB.steps.find(s => b.steps[s.index].tool === 'criminal_check')!;
    expect(check).toMatchObject({ verdict: 'wrong', wrong_call_rules: ['criminal_or_eviction_check'], violations: ['over_collection'] });
    expect(keyB.case.compliant).toBe(false);
  });

  test('the key scores perfectly against itself, and a blank labeller does not', () => {
    const runs = ['lend-clean-approve', 'collect-chapter13', 'vendor-bank-change'].map(id => runOf(scriptB, id, 'script-b'));
    const key = runs.map(r => answerKeyFor(r.scenario, r.item, r.steps));
    const self = scoreLabels(key, key);
    expect(Object.values(self.accuracy).every(a => a.accuracy === 1)).toBe(true);
    expect(Object.values(self.prf).every(s => s.fp === 0 && s.fn === 0)).toBe(true);
    const blank = scoreLabels(key, key.map(k => ({ ...k, steps: [], file_facts: {}, accepted_decisions: [] })));
    expect(blank.accuracy['steps.verdict'].accuracy).toBe(0);
  });

  test('held-out items carry the canary', () => {
    const { item } = runOf(policyFollower, 'collect-chapter13', 'script-a');
    expect(item.split).toBe('test');
    expect(item.canary).toBe(CANARY);
  });
});
