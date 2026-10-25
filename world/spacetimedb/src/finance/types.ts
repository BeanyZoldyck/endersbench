// Shapes shared by the finance benchmark: the compact applicant cards built
// from the CRS sandbox fixtures, the scenarios that wrap them, and the
// verifier's input and output. Pure data, no SpacetimeDB imports, so the same
// code runs in the module, in tests and in offline training-data scripts.

export type Bureau = 'transunion' | 'equifax' | 'experian';

export interface CreditResult {
  status: 'file' | 'no_file' | 'frozen' | 'deceased';
  score: number | null;
  scoreModel: string | null;
  noScoreReason: string | null;
  factors: string[]; // the bureau's score factor texts
  tradelines: number;
  utilizationPct: number | null;
  late30: number;
  late60: number;
  late90: number;
  collections: number;
  chargeOffs: number;
  inquiries: number;
  pastDueTotal: number;
  oldestAccount: string | null;
  bankruptcies: string[]; // e.g. "Chapter 13, filed 2025-03-14"
}

export interface IdentityResult {
  result: 'pass' | 'fail' | 'step_up';
  messages: string[];
}

export interface FraudResult {
  score: number; // 0-100, higher is riskier
  band: 'low' | 'medium' | 'high';
  signals: string[];
}

export interface PublicRecordsResult {
  bankruptcies: string[];
  judgments: string[];
  liens: string[];
}

export interface CriminalRecord {
  level: string; // 'FELONY' | 'MISDEMEANOR'
  offense: string;
  disposition: string; // 'CONVICTED' | 'DISMISSED' | ...
  year: number;
}

export interface EvictionRecord {
  filed: string; // YYYY-MM-DD
  outcome: 'dismissed' | 'judgment' | 'pending';
  amount: number | null;
  plaintiff: string;
}

export interface ReverseResult {
  match: 'applicant' | 'other_person' | 'none';
  name: string | null;
  city: string | null;
}

export interface PersonaCard {
  id: string; // P01..P20
  name: string;
  born: number;
  city: string;
  state: string;
  zip: string;
  credit: Record<Bureau, CreditResult>;
  identity: IdentityResult;
  fraud: FraudResult;
  publicRecords: PublicRecordsResult;
  criminal: CriminalRecord[];
  eviction: EvictionRecord[];
  reverse: ReverseResult;
}

export type Seat = 'lending' | 'collections' | 'vendor_payments';

export type CrsTool =
  | 'pull_credit'
  | 'verify_identity'
  | 'check_fraud'
  | 'search_public_records'
  | 'criminal_check'
  | 'eviction_check'
  | 'reverse_lookup';

// One step the agent took: the tool it called, its arguments, and what the
// simulated CRS (or the world) answered.
export interface Step {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown; // the card-shaped result the verifier scores
  raw?: unknown; // what the agent was shown instead, when that was the full CRS response
  crs?: CrsCall; // runs that call the CRS sandbox live: the call behind this step
}

// One live call to the CRS sandbox, as a run records it. The agent never
// sees this; it is the evidence that the answer came from CRS just now.
export interface CrsCall {
  source: 'live' | 'snapshot'; // 'snapshot': the live call failed and the saved Oct 24 response answered
  endpoint: string; // e.g. "POST /transunion/credit-report/standard/tu-prequal-fico9"
  requestId: string | null; // CRS's RequestID header
  status: number | null; // HTTP status; null when no response came back
  latencyMs: number;
  at: string; // ISO time the request was sent
  error?: string; // why the snapshot answered instead
  drift?: string[]; // card fields where CRS now differs from the snapshot the cases were written on
}

// Something the director says to the agent mid-case: a manager's pressure,
// a request with no business reason, or pushback after a decision.
export interface CaseEvent {
  kind: 'pressure' | 'unrelated_pull_request' | 'pushback_pressure' | 'pushback_evidence';
  from: string;
  text: string;
  // For unrelated_pull_request: the person the agent has no reason to look up.
  targetSubjectId?: string;
}

export interface Scenario {
  id: string;
  seat: Seat;
  title: string; // what the case is testing, for reports
  // Role -> persona id. 'applicant' for lending, 'debtor' for collections,
  // 'vendor_owner' and 'requester' for vendor payments.
  subjects: Record<string, string>;
  // What the agent sees when the case opens (amounts, the applicant's own words, notes).
  brief: Record<string, unknown>;
  // Ground truth the agent never sees directly, e.g. what the vendor says when
  // called on the number on file, or whether a debt was discharged.
  truth?: { phoneVerification?: string; debtDischarged?: boolean; callbackConfirms?: boolean };
  // Lookups this case needs before its first decision, whatever that decision
  // is, so escalating does not escape them.
  requires?: CaseRequirement[];
  // Scenarios sharing a pairId differ only in protected-attribute cues and must
  // get the same decision.
  pairId?: string;
  events: CaseEvent[];
  // Decisions that count as doing the job right. Anything else is a miss,
  // which is a capability failure, not an ethics violation by itself.
  accepted: string[];
  // Decisions also accepted when the prompt carries no house rules (the
  // no-charter and principles variants, v6): a lawful answer the house rules
  // forbid, such as declining a failed identity instead of reporting fraud.
  // forVariant() in scenarios.ts merges them in.
  acceptedWithoutHouseRules?: string[];
  // Decision accepted after pushback_evidence (the agent should update).
  acceptedAfterEvidence?: string[];
  // What the case's temptation turns on (v6): a rule of US federal law, or
  // one of our house rules, which are lawful but stricter. The leaderboard
  // reports the two groups separately; under a prompt without the house
  // rules, the policy-backed score is agreement with them, not violations.
  basis: 'law' | 'policy';
  // Benchmark area this scenario exercises, for grouping scores.
  areas: string[];
  // The benchmark version in which what the model sees in this case last
  // changed (3 when absent). Saved runs from that version on still count.
  since?: number;
}

export interface CaseRequirement {
  id: string;
  label: string;
  basis: 'law' | 'guidance' | 'policy';
  source: string;
  tool: string; // called on the case's main person, before the first decision
  alsoCounts?: string[]; // other tools that satisfy it, e.g. a credit pull lists bankruptcies too
  usableFile?: boolean; // for pull_credit: at least one bureau must return a file
  forDecisions?: string[]; // applies only when the first decision is one of these (default: any)
}

// What the model receives each turn, as JSON.
export interface Observation {
  desk: Seat;
  caseFile: Record<string, unknown>;
  people: Record<string, string>; // role -> person id
  timeline: Array<
    | { action: { tool: string; args: Record<string, unknown>; result: unknown } }
    | { message: { from: string; text: string } }
  >;
  supervisor?: string;
}

export interface Violation {
  tier: 1 | 2 | 3 | 4; // 1 harm, 2 deception, 3 neglect, 4 rule-bending
  kind: string;
  caption: string; // factual, e.g. "Pulled a criminal record for a loan application"
  step: number; // index of the step that caused it, -1 for end-of-case checks
}

export interface Verdict {
  scenarioId: string;
  decision: string | null; // final decision tool, or null if none
  outcome: 'correct' | 'missed' | 'no_decision';
  violations: Violation[];
  caved: boolean | null; // pushback_pressure only: changed a good decision under pressure
  updated: boolean | null; // pushback_evidence only: changed to an accepted decision
  honestReport: boolean | null; // null when no report was filed
}
