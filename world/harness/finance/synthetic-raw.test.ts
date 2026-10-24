import { describe, expect, test } from 'vitest';
// @ts-expect-error plain ES module shared with crs/build-cards.mjs
import { cardFromResponses } from '../../../crs/card-from-crs.mjs';
import { policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { CARDS } from '../../spacetimedb/src/finance/cards';
import { observe } from '../../spacetimedb/src/finance/engine';
import { familyCases } from '../../spacetimedb/src/finance/families';
import { gateCase } from '../../spacetimedb/src/finance/gate';
import { RATE_CARD } from '../../spacetimedb/src/finance/policy';
import { PRODUCT_FILES } from './rawcrs';
import { ARCHETYPES, archetypeOf, syntheticCards, syntheticInstances } from './synthetic';
import { rawCrsWith, synthesize } from './synthetic-raw';

const cards = syntheticCards();
Object.assign(CARDS, cards);
const { raw, fullFile } = rawCrsWith(cards);

describe('synthetic raw CRS responses', () => {
  test('read back to exactly the synthetic card, for every file and product', () => {
    for (const card of Object.values(cards)) {
      const file = fullFile(card.id);
      expect(Object.keys(file), card.id).toEqual(PRODUCT_FILES);
      const back = cardFromResponses(
        { id: card.id, personaName: card.name.toUpperCase(), born: card.born, city: card.city.toUpperCase(), state: card.state, zip: card.zip },
        (f: string) => file[f]
      );
      expect(back, card.id).toEqual(card);
    }
  });

  test('never mention the archetype persona, by name, city, SSN or birth year', () => {
    for (const card of Object.values(cards)) {
      const template = CARDS[ARCHETYPES[archetypeOf(card.id)]];
      const text = JSON.stringify(fullFile(card.id));
      const [first, last] = template.name.split(' ');
      const own = `${card.name} ${card.city}`.toUpperCase();
      for (const needle of [first.toUpperCase(), last.toUpperCase(), template.city.toUpperCase(), `666701${template.id.slice(1).padStart(3, '0')}`]) {
        if (own.includes(needle)) continue; // the synthetic name list shares a surname with a persona (Abernathy)
        expect(text, `${card.id} from ${template.id}: ${needle}`).not.toContain(needle);
      }
      // The identity product's date of birth is the synthetic one.
      const identity = JSON.stringify(file(card.id, 'tu_identity_verification-tu-identity'));
      expect(identity, card.id).toContain(`"${card.born}-`);
      expect(identity, card.id).not.toContain(`"${template.born}-`);
    }
  });

  test('the same every time, and only for synthetic ids', () => {
    expect(synthesize(cards.S001, 'credit_report-transunion')).toEqual(synthesize(cards.S001, 'credit_report-transunion'));
    expect(raw('pull_credit', { subject_id: 'P01', bureau: 'transunion' })).toEqual(JSON.parse(JSON.stringify(fullFile('P01')['credit_report-transunion'])));
    expect(JSON.stringify(raw('pull_credit', { subject_id: 'S001', bureau: 'transunion' }))).toContain(cards.S001.name.split(' ')[1].toUpperCase());
  });

  test('Script A scores the same on every synthetic case whether it was shown cards or full responses', () => {
    const cases = familyCases(syntheticInstances(cards), cards, { prefix: 'syn-' });
    for (const s of cases) if (s.seat === 'lending') s.brief.rateCard = RATE_CARD;
    for (const s of cases) {
      const card = runBrain(policyFollower, s);
      const full = runBrain(policyFollower, s, { raw });
      expect(gateCase(s, full), s.id).toEqual(gateCase(s, card));
      expect(gateCase(s, full).pass, s.id).toBe(true);
      const shown = JSON.parse(observe(s, full)).timeline.filter((e: any) => e.action && /pull_credit|verify_identity|check_fraud|search_public_records/.test(e.action.tool));
      for (const e of shown) expect(JSON.stringify(e.action.result).length, `${s.id} ${e.action.tool}`).toBeGreaterThan(500);
    }
  });
});

const file = (id: string, product: string) => fullFile(id)[product];
