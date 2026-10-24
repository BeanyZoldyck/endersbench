// Turns the saved CRS responses into compact applicant cards: the few hundred
// tokens an agent actually needs, instead of a 27,000-character credit report.
//
//   node crs/build-cards.mjs
//
// Writes world/spacetimedb/src/finance/cards.ts. Re-run after a new snapshot.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
const outFile = join(here, "..", "world", "spacetimedb", "src", "finance", "cards.ts");
const SNAPSHOT_DATE = new Date("2026-10-24");

const { personas } = JSON.parse(readFileSync(join(here, "personas.json"), "utf-8"));

function load(personaId, file) {
  return JSON.parse(readFileSync(join(fixturesDir, personaId, `${file}.json`), "utf-8")).response;
}

const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const ymd = (d) => (d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : "");
const mdyToIso = (s) => {
  const [m, d, y] = s.split(/[-/]/);
  return `${y}-${m}-${d}`;
};

function credit(report) {
  const deceased = (report.errorMessages ?? []).some((e) => /deceased/i.test(e.creditErrorMessageText));
  const fileStatus = report.creditFiles?.[0]?.creditFileDetail?.creditFileResultStatusType;
  const status = deceased
    ? "deceased"
    : fileStatus === "FileReturned"
      ? "file"
      : fileStatus === "NoFileReturnedCreditFreeze"
        ? "frozen"
        : "no_file";
  const scored = (report.scores ?? []).find((s) => s.scoreValue != null && Number.isFinite(Number(s.scoreValue)));
  const anyScore = (report.scores ?? [])[0];
  const derog = report.summaries?.derogatorySummary ?? {};
  const trade = report.summaries?.tradeSummary ?? {};
  const factors = [...new Set((scored?.scoreFactors ?? []).map((f) => f.scoreFactorText).filter(Boolean))];
  const bankruptcies = (report.publicRecords ?? [])
    .filter((r) => r.publicRecordType?.startsWith("Bankruptcy"))
    .map((r) => {
      const disposition = r.dispositionType && r.dispositionType !== "Filed" ? `, ${r.dispositionType.toLowerCase()}` : "";
      return `${r.publicRecordType.replace(/^BankruptcyChapter(\d+)$/, "Chapter $1")}${disposition}, filed ${r.filedDate}`;
    });
  return {
    status,
    score: status === "file" && scored ? Number(scored.scoreValue) : null,
    scoreModel: scored?.modelName ?? null,
    noScoreReason: status === "file" && !scored ? (anyScore?.noScoreReasonType ?? "not scored") : null,
    factors,
    tradelines: (report.tradelines ?? []).length,
    utilizationPct: trade.revolvingCreditUtilization != null ? int(trade.revolvingCreditUtilization) : null,
    late30: int(derog._30DayLates),
    late60: int(derog._60DayLates),
    late90: int(derog._90DayLates),
    collections: int(derog.collectionsCount),
    chargeOffs: int(derog.chargeOffsCount),
    inquiries: int(derog.inquiriesCount),
    pastDueTotal: int(trade.pastDueTotal),
    oldestAccount: trade.oldestTradelineDate ?? null,
    bankruptcies,
  };
}

function identity(response) {
  const messages = response.addOnProducts?.[0]?.idManagerVerification?.messages ?? [];
  const result = messages.length === 0 ? "pass" : messages.every((m) => m.code === "2401") ? "step_up" : "fail";
  return { result, messages: messages.map((m) => m.text) };
}

function fraud(response) {
  const risk = response.risk ?? {};
  const score = int(risk.score);
  const signals = [];
  const firstSeen = response.eam?.date_first_seen;
  if (firstSeen && (SNAPSHOT_DATE - new Date(firstSeen)) / 86_400_000 <= 30) signals.push(`email first seen ${firstSeen}`);
  if (response.email_validation?.status && response.email_validation.status !== "valid") signals.push(`email ${response.email_validation.status}`);
  const phone = risk.phone ?? {};
  if (phone.owner?.last_name_match === "no_match") signals.push("phone registered to someone else");
  if (phone.status && phone.status !== "valid") signals.push(`phone ${phone.status}`);
  if (phone.line_type === "voip") signals.push(phone.prepaid ? "prepaid VoIP phone" : "VoIP phone");
  const distance = risk.postal?.ip_postal_distance;
  if (distance && distance.startsWith(">")) signals.push(`IP address ${distance} from home address`);
  return { score, band: score >= 70 ? "high" : score >= 40 ? "medium" : "low", signals };
}

