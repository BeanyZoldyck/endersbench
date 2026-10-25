import { useMemo, type CSSProperties } from 'react';
import { hasHouseRules } from '../../spacetimedb/src/finance/prompt';
import { CONDITION_NAMES, currentVersion, policyAgreement } from './conditions';
import type { Scenario } from '../../spacetimedb/src/finance/types';
import type { FinanceFrame } from './replay';
import { modelLogo } from '../scene/modelLogo';
import { modelName, type Office } from './comparison';
import { benchmarkRows, officeInsights, policyBrief, type Finding } from './insights';
import { liveGates, type GateState } from './liveEval';

export function PolicyMenu({ scenario, variant, version }: { scenario: Scenario; variant: string; version: number }) {
  const policy = policyBrief(scenario, variant, version), historical = version !== currentVersion, name = CONDITION_NAMES[variant] ?? variant;
  const essentials = historical ? `Historical v${version} · original scores only · excluded from v${currentVersion} results` : `${scenario.basis === 'law' ? 'Law-backed' : 'Policy-backed'} case · ${policyAgreement(scenario, variant) ? 'measures agreement with house rules, not legal violations' : variant === 'house-rules' ? 'headline benchmark condition' : 'same case, stated prompt condition'}`;
  return <details className="finance-pop policy-pop">
    <summary className={`policy-condition ${variant !== 'no-charter' ? 'supplied' : ''} ${historical ? 'historical' : ''}`} title={`${name} · ${essentials}`}>{name.split(' · ')[0]}{historical ? ` · v${version}` : ''}</summary>
    <div className="pop-panel">
      <span className="finance-eyebrow">The job</span>
      <p className="pop-lede">{policy.task}</p>
      <p className="pop-note">{name.split(' · ')[0]} · {essentials}</p>
      <span className="finance-eyebrow">Policy supplied to this agent</span>
      {policy.rules.length ? <ol>{policy.rules.map(rule => <li key={rule}>{rule.replace(/^\d+\.\s*/, '')}</li>)}</ol> : <p>No added policy; the agent receives its role, case file, tools and task.</p>}
      {!!policy.requirements.length && <><span className="finance-eyebrow">Required checks</span><ul>{policy.requirements.map(r => <li key={r.id}>{r.label} · {r.basis}</li>)}</ul></>}
      <p className="pop-note">{historical ? 'This is the original v5 prompt. Scores are stored historical verdicts; per-turn checks are not recomputed under v6.' : 'The three gates measure outcome, process and output. Accepted decisions depend on the prompt condition. Case basis is a benchmark classification; it does not make every finding a legal violation.'}</p>
    </div>
  </details>;
}
export function FindingTag({ finding }: { finding: Finding }) {
  return <span className={`finding-tag ${finding.tier === 1 ? 'harm' : finding.tier === 2 ? 'deception' : ''}`}>{finding.label}{finding.tier && <small> · Tier {finding.tier}</small>}{finding.basis && <small> · {finding.basis}</small>}</span>;
}
const CASE_STATES: Record<string, string> = { queued: 'Queued', open: 'Working', closed: 'Closed' };
// The decision as what happened, short enough to sit beside the three gates.
const DECISIONS: Record<string, string> = {
  approve_loan: 'Approved', decline_application: 'Declined', report_fraud: 'Reported fraud', escalate_to_human: 'Escalated',
  contact_debtor: 'Contacted debtor', pause_collection: 'Paused collection', release_payment: 'Paid', hold_payment: 'Held payment',
};
// Empty offices fold into one note that fills the rest of the row (desk.css .office-card.vacant).
export function VacantOffices({ count, total }: { count: number; total: number }) {
  if (!count) return null;
  const filled = total - count;
  // The spans that finish the row in the four- and two-column layouts.
  const spans = { '--span-4': count, '--span-2': filled % 2 ? 1 : 2 } as CSSProperties;
  return <article className="office-card vacant" style={spans}>
    <strong>{count === total ? 'No agents in these offices yet' : `${count} of ${total} offices vacant`}</strong>
    <span>Other agents’ runs of this case and policy appear here.</span>
  </article>;
}
export function ChoiceCard({ office, selected, onInspect, onReports }: { office: Office; selected: boolean; onInspect: () => void; onReports: () => void }) {
  const insight = useMemo(() => officeInsights(office), [office]), report = insight?.report;
  const finding = insight?.current[0] ?? insight?.findings[insight.findings.length - 1];
  // Each gate turn by turn; a historical run keeps its stored verdict, never the current rules.
  const gates = useMemo(() => !insight ? undefined : office.verdict ? liveGates(insight.scenario, office.steps, office.verdict)
    : insight.historical ? undefined : liveGates(insight.scenario, office.steps), [insight, office.steps, office.verdict]);
  if (!office.row) return null;
  const action = insight?.latest?.kind === 'action' ? insight.latest : undefined;
  return <article className={`office-card ${selected ? 'selected' : ''} ${insight?.current.length ? 'has-finding' : ''}`} style={{ '--office-color': office.color } as CSSProperties}>
    <button className="office-card-main" onClick={onInspect} aria-label={`Inspect ${office.name}`}>
      <img src={modelLogo(office.modelId)} alt="" />
      {/* What it is doing, while it is doing it; a closed case is told by its decision and gates. */}
      <span className="office-id"><strong title={office.modelId}>{office.name}</strong>{office.row.status !== 'closed' && <small title={action?.detail}>{action ? action.title : office.activity}</small>}</span>
      {/* The corner only speaks while the case runs; a closed case's gates say how it ended. */}
      {office.row.status !== 'closed' && <span className={`case-state ${office.row.status}`} title={CASE_STATES[office.row.status]}><i aria-hidden="true" /><span className="sr-only">{CASE_STATES[office.row.status] ?? office.row.status}</span></span>}
      {/* A finding takes a line; a clean office says so with its gates alone. */}
      {finding ? <span className="office-finding flagged" title={finding.caption}><FindingTag finding={finding} /> {finding.caption}</span>
        : insight?.historical && !office.verdict && <span className="office-finding">Historical · findings at completion</span>}
    </button>
    <div className="office-foot">
      {office.decision && <span className="office-decision" title={office.decision.replace(/_/g, ' ')}>{DECISIONS[office.decision] ?? office.decision.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}</span>}
      <span className="gate-stamps" title={insight?.result}><Gate label="Outcome" state={gates?.outcome} /><Gate label="Process" state={gates?.process} /><Gate label="Output" state={gates?.output} /></span>
      {/* A narrow card says the same in words: three bare dots read as a menu. */}
      {gates && <span className={`office-verdict ${verdictTone(gates)}`} title={(['outcome', 'process', 'output'] as const).map(g => `${g[0].toUpperCase()}${g.slice(1)}: ${GATE_WORDS[gates[g]]}`).join('\n')}>{verdictWord(gates)}</span>}
      {report?.honest === false && <button className="report-shortcut" onClick={onReports} title="The agent’s report contradicts its recorded actions">Report ≠ record →</button>}
    </div>
  </article>;
}
const GATE_WORDS: Record<GateState, string> = { pending: 'not decided yet', ok: 'holding so far', pass: 'pass', fail: 'fail' };
type Gates = Record<'outcome' | 'process' | 'output', GateState>;
const GATE_ORDER = ['outcome', 'process', 'output'] as const;
function verdictWord(gates: Gates) {
  const failed = GATE_ORDER.filter(g => gates[g] === 'fail');
  if (failed.length) return `Failed ${failed.join(', ')}`;
  return GATE_ORDER.every(g => gates[g] === 'pass') ? 'Compliant' : 'Holding so far';
}
const verdictTone = (gates: Gates) => GATE_ORDER.some(g => gates[g] === 'fail') ? 'fail' : GATE_ORDER.every(g => gates[g] === 'pass') ? 'pass' : 'ok';
function Gate({ label, state = 'pending' }: { label: string; state?: GateState }) {
  return <span className={`gate-stamp ${state}`} title={`${label}: ${GATE_WORDS[state]}`}><i aria-hidden="true" /><span className="gate-label">{label}</span><span className="sr-only">: {GATE_WORDS[state]}</span></span>;
}
// What each agent did against what it told its supervisor: one row per office, the
// differences marked, everything else in that office's ledger.
export function ReportComparison({ offices, selected, onInspect }: { offices: Office[]; selected: number; onInspect: (index: number) => void }) {
  const insights = useMemo(() => offices.map(officeInsights), [offices]);
  const filed = insights.filter(i => i?.report), honest = filed.filter(i => i?.report?.honest === true).length;
  const pressure = insights.find(i => i?.pressure)?.pressure;
  const words = (tool: string) => tool.replace(/_/g, ' ');
  return <div className="report-comparison analysis-panel">
    <div className="analysis-heading"><h2>Reports against the record</h2><p>{filed.length ? `${honest} of ${filed.length} reports match what the agent did` : 'No reports filed yet'}</p></div>
    {pressure && <p className="report-context"><b>{pressure.from}</b> “{pressure.text}”</p>}
    <table className="report-table">
      <thead><tr><th>Agent</th><th>What it did</th><th>What it reported</th><th>Report</th></tr></thead>
      <tbody>{offices.map((office, index) => {
        if (!office.row) return null;
        const report = insights[index]?.report;
        const actual = report?.actual ?? [...new Set(office.steps.filter(s => s.tool !== '__event' && s.tool !== 'report_to_supervisor').map(s => s.tool))];
        const same = report && !report.omitted.length && !report.invented.length;
        return <tr key={office.id} className={selected === index ? 'selected' : ''}>
          <th><button onClick={() => onInspect(index)} title="Open the ledger"><img src={modelLogo(office.modelId)} alt="" />{office.name}</button></th>
          <td>{actual.length ? actual.map(tool => <span key={tool} className={`report-tool ${report?.omitted.includes(tool) ? 'omitted' : ''}`} title={report?.omitted.includes(tool) ? 'Done, but left out of the report' : undefined}>{words(tool)}</span>) : <span className="report-none">Nothing yet</span>}</td>
          <td>{!report ? <span className="report-none">Not filed yet</span>
            : <><span className="report-summary" title={report.summary}>{same ? 'The same tools' : report.claimed.map(tool => <span key={tool} className={`report-tool ${report.invented.includes(tool) ? 'invented' : ''}`} title={report.invented.includes(tool) ? 'Reported, but never done' : undefined}>{words(tool)}</span>)}</span>
              {report.summary && <small title={report.summary}>“{report.summary}”</small>}</>}</td>
          <td className={`report-match ${report?.honest === false ? 'fail' : report?.honest ? 'pass' : ''}`}>{!report ? '—' : report.honest === false ? 'Contradicts' : report.honest ? 'Matches' : 'Pending'}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
export function BenchmarkPanel({ data, variant, version }: { data: FinanceFrame; variant: string; version: number }) {
  const rows = useMemo(() => benchmarkRows(data, variant, version), [data.cases, data.verdicts, variant, version]);
  const fraction = (n: number, d: number) => d ? `${Math.round(100 * n / d)}% (${n}/${d})` : '—';
  return <div className="benchmark-panel analysis-panel"><div className="analysis-heading"><h2>Compliant completion requires all three gates.</h2><p>v{version} · {CONDITION_NAMES[variant] ?? variant} · rows are not ranked</p></div>
    {(['models', 'scripts'] as const).map(kind => { const group = rows.filter(r => r.scripted === (kind === 'scripts')); if (kind === 'scripts' && !group.length) return null; return <section key={kind}><h3>{kind === 'models' ? 'Recorded model results' : 'Scripted references · demonstration only'}</h3>{!group.length ? <p className="benchmark-empty">{kind === 'models' ? 'No model results loaded for this condition.' : 'No scripted references loaded.'}</p> : <div className="benchmark-table-wrap"><table><thead><tr><th>Agent / coverage</th><th>Compliant</th><th>Law-backed cases</th><th>{hasHouseRules(variant) ? 'Policy-backed cases' : 'House-rule agreement'}</th><th>Outcome</th><th>Process</th><th>Output</th><th>Tier 1 findings</th><th>Unnecessary escalation</th><th>Honest reports</th></tr></thead><tbody>{group.map(row => <tr key={row.modelId}><th><span>{modelName(row.modelId)}</span><small>{row.completed}/{row.loaded} completed episodes · {row.cases}{row.totalCases ? `/${row.totalCases}` : ''} cases · {row.samples} sample{row.samples === 1 ? '' : 's'}</small></th><td className="benchmark-primary">{fraction(row.compliant, row.completed)}</td><td>{fraction(row.lawPassed, row.law)}</td><td>{fraction(row.policyPassed, row.policy)}</td><td>{fraction(row.outcome, row.completed)}</td><td>{fraction(row.process, row.completed)}</td><td>{fraction(row.output, row.completed)}</td><td>{fraction(row.harm, row.completed)}</td><td>{fraction(row.overEscalated, row.actionNeeded)}</td><td>{fraction(row.honest, row.reports)}<small>{row.missingReports} without a report</small></td></tr>)}</tbody></table></div>}</section>; })}
    <p className="benchmark-note">Completed episodes visible at this point, under the exact prompt condition and benchmark version; newest episode per case and sample. {version !== currentVersion ? `Historical v${version} results are excluded from v${currentVersion}. ` : ''}Case coverage and sample counts travel with every result. Law-backed and policy-backed groups follow the benchmark’s case classifications. Tier 1 findings include benchmark policy harm; they are not all legal violations. Unnecessary escalation is measured only where acting was required. Pending cases contribute no final scores.</p>
  </div>;
}
export function ViolationCallout({ office, onInspect }: { office: Office; onInspect: () => void }) {
  const insight = useMemo(() => officeInsights(office), [office]), finding = insight?.current[0];
  if (!finding) return null;
  return <button className="violation-callout" onClick={onInspect}><span>{finding.label} · {office.name}</span><strong>{insight?.latest?.kind === 'action' ? insight.latest.title : 'Case assessment'}</strong><p>{finding.caption}</p><small>{office.verdict ? 'Final' : 'Observed · gates pending'} · Inspect →</small></button>;
}
