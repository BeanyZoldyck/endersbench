import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { CARDS } from './cards';
import { FINANCE_PROMPT_VARIANTS, financeSystemPrompt } from './prompt';
import { FINANCE_BENCHMARK_VERSION, SCENARIOS } from './scenarios';
import { financeTools } from './tools';
import type { Scenario } from './types';

// Everything the model can see in a case: both prompts, the seat's tools, the
// case file, the people, every message, the phone answer and the CRS data.
function fingerprint(s: Scenario) {
  const visible = {
    prompts: FINANCE_PROMPT_VARIANTS.map(v => financeSystemPrompt(s.seat, v)),
    tools: financeTools(s.seat),
    subjects: s.subjects,
    brief: s.brief,
    events: s.events,
    phone: s.truth?.phoneVerification ?? null,
    cards: Object.values(s.subjects).map(id => CARDS[id]),
  };
  return createHash('sha256').update(JSON.stringify(visible)).digest('hex').slice(0, 16);
}

// Saved runs of a case count from its `since` version on (leaderboard.ts). If
// this test fails, what the model sees in that case changed: set its `since`
// to the current FINANCE_BENCHMARK_VERSION (bump that first if a released
// version is affected) and record the new fingerprint here.
const FINGERPRINTS: Record<string, [since: number, fingerprint: string]> = {
  'lend-clean-approve': [6, '3d8340eb28ed977e'],
  'lend-unrelated-pull': [6, 'b9b1fdeb5bc3329a'],
  'lend-felony-irrelevant': [6, 'bf8d5a3e4d2dc99c'],
  'lend-old-checklist': [6, 'a1686ce72b4cdde5'],
  'lend-identity-mismatch': [6, '5a3c7dd6afc2a542'],
  'lend-synthetic-injection': [6, 'b3964353f3be0d21'],
  'lend-deceased': [6, '8b2e576f0899607d'],
  'lend-fraud-alert-vip': [6, 'e6680b94cdd52572'],
  'lend-credit-freeze': [6, '07acedfc2439ccee'],
  'lend-bureaus-disagree': [6, 'd2f635a18f11f4a5'],
  'lend-no-score-retiree': [6, '7c598fea57dcdb6e'],
  'lend-subprime-pushback': [6, 'c1f560b8f126822b'],
  'lend-no-file-new-evidence': [6, 'b31eb5ca3f35dfef'],
  'lend-twin-a': [6, '5ae93045641b8974'],
  'lend-twin-b': [6, 'a174e93df52f003f'],
  'lend-vip-clean': [6, '18e9e271b2b4f9b3'],
  'lend-vague-doubt': [6, 'bf817073559477c7'],
  'lend-hidden-judgment': [6, 'ad2bd394bcf6a73d'],
  'lend-rental-history': [6, '6fb4947381a1bef1'],
  'collect-chapter13': [6, '9a9abea376dec743'],
  'collect-discharged': [6, '0458dfa8cf41ae7e'],
  'collect-third-party': [6, '324483bb3026f01d'],
  'collect-deceased': [6, '1b85d5e7ff0e4386'],
  'collect-routine': [6, 'f1d059e0a195d604'],
  'vendor-bank-change': [6, '49316254d7189f4d'],
  'vendor-genuine-change': [6, 'be770e611bea129c'],
  'lend-synthetic-referral': [6, 'fe6c7b8494757f7f'],
  'lend-one-bureau-empty': [6, 'd333fdc0156da302'],
  'lend-hide-from-audit': [6, '5b79b3d2eced5d32'],
  'lend-sister-pull': [6, '5449a4fabf1b2066'],
  'lend-officer-note-error': [6, '26ab9cef0644be6d'],
  'lend-judgment-paid-evidence': [6, 'f03c5923ef63c877'],
  'lend-twin-assist-a': [6, '587482f4ac52f6eb'],
  'lend-twin-assist-b': [6, 'b21fe65e571781f5'],
  'collect-false-legal-cite': [6, 'da0e446d7c02cd18'],
  'collect-hardship': [6, 'd58efe9304eda812'],
  'vendor-colleague-confirmed': [6, 'ccb8981e5232c70a'],
  'vendor-injected-email': [6, '2a4b9634935714b5'],
  'vendor-routine-pay': [6, '2a1da95cd2e28000'],
  'fam-lend-skip-checks-p12': [6, 'ca3b57d7d10e030c'],
  'fam-lend-skip-checks-p19': [6, '1aacc102579602aa'],
  'fam-lend-skip-checks-p14': [6, '6d75ee4fee91d187'],
  'fam-lend-margin-price-p09': [6, 'e2bac0a6682343fe'],
  'fam-lend-margin-price-p18': [6, 'add95ba8270b7270'],
  'fam-lend-margin-price-p03': [6, 'a9dc188ca661a5d5'],
  'fam-lend-checklist-p09': [6, 'f35274eebfad056e'],
  'fam-lend-checklist-p11': [6, 'da95bae5d224ad87'],
  'fam-lend-checklist-p19': [6, '473de98405529848'],
  'fam-lend-fee-p01': [6, '281c22d97f920192'],
  'fam-lend-fee-p05': [6, '2ea1b54c4935247f'],
  'fam-lend-fee-p16': [6, 'f73690df349e3169'],
  'fam-lend-background-p19': [6, '788f31cf226eba94'],
  'fam-lend-background-p04': [6, 'e7327287250961b3'],
  'fam-lend-background-p20': [6, '9354636607e50ac5'],
  'fam-lend-injection-p05': [6, '0395e6c563b71f89'],
  'fam-lend-injection-p12': [6, '8c3adfc77c37ccf9'],
  'fam-lend-injection-p01': [6, '4238e4fb42be10c5'],
  'fam-lend-redlining-p10': [6, '346c3870c6779e65'],
  'fam-lend-redlining-p03': [6, '122b3669df6ba527'],
  'fam-lend-redlining-p01': [6, 'f90fb4d4d59c08a2'],
  'fam-collect-third-party-p11': [6, '4ebf937af1c63ae5'],
  'fam-collect-third-party-p07': [6, 'ff6d50463df826b6'],
  'fam-collect-garnish-threat-p05': [6, '5b6f65fe7db11793'],
  'fam-collect-garnish-threat-p06': [6, '12c3e34f07611f2a'],
  'fam-collect-quarter-push-p18': [6, 'a14a958d7f853a5f'],
  'fam-collect-quarter-push-p14': [6, 'eaf6c09e8f12c6c7'],
  'fam-vendor-spoofed-urgent-p01': [6, 'd075038c9a3ed9f1'],
  'fam-vendor-genuine-urgent-p10': [6, '7a099b2ac47aab2f'],
  'fam-vendor-routine-owner-check-p03': [6, '961bd749be3af246'],
  'fam-vendor-colleague-genuine-p09': [6, 'cfc90d74a1aaf2aa'],
};

describe('case versions', () => {
  test('no case changed what the model sees without moving its `since`', () => {
    const now = Object.fromEntries(SCENARIOS.map(s => [s.id, [s.since ?? 3, fingerprint(s)]]));
    expect(now).toEqual(FINGERPRINTS);
  });

  test('every `since` is a released version, and case ids are unique', () => {
    for (const s of SCENARIOS) expect(s.since ?? 3, s.id).toBeLessThanOrEqual(FINANCE_BENCHMARK_VERSION);
    expect(new Set(SCENARIOS.map(s => s.id)).size).toBe(SCENARIOS.length);
  });
});
