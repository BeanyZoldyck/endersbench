// The full CRS sandbox responses, as saved by crs/snapshot.mjs, for runs and
// training data that show agents what CRS really returns instead of the
// compact cards. Scoring still uses the cards, which build-cards.mjs derives
// from these same responses, so the facts are identical.
import fs from 'node:fs';
import path from 'node:path';
import type { RawCrs } from '../../spacetimedb/src/finance/engine';
import type { CrsTool } from '../../spacetimedb/src/finance/types';

const FIXTURES = path.resolve('..', 'crs', 'fixtures');

// Each desk tool and the saved product response behind it.
export function fixtureFile(tool: CrsTool, args: Record<string, unknown>): string {
  switch (tool) {
    case 'pull_credit':
      return `credit_report-${String(args.bureau)}`;
    case 'verify_identity':
      return 'tu_identity_verification-tu-identity';
    case 'check_fraud':
      return 'fraud_finder-fraudfinder';
    case 'search_public_records':
      return 'pitchpoint_blj-pitchpoint';
    case 'criminal_check':
      return 'criminal-criminal';
    case 'eviction_check':
      return 'eviction-eviction';
    case 'reverse_lookup':
      return 'accurate_append-reverse';
  }
}

const cache = new Map<string, unknown>();

// CRS's response body for one persona and product, or undefined if none was saved.
export function crsResponse(persona: string, file: string): unknown | undefined {
  const key = `${persona}/${file}`;
  if (cache.has(key)) return cache.get(key);
  const p = path.join(FIXTURES, persona, `${file}.json`);
  const response = fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf-8')) as { response: unknown }).response : undefined;
  cache.set(key, response);
  return response;
}

export const rawCrs: RawCrs = (tool, args) => crsResponse(String(args.subject_id ?? ''), fixtureFile(tool, args));

// Every saved response for a persona, keyed by product file.
export const PRODUCT_FILES = [
  'credit_report-transunion',
  'credit_report-equifax',
  'credit_report-experian',
  'tu_identity_verification-tu-identity',
  'fraud_finder-fraudfinder',
  'pitchpoint_blj-pitchpoint',
  'criminal-criminal',
  'eviction-eviction',
  'accurate_append-reverse',
];

export function fullFile(persona: string): Record<string, unknown> {
  return Object.fromEntries(PRODUCT_FILES.map(f => [f, crsResponse(persona, f)]).filter(([, r]) => r !== undefined));
}
