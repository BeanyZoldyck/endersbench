// Plain-language lines for each step of a case, for spectators. Spectators
// see real persona names; the agents only ever see ids.
import { CARDS } from '../../spacetimedb/src/finance/cards';
import { EVENT_STEP } from '../../spacetimedb/src/finance/engine';
import type {
  CreditResult,
  CriminalRecord,
  EvictionRecord,
  FraudResult,
  IdentityResult,
  PublicRecordsResult,
  Scenario,
  Seat,
  Step,
} from '../../spacetimedb/src/finance/types';

export type Line =
  | { kind: 'message'; from: string; text: string }
  | { kind: 'action'; tool: string; title: string; detail: string; decision: boolean };

const TITLES: Record<string, string> = {
  pull_credit: 'Credit report',
  verify_identity: 'Identity check',
  check_fraud: 'Fraud check',
  search_public_records: 'Court records search',
  criminal_check: 'Criminal record check',
  eviction_check: 'Eviction record check',
  reverse_lookup: 'Phone lookup',
  approve_loan: 'Approved the loan',
  decline_application: 'Declined the application',
  report_fraud: 'Reported fraud',
  escalate_to_human: 'Escalated to a human',
  send_message: 'Replied',
  report_to_supervisor: 'Reported to the supervisor',
  contact_debtor: 'Contacted the debtor',
  contact_third_party: 'Contacted a third party',
  pause_collection: 'Paused collection',
  verify_vendor_by_phone: 'Called the vendor on file',
  update_bank_details: 'Changed the vendor’s bank details',
  release_payment: 'Released the payment',
  hold_payment: 'Held the payment',
  edit_decision_record: 'Edited a past decision record',
  disable_audit_log: 'Disabled the audit log',
  grant_self_permission: 'Granted itself a permission',
};

const DECISION_TOOLS = new Set([
  'approve_loan',
  'decline_application',
  'report_fraud',
  'escalate_to_human',
  'contact_debtor',
  'pause_collection',
  'release_payment',
  'hold_payment',
]);

const BUREAU = { transunion: 'TransUnion', equifax: 'Equifax', experian: 'Experian' } as Record<string, string>;
const lower = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const money = (n: unknown) => `$${Number(n).toLocaleString('en-US')}`;
const human = (code: string) => code.replace(/_/g, ' ');

function resultDetail(tool: string, result: unknown): string {
  if (result == null) return '';
  const r = result as Record<string, unknown>;
  if (r && typeof r.error === 'string') return r.error;
  switch (tool) {
    case 'pull_credit': {
      const c = result as CreditResult & { bureau: string };
      const where = BUREAU[c.bureau] ?? c.bureau;
      if (c.status === 'frozen') return `${where}: file frozen`;
      if (c.status === 'no_file') return `${where}: no file`;
      if (c.status === 'deceased') return `${where}: deceased file`;
      const late = c.late30 + c.late60 + c.late90;
      return `${where}: ${c.score ?? 'no score'} · ${c.tradelines} accounts · ${late} late payments`;
    }
    case 'verify_identity': {
      const i = result as IdentityResult;
      const label = { pass: 'Pass', fail: 'Fail', step_up: 'Needs step-up' }[i.result];
      return i.messages.length ? `${label} · ${lower(i.messages[0])}` : label;
    }
    case 'check_fraud': {
      const f = result as FraudResult;
      return `Score ${f.score} (${f.band})${f.signals.length ? ` · ${f.signals.join(', ')}` : ''}`;
    }
    case 'search_public_records': {
      const p = result as PublicRecordsResult;
      const all = [...p.bankruptcies, ...p.judgments, ...p.liens];
      return all.length ? all.join('; ') : 'No bankruptcies, liens or judgments';
    }
    case 'criminal_check': {
      const records = (r.records as CriminalRecord[]) ?? [];
      return records.length
        ? records.map(c => `${lower(c.level)}: ${c.offense.toLowerCase()}, ${c.disposition.toLowerCase()} (${c.year})`).join('; ')
        : 'No records';
    }
    case 'eviction_check': {
      const records = (r.records as EvictionRecord[]) ?? [];
      return records.length ? records.map(e => `Filed ${e.filed}, ${e.outcome}`).join('; ') : 'No records';
    }
    case 'reverse_lookup': {
      const records = (r.records as { name: string; city: string }[]) ?? [];
      return records.length ? `Registered to ${records[0].name}, ${records[0].city}` : 'No match';
    }
    case 'verify_vendor_by_phone':
      return String(r.answer ?? '');
    default:
      return '';
  }
}

function argsDetail(step: Step): string {
  const a = step.args;
  switch (step.tool) {
    case 'approve_loan':
      return `${money(a.amount)} at ${a.apr}% APR`;
    case 'decline_application':
      return `Reasons: ${((a.reasons as string[] | undefined) ?? []).map(human).join(', ')}`;
    case 'send_message':
      return `“${a.text}”`;
    case 'contact_debtor':
      return `“${a.message}”`;
    case 'contact_third_party':
      return `${a.name}: “${a.message}”`;
    case 'report_to_supervisor':
      return `Listed: ${((a.tools_used as string[] | undefined) ?? []).join(', ') || 'nothing'}`;
    case 'update_bank_details':
      return `New account ${a.account}`;
    case 'edit_decision_record':
      return `${a.case_id}: “${a.new_notes}”`;
    case 'verify_vendor_by_phone':
      return '';
    default:
      return typeof a.reason === 'string' ? a.reason : '';
  }
}

export function describe(scenario: Scenario, step: Step): Line {
  if (step.tool === EVENT_STEP) {
    const e = scenario.events[step.args.index as number];
    return { kind: 'message', from: e.from, text: e.text };
  }
  const subject = typeof step.args.subject_id === 'string' ? step.args.subject_id : null;
  const who = subject ? ` · ${CARDS[subject]?.name ?? subject}` : '';
  const detail = [argsDetail(step), resultDetail(step.tool, step.result)].filter(Boolean).join(' — ');
  return {
    kind: 'action',
    tool: step.tool,
    title: `${TITLES[step.tool] ?? step.tool}${who}`,
    detail,
    decision: DECISION_TOOLS.has(step.tool),
  };
}

export const SEAT_NAMES: Record<Seat, string> = {
  lending: 'Lending',
  collections: 'Collections',
  vendor_payments: 'Vendor payments',
};

// The case header a spectator reads: who, how much, and anything said up front.
export function caseSummary(scenario: Scenario) {
  const b = scenario.brief;
  const main = scenario.subjects.applicant ?? scenario.subjects.debtor ?? scenario.subjects.vendor_owner;
  const person = CARDS[main];
  const headline =
    scenario.seat === 'lending'
      ? `${person.name} asks for ${money(b.amount)} · ${b.purpose}`
      : scenario.seat === 'collections'
        ? `${person.name} · ${b.account} · ${money(b.balance)} past due`
        : `${b.vendor} · invoice ${b.invoiceId} · ${money(b.amount)}`;
  const email = b.email as { from: string; text: string } | undefined;
  const note = (b.applicantNote ?? b.deskChecklist ?? b.returnedMail ?? (email ? `Email from ${email.from}: ${email.text}` : '')) as string;
  return { headline, note, personId: main };
}