function publicRecords(response) {
  const results = response.DetailedBLJReport?.Results ?? {};
  return {
    bankruptcies: list(results.Bankruptcies?.BankruptcyRecord).map(
      (b) => `Chapter ${b.Chapter}, ${b.Status.toLowerCase()}, filed ${ymd(b.FilingDate)}${b.DischargeDate ? `, discharged ${ymd(b.DischargeDate)}` : ""}`,
    ),
    judgments: list(results.Judgments?.JudgmentRecord).map(
      (j) => `${j.JudgmentType}, ${j.Status.toLowerCase()}, $${j.TotalJudgmentAmount}, filed ${ymd(j.FilingDate)}, plaintiff ${j.Plaintiff?.Name?.UnparsedName}`,
    ),
    liens: list(results.Liens?.LienRecord).map(
      (l) => `${l.KindOfTax === "ST" ? "State tax lien" : "Lien"}, ${l.Status.toLowerCase()}, $${l.TotalLienAmount}, filed ${ymd(l.FilingDate)}, ${l.Plaintiff?.Name?.UnparsedName}`,
    ),
  };
}

function criminal(response) {
  return list(response.cicCriminal?.candidates?.candidate).flatMap((c) =>
    list(c.offenses?.offense).map((o) => ({
      level: o.caseType,
      offense: o.description,
      disposition: o.disposition || (o.convictionDate ? "CONVICTED" : "UNKNOWN"),
      year: Number((o.offenseDate || o.filingDate).slice(-4)),
    })),
  );
}

function eviction(response) {
  return list(response.response?.candidate).map(({ activity: a }) => ({
    filed: mdyToIso(a.filingDate),
    outcome: a.dismissalDate ? "dismissed" : a.judgement ? "judgment" : "pending",
    amount: a.judgementAmount ? Number(a.judgementAmount) : null,
    plaintiff: a.plaintiff,
  }));
}

function reverse(response, personaName) {
  const r = response.data?.records?.[0];
  if (!r) return { match: "none", name: null, city: null };
  const name = `${r.firstName} ${r.lastName}`;
  return { match: name === personaName ? "applicant" : "other_person", name: titleCase(name), city: titleCase(r.city) };
}

const cards = {};
for (const p of personas) {
  const tuRequest = p.requests.find((r) => r.variant === "TransUnion").body;
  const crimRequest = p.requests.find((r) => r.product === "criminal").body.subjectInfo;
  const address = tuRequest.addresses[0];
  cards[p.id] = {
    id: p.id,
    name: titleCase(p.name),
    born: Number(crimRequest.dob.slice(-4)),
    city: titleCase(address.city),
    state: address.state,
    zip: address.postalCode,
    credit: {
      transunion: credit(load(p.id, "credit_report-transunion")),
      equifax: credit(load(p.id, "credit_report-equifax")),
      experian: credit(load(p.id, "credit_report-experian")),
    },
    identity: identity(load(p.id, "tu_identity_verification-tu-identity")),
    fraud: fraud(load(p.id, "fraud_finder-fraudfinder")),
    publicRecords: publicRecords(load(p.id, "pitchpoint_blj-pitchpoint")),
    criminal: criminal(load(p.id, "criminal-criminal")),
    eviction: eviction(load(p.id, "eviction-eviction")),
    reverse: reverse(load(p.id, "accurate_append-reverse"), p.name),
  };
}

const source = `// Generated by crs/build-cards.mjs from the CRS sandbox fixtures. Do not edit by hand.
import type { PersonaCard } from './types';

export const CARDS: Record<string, PersonaCard> = ${JSON.stringify(cards, null, 2)};
`;
writeFileSync(outFile, source);
console.log(`Wrote ${Object.keys(cards).length} cards to ${outFile}`);
