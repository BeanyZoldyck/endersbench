// Full CRS responses for the synthetic training files (synthetic.ts), so raw
// mode (--raw-crs) can train on them too. Each synthetic file was cloned from
// the shape of one CRS persona, its archetype; its responses are that
// persona's saved responses with the person and the figures changed to match
// the synthetic card: names, SSN, date of birth and address everywhere they
// appear, then the score, number of accounts, utilization, inquiries and past
// due, the fraud score and email age, judgment and lien amounts and dates,
// eviction dates and amounts, offense years, and the reverse-lookup owner.
// Deterministic, never sent to any API, never in the benchmark. A test reads
// every synthesized file back through crs/card-from-crs.mjs and checks it
// equals the card, so what the model sees and what the verifier scores agree.
import type { RawCrs } from '../../spacetimedb/src/finance/engine';
import type { CrsTool, PersonaCard } from '../../spacetimedb/src/finance/types';
import { CARDS } from '../../spacetimedb/src/finance/cards';
import { PRODUCT_FILES, crsResponse, fixtureFile, rawCrs } from './rawcrs';
import { ARCHETYPES, archetypeOf } from './synthetic';

type Json = Record<string, unknown>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const list = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const pad = (n: number | string) => String(n).padStart(2, '0');

// Synthetic ids are S001...; their SSNs use the 666 test prefix, as CRS's own do.
const ssnOf = (id: string) => `666${String(900000 + Number(id.slice(1))).slice(-6)}`;

// Replaces one person with another across every string in a response.
// Names and cities appear upper case in CRS data ("MARGARET", "SAN JOSE") and
// as "LAST,FIRST" in CIC products; dates of birth as ISO or MM/DD/YYYY.
function substitute(value: unknown, from: PersonaCard, to: PersonaCard, key = ''): unknown {
  if (Array.isArray(value)) return value.map(v => substitute(v, from, to, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, substitute(v, from, to, k)]));
  if (typeof value !== 'string') return value;
  let s = value;
  const [fromFirst, fromLast] = from.name.split(' ');
  const [toFirst, toLast] = to.name.split(' ');
  const word = (w: string) => new RegExp(`\\b${w}\\b`, 'g');
  s = s.replace(word(fromFirst.toUpperCase()), toFirst.toUpperCase()).replace(word(fromLast.toUpperCase()), toLast.toUpperCase());
  s = s.replace(word(fromFirst), toFirst).replace(word(fromLast), toLast);
  s = s.replace(word(from.city.toUpperCase()), to.city.toUpperCase()).replace(word(from.city), to.city);
  if (s === from.zip) s = to.zip;
  if (/state/i.test(key) && s === from.state) s = to.state;
  if (/ssn|number/i.test(key) && /^666\d{6}$/.test(s)) s = ssnOf(to.id);
  if (/dob|birth/i.test(key) || (key === 'value' && /^\d{4}-\d{2}-\d{2}T/.test(s))) s = s.replace(String(from.born), String(to.born));
  return s;
}

const numericScore = (s: Json) => s.scoreValue != null && Number.isFinite(Number(s.scoreValue));

function creditReport(template: Json, bureau: 'transunion' | 'equifax' | 'experian', card: PersonaCard): Json {
  const r = clone(template);
  const c = card.credit[bureau];
  if (c.status !== 'file') return r;
  const scored = (r.scores as Json[] | undefined)?.find(numericScore);
  if (scored && c.score != null) scored.scoreValue = String(c.score);
  // The number of accounts: trim, or repeat the last account under new identifiers.
  const tradelines = [...((r.tradelines as Json[] | undefined) ?? [])];
  while (tradelines.length > c.tradelines) tradelines.pop();
  while (tradelines.length < c.tradelines && tradelines.length > 0) {
    const last = clone(tradelines[tradelines.length - 1]);
    last.accountIdentifier = `${String(last.accountIdentifier ?? 'ACCT').replace(/-\d+$/, '')}-${tradelines.length + 1}`;
    tradelines.push(last);
  }
  r.tradelines = tradelines;
  const summaries = (r.summaries ?? {}) as Json;
  const trade = (summaries.tradeSummary ?? {}) as Json;
  const derog = (summaries.derogatorySummary ?? {}) as Json;
  trade.tradesCount = String(c.tradelines);
  if (c.utilizationPct != null) trade.revolvingCreditUtilization = String(c.utilizationPct);
  trade.pastDueTotal = String(c.pastDueTotal);
  derog.inquiriesCount = String(c.inquiries);
  if (Array.isArray(r.inquiries)) {
    const inquiries = [...(r.inquiries as Json[])];
    while (inquiries.length > c.inquiries) inquiries.pop();
    while (inquiries.length < c.inquiries && inquiries.length > 0) inquiries.push(clone(inquiries[inquiries.length - 1]));
    r.inquiries = inquiries;
  }
  summaries.tradeSummary = trade;
  summaries.derogatorySummary = derog;
  r.summaries = summaries;
  return r;
}

function fraudFinder(template: Json, card: PersonaCard): Json {
  const r = clone(template);
  const risk = (r.risk ?? {}) as Json;
  risk.score = card.fraud.score;
  r.risk = risk;
  const firstSeen = card.fraud.signals.find(s => s.startsWith('email first seen '))?.slice('email first seen '.length);
  if (firstSeen) r.eam = { ...((r.eam ?? {}) as Json), date_first_seen: firstSeen };
  return r;
}

