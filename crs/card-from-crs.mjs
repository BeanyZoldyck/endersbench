// Reads a compact applicant card out of the CRS product responses: the few
// hundred tokens an agent actually needs, instead of a 27,000-character
// credit report. build-cards.mjs uses it on the saved fixtures; the synthetic
// raw responses for training (world/harness/finance/synthetic-raw.ts) are
// checked against it, so a synthesized response reads back to its card.

export const SNAPSHOT_DATE = new Date("2026-10-24");

export const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
export const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
export const ymd = (d) => (d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : "");
export const mdyToIso = (s) => {
  const [m, d, y] = s.split(/[-/]/);
  return `${y}-${m}-${d}`;
};

export function credit(report) {
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

export function identity(response) {
  const messages = response.addOnProducts?.[0]?.idManagerVerification?.messages ?? [];
  const result = messages.length === 0 ? "pass" : messages.every((m) => m.code === "2401") ? "step_up" : "fail";
  return { result, messages: messages.map((m) => m.text) };
}

export function fraud(response) {
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

export function publicRecords(response) {
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

export function criminal(response) {
  return list(response.cicCriminal?.candidates?.candidate).flatMap((c) =>
    list(c.offenses?.offense).map((o) => ({
      level: o.caseType,
      offense: o.description,
      disposition: o.disposition || (o.convictionDate ? "CONVICTED" : "UNKNOWN"),
      year: Number((o.offenseDate || o.filingDate).slice(-4)),
    })),
  );
}

export function eviction(response) {
  return list(response.response?.candidate).map(({ activity: a }) => ({
    filed: mdyToIso(a.filingDate),
    outcome: a.dismissalDate ? "dismissed" : a.judgement ? "judgment" : "pending",
    amount: a.judgementAmount ? Number(a.judgementAmount) : null,
    plaintiff: a.plaintiff,
  }));
}

export function reverse(response, personaName) {
  const r = response.data?.records?.[0];
  if (!r) return { match: "none", name: null, city: null };
  const name = `${r.firstName} ${r.lastName}`;
  return { match: name === personaName ? "applicant" : "other_person", name: titleCase(name), city: titleCase(r.city) };
}

// The whole card from one person's nine product responses. `load(file)`
// returns the response body for a product file name (see
// world/harness/finance/rawcrs.ts PRODUCT_FILES); `personaName` is the name
// as CRS holds it, upper case.
export function cardFromResponses({ id, personaName, born, city, state, zip }, load) {
  return {
    id,
    name: titleCase(personaName),
    born,
    city: titleCase(city),
    state,
    zip,
    credit: {
      transunion: credit(load("credit_report-transunion")),
      equifax: credit(load("credit_report-equifax")),
      experian: credit(load("credit_report-experian")),
    },
    identity: identity(load("tu_identity_verification-tu-identity")),
    fraud: fraud(load("fraud_finder-fraudfinder")),
    publicRecords: publicRecords(load("pitchpoint_blj-pitchpoint")),
    criminal: criminal(load("criminal-criminal")),
    eviction: eviction(load("eviction-eviction")),
    reverse: reverse(load("accurate_append-reverse"), personaName),
  };
}
