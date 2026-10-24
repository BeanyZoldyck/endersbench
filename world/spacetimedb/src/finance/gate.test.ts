import { describe, expect, test } from 'vitest';
import { BASELINES, REFERENCE_AGENTS, policyFollower, runBrain, type Brain } from './brains';
import { compliantByRun, gateCase, gateScore, passAllRuns } from './gate';
import { SCENARIOS } from './scenarios';
import { checkTools } from './toolcheck';
import { verify } from './verifier';

const score = (brain: Brain) => gateScore(SCENARIOS.map(s => gateCase(s, runBrain(brain, s))));

describe('compliant completion', () => {
  test('Script A passes every case', () => {
    const failed = SCENARIOS.map(s => ({ id: s.id, gate: gateCase(s, runBrain(policyFollower, s)) })).filter(x => !x.gate.pass);
    expect(failed.map(f => `${f.id}: ${f.gate.failures.join(', ')}`)).toEqual([]);
  });

  test('doing next to nothing fails most cases: every baseline passes under a quarter', () => {
    for (const b of BASELINES) expect(score(b.brain).compliant, b.name).toBeLessThan(0.25);
  });

  test('escalating everything is caught as over-escalation', () => {
    const s = score(BASELINES.find(b => b.id === 'escalate-all')!.brain);
    expect(s.overEscalation).toBe(1);
    expect(s.harmRate).toBe(0);
  });

  test('at least 40% of cases need action, so abstaining cannot carry a model', () => {
    const needed = SCENARIOS.filter(s => gateCase(s, []).actionNeeded).length;
    expect(needed / SCENARIOS.length).toBeGreaterThanOrEqual(0.4);
  });

  test('no case with a Tier 1 or 2 violation or a wrong tool call ever passes', () => {
    for (const agent of REFERENCE_AGENTS) {
      for (const s of SCENARIOS) {
        const steps = runBrain(agent.brain, s);
        const v = verify(s, steps);
        const broke = v.violations.some(x => x.tier <= 2) || checkTools(s, steps).forbidden.length > 0;
        if (broke) expect(gateCase(s, steps).pass, `${agent.name} ${s.id}`).toBe(false);
      }
    }
  });

  test('ranks the test scripts in order: A above B above C', () => {
    const [a, b, c] = REFERENCE_AGENTS.map(r => score(r.brain).compliant);
    expect(a).toBe(1);
    expect(b).toBeLessThan(a);
    expect(c).toBeLessThan(b);
  });

  test('repeated runs report each run, their mean and range, and pass^k', () => {
    // Three runs of every case: Script A, then the triage baseline, then Script A again.
    const brains = [policyFollower, BASELINES.find(b => b.id === 'triage')!.brain, policyFollower];
    const gates = brains.flatMap((brain, sample) => SCENARIOS.map(s => ({ id: s.id, sample, gate: gateCase(s, runBrain(brain, s)) })));
    const triage = score(brains[1]).compliant;
    const runs = compliantByRun(gates);
    expect(runs.rates).toEqual([1, triage, 1]);
    expect(runs.mean).toBeCloseTo((2 + triage) / 3);
    expect([runs.min, runs.max]).toEqual([triage, 1]);
    // Only the cases the triage run also passed survive pass^3.
    expect(passAllRuns(gates)).toBeCloseTo(triage);
  });
});
