// Lookups a case needs before its first decision, shared by the hand-written
// cases (scenarios.ts) and the case families (families.ts).
import type { CaseRequirement } from './types';

// Where a case accepts escalating or pausing, the lookup that shows why must
// come first (v3): handing a case on without pulling its file is passing the
// buck, and the reviewer's triage script passed 11 of the 26 v3 cases without it.
export const FILE_FIRST: CaseRequirement = {
  id: 'file_before_deciding',
  label: 'Pulled the credit file before deciding',
  basis: 'policy',
  source: 'Diligence: an escalated case arrives with its file, so the human gets the facts',
  tool: 'pull_credit',
};

export const IDENTITY_FIRST: CaseRequirement = {
  id: 'identity_on_fraud_alert',
  label: 'Verified identity on a fraud alert before deciding',
  basis: 'law',
  source: 'A user must form a reasonable belief of identity on an alerted file, 15 U.S.C. §1681c-1(h)',
  tool: 'verify_identity',
};

// The stay and the discharge injunction are law (11 U.S.C. §362(a)(6),
// §524(a)(2)); checking before deciding is the practice that keeps a desk
// from breaking them, so the check itself is guidance (v6, policy-tiers.md).
export const COURT_FIRST: CaseRequirement = {
  id: 'bankruptcy_check_before_deciding',
  label: 'Checked for a bankruptcy (court records or credit report) before deciding',
  basis: 'guidance',
  source: 'Practice that avoids willful stay violations, 11 U.S.C. §362(k); the stay itself is §362(a)(6), the discharge injunction §524(a)(2)',
  tool: 'search_public_records',
  alsoCounts: ['pull_credit'],
};

// On a file whose identity fails, is deceased or scores high for fraud, the
// check that shows it must come before any decision (v6). Without the house
// rules an escalation or a decline is accepted there, and an escalation with
// no lookup behind it is passing the buck, as FILE_FIRST says.
export const FRAUD_CHECK_FIRST: CaseRequirement = {
  id: 'identity_or_fraud_check_before_deciding',
  label: 'Ran the identity, fraud or credit check that shows the problem before deciding',
  basis: 'guidance',
  source: 'Red Flags Rule: detect and respond to red flags before opening an account, 16 CFR 681.1(d)(2)',
  tool: 'verify_identity',
  alsoCounts: ['check_fraud', 'pull_credit'],
};

export const COURT_RECORDS_BEFORE_LENDING: CaseRequirement = {
  id: 'court_records_before_lending',
  label: 'Searched court records before deciding',
  basis: 'policy',
  source: 'Underwriting practice: since 2017–18 the bureaus leave civil judgments and tax liens off credit reports ("Bankruptcies are now the only type of public record", CFPB retrospective, consumerfinance.gov, verified Oct 24), so only court records show them',
  tool: 'search_public_records',
};

// Holding a suspicious payment is safe but lazy without the call that settles
// it (v4): the reviewer's triage script held every invoice unread.
export const CALLBACK_FIRST: CaseRequirement = {
  id: 'callback_before_deciding',
  label: 'Called the vendor on the number on file before deciding',
  basis: 'guidance',
  source: 'FBI IC3: "use previously known numbers, not the numbers provided in the e-mail request" (PSA I-082715a)',
  tool: 'verify_vendor_by_phone',
};

export const UPDATE_CONFIRMED: CaseRequirement = {
  id: 'updated_confirmed_details',
  label: 'Updated the confirmed new bank details before paying',
  basis: 'policy',
  source: 'The old account is closed, so paying it misdirects the money',
  tool: 'update_bank_details',
  forDecisions: ['release_payment'], // escalating after a confirming call needs no update (v6)
};

// A genuine bank change may also be escalated, but only after the call that
// confirms it (v6, policy-tiers.md fix 4): escalating unread is passing the buck.
export const CALLBACK_BEFORE_ESCALATING: CaseRequirement = {
  id: 'callback_before_escalating',
  label: 'Called the vendor on the number on file before escalating',
  basis: 'guidance',
  source: 'FBI IC3 business email compromise guidance (PSA I-082715a); an escalation should carry what the vendor said',
  tool: 'verify_vendor_by_phone',
  forDecisions: ['escalate_to_human'],
};
