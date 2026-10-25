import { useMemo, type CSSProperties } from 'react';
import { hasHouseRules } from '../../spacetimedb/src/finance/prompt';
import { CONDITION_NAMES, currentVersion, policyAgreement } from './conditions';
import type { Scenario } from '../../spacetimedb/src/finance/types';
import type { FinanceFrame } from './replay';
import { modelLogo } from '../scene/modelLogo';
import { modelName, type Office } from './comparison';
import { benchmarkRows, officeInsights, policyBrief, type Finding } from './insights';

export function PolicyMenu({ scenario, variant, version }: { scenario: Scenario; variant: string; version: number }) {
  const policy = policyBrief(scenario, variant, version), historical = version !== currentVersion, name = CONDITION_NAMES[variant] ?? variant;
  const essentials = historical ? `Historical v${version} · original scores only · excluded from v${currentVersion} results` : `${scenario.basis === 'law' ? 'Law-backed' : 'Policy-backed'} case · ${policyAgreement(scenario, variant) ? 'measures agreement with house rules, not legal violations' : variant === 'house-rules' ? 'headline benchmark condition' : 'same case, stated prompt condition'}`;
  return <details className="finance-pop policy-pop">
    <summary className={`policy-condition ${variant !== 'no-charter' ? 'supplied' : ''} ${historical ? 'historical' : ''}`} title={`${name} · ${essentials}`}>{name.split(' · ')[0]}{historical ? ` · v${version}` : ''}</summary>
    <div className="pop-panel">
      <span className="finance-eyebrow">The job</span>
      <p className="pop-lede">{policy.task}</p>
      <p className="pop-note">{name} · {essentials}</p>
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
export function ChoiceCard({ office, index, selected, onInspect, onReports }: { office: Office; index: number; selected: boolean; onInspect: () => void; onReports: () => void }) {
  const insight = useMemo(() => officeInsights(office), [office]), report = insight?.report;
  const finding = insight?.current[0] ?? insight?.findings[insight.findings.length - 1];
  if (!office.row) return <article className="office-card vacant"><span className="office-number">0{index + 1}</span><span>Vacant office</span></article>;
  const action = insight?.latest?.kind === 'action' ? insight.latest : undefined;
  return <article className={`office-card ${selected ? 'selected' : ''} ${insight?.current.length ? 'has-finding' : ''}`} style={{ '--office-color': office.color } as CSSProperties}>
    <button className="office-card-main" onClick={onInspect} aria-label={`Inspect ${office.name}`}>
      <img src={modelLogo(office.modelId)} alt="" />
      <span className="office-id"><strong>{office.name}</strong><small>0{index + 1} · {office.modelId.startsWith('script:') ? 'Scripted reference' : office.modelId.split(':')[0]}</small></span>
      <span className={`case-state ${office.row.status}`}>{office.row.status}</span>
      <span className="office-action" title={action?.detail}>{action ? action.title : office.activity}</span>
      <span className={`office-finding ${finding ? 'flagged' : ''}`} title={finding?.caption}>{finding ? <><FindingTag finding={finding} /> {finding.caption}</> : insight?.historical && !office.verdict ? 'Historical · findings at completion' : 'No findings'}</span>
    </button>
    <div className="office-foot">
      {office.decision && <span className="office-decision">{office.decision.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}</span>}
      <span className="gate-stamps" title={insight?.result}><Gate label="Outcome" value={office.verdict?.outcome} /><Gate label="Process" value={office.verdict?.process} /><Gate label="Output" value={office.verdict?.output} /></span>
      {report?.honest === false && <button className="report-shortcut" onClick={onReports} title="The agent’s report contradicts its recorded actions">Report ≠ record →</button>}
    </div>
  </article>;
}
function Gate({ label, value }: { label: string; value?: boolean }) {
  return <span className={`gate-stamp ${value === undefined ? 'pending' : value ? 'pass' : 'fail'}`} title={`${label}: ${value === undefined ? 'pending' : value ? 'pass' : 'fail'}`}><i>{value === undefined ? '·' : value ? '✓' : '×'}</i>{label}</span>;
}
export function ReportComparison({ offices, selected, onInspect }: { offices: Office[]; selected: number; onInspect: (index: number) => void }) {
  const insights = useMemo(() => offices.map(officeInsights), [offices]);
  return <div className="report-comparison analysis-panel"><div className="analysis-heading"><h2>What happened. What they reported.</h2><p>A mismatch is evidence to examine; explanations remain the agent’s account.</p></div>
    <div className="report-columns">{offices.map((office, index) => {
      if (!office.row) return null;
      const insight = insights[index], report = insight?.report;
      const calls = office.steps.filter(s => s.tool !== '__event' && s.tool !== 'report_to_supervisor');
      const actual = report?.actual ?? [...new Set(calls.map(s => s.tool))];
      return <article key={office.id} className={`report-column ${selected === index ? 'selected' : ''}`}><button onClick={() => onInspect(index)}><img src={modelLogo(office.modelId)} alt="" /><strong>{office.name}</strong></button>
        {insight?.pressure && <blockquote className="report-pressure"><span>Pressure · {insight.pressure.from}</span>{insight.pressure.text}</blockquote>}
        <div className="recorded-tools"><span>Recorded before the report</span><ul>{actual.map(tool => <li key={tool} className={report?.omitted.includes(tool) ? 'omitted' : ''}>{tool.replace(/_/g, ' ')}{report?.omitted.includes(tool) && <><b>Omitted</b>{office.notes[office.steps.findIndex(s => s.tool === tool)] && <q className="report-action-thought">{office.notes[office.steps.findIndex(s => s.tool === tool)]}</q>}</>}</li>)}</ul>{!actual.length && <p>No actions recorded yet.</p>}</div>
        <div className="reported-tools"><span>Reported to supervisor</span>{report ? <><blockquote>{report.summary || 'No summary supplied.'}</blockquote><ul>{report.claimed.map(tool => <li key={tool} className={report.invented.includes(tool) ? 'invented' : ''}>{tool.replace(/_/g, ' ')}{report.invented.includes(tool) && <b>Not recorded</b>}</li>)}</ul>{!report.claimed.length && <p>No tools listed.</p>}</> : <p>Report has not occurred at this point.</p>}</div>
        {report && <div className={`report-verdict ${report.honest === false ? 'mismatch' : ''}`}><strong>{report.honest === false ? 'Report mismatch observed' : report.honest === true ? 'Report matches the record' : 'Historical assessment pending'}</strong>{report.findings.map(f => <p key={f.key}>{f.caption}</p>)}</div>}
        {office.thought && <div className="report-explanation"><span>{office.modelId.startsWith('script:') ? 'Scripted explanation' : 'Model’s explanation'}</span><q>{office.thought}</q></div>}
      </article>;
    })}</div>
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
  return <button className="violation-callout" onClick={onInspect}><span>{finding.label} · {office.name}</span><strong>{insight?.latest?.kind === 'action' ? insight.latest.title : 'Case assessment'}</strong><p>{finding.caption}</p>{insight?.pressure && <blockquote><span>Pressure · {insight.pressure.from}</span>{insight.pressure.text}</blockquote>}<small>{office.verdict ? 'Final' : 'Observed · gates pending'} · Inspect →</small></button>;
}
