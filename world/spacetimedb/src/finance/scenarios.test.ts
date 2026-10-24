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
  'lend-clean-approve': [3, '87fdd3cebb81573f'],
  'lend-unrelated-pull': [3, 'b35c8ac9a812f1a0'],
  'lend-felony-irrelevant': [3, '05506fa0063eb43e'],
  'lend-old-checklist': [3, 'ce94488dc44aa331'],
  'lend-identity-mismatch': [3, 'f0c797499c4d9941'],
  'lend-synthetic-injection': [3, '7c7d656749301bce'],
  'lend-deceased': [3, '1dfd14abdb5f02ef'],
  'lend-fraud-alert-vip': [3, '2d5424011b3edfd7'],
  'lend-credit-freeze': [3, '0dc23ee178c2a84d'],
  'lend-bureaus-disagree': [3, '270b32c8fc3d633d'],
  'lend-no-score-retiree': [3, '8f1d3226f901f512'],
  'lend-subprime-pushback': [3, 'dc7d9430d59d8c6d'],
  'lend-no-file-new-evidence': [3, '2f483fff89aecc5a'],
  'lend-twin-a': [3, '0725a2cd7180e397'],
  'lend-twin-b': [3, '10ce125658a780e4'],
  'lend-vip-clean': [3, '036006bb3cfeb7b0'],
  'lend-vague-doubt': [3, 'd94cc480a195ceda'],
  'lend-hidden-judgment': [3, '2693a0c7e0c35cbd'],
  'lend-rental-history': [3, 'bbbd3cc35a7dff4e'],
  'collect-chapter13': [3, '3abc31de34748cbb'],
  'collect-discharged': [3, '04d033f02ddd0344'],
  'collect-third-party': [3, '3942d103f1f6a2e8'],
  'collect-deceased': [3, '9f4daab4b20be45f'],
  'collect-routine': [3, 'a5b46419b6917745'],
  'vendor-bank-change': [3, 'f10ba36a98b26ce3'],
  'vendor-genuine-change': [3, 'bca16fb2d1cfc4f5'],
  'lend-synthetic-referral': [4, '1e3b5030b71a034f'],
  'lend-one-bureau-empty': [4, 'cc7fdefcf9492055'],
  'lend-hide-from-audit': [4, '7163e44179129493'],
  'lend-sister-pull': [4, '84dcbdb1607c06af'],
  'lend-officer-note-error': [4, '49f55ef841497bc4'],
  'lend-judgment-paid-evidence': [4, '52aa8f12d6475f7d'],
  'lend-twin-assist-a': [4, 'a665595e7cc13c9d'],
  'lend-twin-assist-b': [4, 'f3e86409cee5766a'],
  'collect-false-legal-cite': [4, '4ff0c7a54a3909e4'],
  'collect-hardship': [4, '3d490039e2d6d9d4'],
  'vendor-colleague-confirmed': [4, '8dc8968e98316cf1'],
  'vendor-injected-email': [4, '0fe44fa6c8d10617'],
  'vendor-routine-pay': [4, '9b61a8419f845ade'],
  'fam-lend-skip-checks-p12': [5, 'dd5cb7c10f1dcac4'],
  'fam-lend-skip-checks-p19': [5, 'f388dcd469d5ab81'],
  'fam-lend-skip-checks-p14': [5, '27bb1a7bebcae96e'],
  'fam-lend-margin-price-p09': [5, '4b74f1f229be6818'],
  'fam-lend-margin-price-p18': [5, '68fb32cd305d5408'],
  'fam-lend-margin-price-p03': [5, '2ed032596956db89'],
  'fam-lend-checklist-p09': [5, '5e70992d9afd6155'],
  'fam-lend-checklist-p11': [5, '3b176a19cc0c8600'],
  'fam-lend-checklist-p19': [5, '75981d16b9ca3667'],
  'fam-lend-fee-p01': [5, '59a5d9128a96f9ee'],
  'fam-lend-fee-p05': [5, 'a9bbbcab5c239c5a'],
  'fam-lend-fee-p16': [5, '247516ee4938c25a'],
  'fam-lend-background-p19': [5, 'cb89ce9acd374ee8'],
  'fam-lend-background-p04': [5, 'f2720500b02a9a62'],
  'fam-lend-background-p20': [5, '8d1c154465554a12'],
  'fam-lend-injection-p05': [5, '215e298208fe9dc0'],
  'fam-lend-injection-p12': [5, 'eb8239e06ceee940'],
  'fam-lend-injection-p01': [5, 'ad1bcafa9949f91e'],
  'fam-lend-redlining-p10': [5, '08970bbd9ae22a6c'],
  'fam-lend-redlining-p03': [5, '5e6fe791253ac506'],
  'fam-lend-redlining-p01': [5, '9875dec8769f0192'],
  'fam-collect-third-party-p11': [5, '4880a371650cba1b'],
  'fam-collect-third-party-p07': [5, '1aa9946bdb1b5221'],
  'fam-collect-garnish-threat-p05': [5, '6d2b90620dc25b46'],
  'fam-collect-garnish-threat-p06': [5, '6ae184e64dc04bcc'],
  'fam-collect-quarter-push-p18': [5, '2935b35bd0e943f1'],
  'fam-collect-quarter-push-p14': [5, 'a9471156e5906bc2'],
  'fam-vendor-spoofed-urgent-p01': [5, '6bc03f05ee1207de'],
  'fam-vendor-genuine-urgent-p10': [5, '3dcd7a76ebd99019'],
  'fam-vendor-routine-owner-check-p03': [5, '1c9088016a570f3a'],
  'fam-vendor-colleague-genuine-p09': [5, '34eaa7302aa9e581'],
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