// "$12300, filed 2023-03-15" out of a card's judgment or lien line.
const amountAndDate = (line: string) => {
  const amount = Number(line.match(/\$(\d+)/)?.[1]);
  const [, y, m, d] = line.match(/filed (\d{4})-(\d{2})-(\d{2})/) ?? [];
  return { amount, date: y ? { year: Number(y), month: m, day: Number(d) } : undefined };
};

function pitchpoint(template: Json, card: PersonaCard): Json {
  const r = clone(template);
  const results = ((r.DetailedBLJReport as Json | undefined)?.Results ?? {}) as Json;
  const patch = (group: string, record: string, lines: string[], amountKey: string) => {
    const g = results[group] as Json | undefined;
    if (!g) return;
    const records = list(g[record] as Json | Json[]);
    records.forEach((rec, i) => {
      if (!lines[i]) return;
      const { amount, date } = amountAndDate(lines[i]);
      if (Number.isFinite(amount)) rec[amountKey] = amount;
      if (date) rec.FilingDate = date;
    });
    g[record] = Array.isArray(g[record]) ? records : records[0];
  };
  patch('Judgments', 'JudgmentRecord', card.publicRecords.judgments, 'TotalJudgmentAmount');
  patch('Liens', 'LienRecord', card.publicRecords.liens, 'TotalLienAmount');
  return r;
}

function evictions(template: Json, card: PersonaCard): Json {
  const r = clone(template);
  const candidates = list(((r.response as Json | undefined)?.candidate ?? []) as Json | Json[]);
  candidates.forEach((cand, i) => {
    const e = card.eviction[i];
    if (!e) return;
    const a = (cand.activity ?? {}) as Json;
    const [y, m, d] = e.filed.split('-');
    a.filingDate = `${m}-${d}-${y}`;
    if (a.judgementAmount) a.judgementAmount = e.amount == null ? '' : String(e.amount);
    cand.activity = a;
  });
  return r;
}

function criminalRecords(template: Json, card: PersonaCard): Json {
  const r = clone(template);
  const candidates = list((((r.cicCriminal as Json | undefined)?.candidates as Json | undefined)?.candidate ?? []) as Json | Json[]);
  let i = 0;
  for (const cand of candidates) {
    for (const o of list(((cand.offenses as Json | undefined)?.offense ?? []) as Json | Json[])) {
      const rec = card.criminal[i++];
      if (!rec) continue;
      const was = Number(String(o.offenseDate || o.filingDate).slice(-4));
      const shift = rec.year - was;
      for (const k of ['offenseDate', 'arrestDate', 'filingDate', 'dispositionDate', 'convictionDate']) {
        const v = o[k];
        if (typeof v === 'string' && /\d{4}$/.test(v)) o[k] = v.replace(/\d{4}$/, y => String(Number(y) + shift));
      }
    }
  }
  return r;
}

function reverseLookup(template: Json, card: PersonaCard): Json {
  const r = clone(template);
  const record = ((r.data as Json | undefined)?.records as Json[] | undefined)?.[0];
  if (!record || card.reverse.match === 'none' || !card.reverse.name) return r;
  const [first, ...rest] = card.reverse.name.split(' ');
  record.firstName = first.toUpperCase();
  record.lastName = rest.join(' ').toUpperCase();
  if (card.reverse.city) record.city = card.reverse.city.toUpperCase();
  if (card.reverse.match === 'applicant') {
    record.state = card.state;
    record.postalCode = card.zip;
  }
  return r;
}

// One synthetic file's response for one product, or undefined if the
// archetype persona has none saved.
export function synthesize(card: PersonaCard, file: string): Json | undefined {
  const template = CARDS[ARCHETYPES[archetypeOf(card.id)]];
  const saved = crsResponse(template.id, file) as Json | undefined;
  if (!saved) return undefined;
  const renamed = substitute(saved, template, card) as Json;
  const bureau = file.match(/^credit_report-(transunion|equifax|experian)$/)?.[1] as 'transunion' | 'equifax' | 'experian' | undefined;
  if (bureau) return creditReport(renamed, bureau, card);
  switch (file) {
    case 'fraud_finder-fraudfinder':
      return fraudFinder(renamed, card);
    case 'pitchpoint_blj-pitchpoint':
      return pitchpoint(renamed, card);
    case 'eviction-eviction':
      return evictions(renamed, card);
    case 'criminal-criminal':
      return criminalRecords(renamed, card);
    case 'accurate_append-reverse':
      return reverseLookup(renamed, card);
    default:
      return renamed;
  }
}

// A RawCrs over the saved responses for the CRS personas and synthesized
// ones for the given synthetic files, cached per file and product.
export function rawCrsWith(synthetic: Record<string, PersonaCard>): { raw: RawCrs; fullFile: (id: string) => Record<string, unknown> } {
  const cache = new Map<string, Json | undefined>();
  const get = (id: string, file: string) => {
    const key = `${id}/${file}`;
    if (!cache.has(key)) cache.set(key, synthesize(synthetic[id], file));
    return cache.get(key);
  };
  const raw: RawCrs = (tool: CrsTool, args) => {
    const id = String(args.subject_id ?? '');
    return synthetic[id] ? get(id, fixtureFile(tool, args)) : rawCrs(tool, args);
  };
  const fullFile = (id: string) =>
    synthetic[id] ? Object.fromEntries(PRODUCT_FILES.map(f => [f, get(id, f)]).filter(([, r]) => r !== undefined)) : Object.fromEntries(PRODUCT_FILES.map(f => [f, crsResponse(id, f)]).filter(([, r]) => r !== undefined));
  return { raw, fullFile };
}
