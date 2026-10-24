import { describe, expect, test } from 'vitest';
import { policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { CARDS } from '../../spacetimedb/src/finance/cards';
import { familyCases } from '../../spacetimedb/src/finance/families';
import { gateCase } from '../../spacetimedb/src/finance/gate';
import { RATE_CARD } from '../../spacetimedb/src/finance/policy';
import { SCENARIOS } from '../../spacetimedb/src/finance/scenarios';
import { ARCHETYPES, archetypeOf, syntheticCards, syntheticInstances } from './synthetic';

const cards = syntheticCards();
Object.assign(CARDS, cards);
const cases = familyCases(syntheticInstances(cards), cards, { prefix: 'syn-' });
for (const s of cases) if (s.seat === 'lending') s.brief.rateCard = RATE_CARD;

describe('synthetic training files', () => {
  test('are new people, every archetype, and the same every time', () => {
    const real = new Set(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20']);
    const realNames = new Set([...real].map(id => CARDS[id].name));
    expect(Object.keys(cards).some(id => real.has(id))).toBe(false);
    expect(Object.values(cards).some(c => realNames.has(c.name))).toBe(false);
    expect(new Set(Object.keys(cards).map(id => archetypeOf(id)))).toEqual(new Set(Object.keys(ARCHETYPES)));
    expect(syntheticCards()).toEqual(cards);
  });

  test('Script A, the source of every training target, passes every synthetic case', () => {
    const failed = cases.map(s => ({ id: s.id, gate: gateCase(s, runBrain(policyFollower, s)) })).filter(x => !x.gate.pass);
    expect(failed.map(f => `${f.id}: ${f.gate.failures.join(', ')}`)).toEqual([]);
    expect(cases.length).toBeGreaterThan(150);
  });

  test('never collide with a benchmark case', () => {
    const ids = new Set(SCENARIOS.map(s => s.id));
    expect(cases.some(s => ids.has(s.id))).toBe(false);
    expect(new Set(cases.map(s => s.id)).size).toBe(cases.length);
  });

  test('span every desk and every answer', () => {
    expect(new Set(cases.map(s => s.seat))).toEqual(new Set(['lending', 'collections', 'vendor_payments']));
    const answers = new Set(cases.flatMap(s => s.accepted));
    for (const a of ['approve_loan', 'decline_application', 'report_fraud', 'escalate_to_human', 'contact_debtor', 'pause_collection', 'release_payment', 'hold_payment']) expect(answers, a).toContain(a);
  });
});
