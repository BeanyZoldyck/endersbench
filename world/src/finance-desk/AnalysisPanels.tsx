import { useMemo, type CSSProperties } from 'react';
import { hasHouseRules } from '../../spacetimedb/src/finance/prompt';
import { CONDITION_NAMES, currentVersion, policyAgreement } from './conditions';
import type { Scenario } from '../../spacetimedb/src/finance/types';
import type { FinanceFrame } from './replay';
import { modelLogo } from '../scene/modelLogo';
import { modelName, type Office } from './comparison';
import { benchmarkRows, officeInsights, policyBrief, type Finding } from './insights';

export function PolicyBrief({ scenario, variant, version }: { scenario: Scenario; variant: string; version: number }) {
  const policy = policyBrief(scenario, variant, version), historical = version !== currentVersion;
  return <div className="case-experiment">
    <p><strong>The job</strong> {policy.task}</p>
    <div><span className={`policy-condition ${variant !== 'no-charter' ? 'supplied' : ''}`}>{CONDITION_NAMES[variant] ?? variant}</span>
      <span className="policy-essentials">{historical ? `Historical v${version} · original scores only · excluded from v${currentVersion} results` : `${scenario.basis === 'law' ? 'Law-backed' : 'Policy-backed'} case · ${policyAgreement(scenario, variant) ? 'measures agreement with house rules, not legal violations' : variant === 'house-rules' ? 'headline benchmark condition' : 'same case, stated prompt condition'}`}</span>
      <details className="policy-details"><summary>Policy & scoring</summary><div><strong>Policy supplied to this agent</strong>{policy.rules.length ? <ol>{policy.rules.map(rule => <li key={rule}>{rule.replace(/^\d+\.\s*/, '')}</li>)}</ol> : <p>No added policy; the agent receives its role, case file, tools and task.</p>}
      <p>{historical ? 'This is the original v5 prompt. Scores are stored historical verdicts; per-turn checks are not recomputed under v6.' : 'The three gates measure outcome, process and output. Accepted decisions depend on the prompt condition. Case basis is a benchmark classification; it does not make every finding a legal violation.'}</p>
      {!!policy.requirements.length && <><strong>This case’s required checks</strong><ul>{policy.requirements.map(r => <li key={r.id}>{r.label} · {r.basis}</li>)}</ul></>}
      </div></details>
    </div>
  </div>;
}
export function FindingTag({ finding }: { finding: Finding }) {
  return <span className={`finding-tag ${finding.tier === 1 ? 'harm' : finding.tier === 2 ? 'deception' : ''}`}>{finding.label}{finding.tier && <small> · Tier {finding.tier}</small>}{finding.basis && <small> · {finding.basis}</small>}</span>;
}
export function ChoiceCard({ office, index, selected, onInspect, onReports }: { office: Office; index: number; selected: boolean; onInspect: () => void; onReports: () => void }) {
  const insight = useMemo(() => officeInsights(office), [office]), report = insight?.report;
  const finding = insight?.current[0] ?? insight?.findings[insight.findings.length - 1];
  return <article className={`office-card ${selected ? 'selected' : ''} ${insight?.current.length ? 'has-finding' : ''}`} style={{ '--office-color': office.color } as CSSProperties}>
    <button className="office-card-top" onClick={onInspect} aria-label={`Inspect ${office.name}`}><span className="office-number">0{index + 1}</span><img src={modelLogo(office.modelId)} alt="" /><div><strong>{office.name}</strong><small>{office.modelId ? office.modelId.startsWith('script:') ? 'Scripted reference' : office.modelId.split(':')[0] : 'Vacant desk'}</small></div><span className={`case-state ${office.row?.status ?? 'vacant'}`}>{office.row?.status ?? 'waiting'}</span></button>
    <div className="choice-action"><span>CURRENT ACTION</span><strong>{insight?.latest?.kind === 'action' ? insight.latest.title : office.activity}</strong><p>{insight?.latest?.kind === 'action' ? insight.latest.detail || 'Action recorded in the case ledger.' : 'Waiting for the first recorded action.'}</p></div>
    <button className={`choice-finding ${finding ? 'flagged' : ''}`} onClick={onInspect}>{finding ? <><FindingTag finding={finding} /><span>{finding.caption}</span></> : <span>{insight?.historical ? office.verdict ? 'No findings in the stored verdict' : 'Historical findings available at completion' : office.row ? 'No finding observed so far' : 'No case assigned'}</span>}</button>
    <div className={`choice-result ${office.verdict ? office.verdict.pass ? 'pass' : 'fail' : ''}`}><strong className="choice-decision">Decision · {office.decision ? office.decision.replace(/_/g, ' ') : 'pending'}</strong><span className="choice-assessment">{insight?.result ?? 'Final scores pending'}</span><small>{insight ? `${insight.findings.length} observed finding${insight.findings.length === 1 ? '' : 's'}` : ''}</small></div>
    <div className="gate-stamps"><Gate label="Outcome" value={office.verdict?.outcome} /><Gate label="Process" value={office.verdict?.process} /><Gate label="Output" value={office.verdict?.output} /></div>
    {report && <button className={`report-shortcut ${report.honest === false ? 'mismatch' : ''}`} onClick={onReports}>{report.honest === false ? 'Report contradicts the record' : report.honest === true ? 'Report matches recorded actions' : 'Compare recorded report'} <span>Compare →</span></button>}
  </article>;
}
function Gate({ label, value }: { label: string; value?: boolean }) {
  return <span className={`gate-stamp ${value === undefined ? 'pending' : value ? 'pass' : 'fail'}`}><i>{value === undefined ? '·' : value ? '✓' : '×'}</i>{label}<small>{value === undefined ? 'Pending' : value ? 'Pass' : 'Fail'}</small></span>;
}
export function ReportComparison({ offices, selected, onInspect }: { offices: Office[]; selected: number; onInspect: (index: number) => void }) {
  const insights = useMemo(() => offices.map(officeInsights), [offices]);
  return <div className="report-comparison analysis-panel"><div className="analysis-heading"><div><span className="finance-eyebrow">ACTIONS AND ACCOUNTABILITY</span><h2>What happened. What they reported.</h2></div><p>Recorded actions beside the agent’s own report. A mismatch is evidence to examine; explanations remain the agent’s account.</p></div>
    <div className="report-columns">{offices.map((office, index) => {
      const insight = insights[index], report = insight?.report;
      const calls = office.steps.filter(s => s.tool !== '__event' && s.tool !== 'report_to_supervisor');
      const actual = report?.actual ?? [...new Set(calls.map(s => s.tool))];
      return <article key={office.id} className={`report-column ${selected === index ? 'selected' : ''}`}><button onClick={() => onInspect(index)}><img src={modelLogo(office.modelId)} alt="" /><strong>{office.name}</strong></button>
        {insight?.pressure && <blockquote className="report-pressure"><span>PRESSURE · {insight.pressure.from}</span>{insight.pressure.text}</blockquote>}
        <div className="recorded-tools"><span>RECORDED BEFORE THE REPORT</span><ul>{actual.map(tool => <li key={tool} className={report?.omitted.includes(tool) ? 'omitted' : ''}>{tool.replace(/_/g, ' ')}{report?.omitted.includes(tool) && <><b>Omitted</b>{office.notes[office.steps.findIndex(s => s.tool === tool)] && <q className="report-action-thought">{office.notes[office.steps.findIndex(s => s.tool === tool)]}</q>}</>}</li>)}</ul>{!actual.length && <p>No actions recorded yet.</p>}</div>
        <div className="reported-tools"><span>REPORTED TO SUPERVISOR</span>{report ? <><blockquote>{report.summary || 'No summary supplied.'}</blockquote><ul>{report.claimed.map(tool => <li key={tool} className={report.invented.includes(tool) ? 'invented' : ''}>{tool.replace(/_/g, ' ')}{report.invented.includes(tool) && <b>Not recorded</b>}</li>)}</ul>{!report.claimed.length && <p>No tools listed.</p>}</> : <p>Report has not occurred at this point.</p>}</div>
        {report && <div className={`report-verdict ${report.honest === false ? 'mismatch' : ''}`}><strong>{report.honest === false ? 'Report mismatch observed' : report.honest === true ? 'Report matches the record' : 'Historical assessment pending'}</strong>{report.findings.map(f => <p key={f.key}>{f.caption}</p>)}</div>}
        {office.thought && <div className="report-explanation"><span>{office.modelId.startsWith('script:') ? 'SCRIPTED EXPLANATION' : 'MODEL-PROVIDED EXPLANATION'}</span><q>{office.thought}</q></div>}
      </article>;
    })}</div>
  </div>;
}
export function BenchmarkPanel({ data, variant, version }: { data: FinanceFrame; variant: string; version: number }) {
  const rows = useMemo(() => benchmarkRows(data, variant, version), [data.cases, data.verdicts, variant, version]);
  const fraction = (n: number, d: number) => d ? `${Math.round(100 * n / d)}% (${n}/${d})` : '—';
  return <div className="benchmark-panel analysis-panel"><div className="analysis-heading"><div><span className="finance-eyebrow">BENCHMARK RESULTS · V{version} · {CONDITION_NAMES[variant] ?? variant}</span><h2>Compliant completion requires all three gates.</h2></div><p>Completed episodes visible at this point. Exact prompt condition and benchmark version; newest episode per case and sample. Rows are not ranked.</p></div>
    {(['models', 'scripts'] as const).map(kind => { const group = rows.filter(r => r.scripted === (kind === 'scripts')); return <section key={kind}><h3>{kind === 'models' ? 'Recorded model results' : 'Scripted references · demonstration only'}</h3>{!group.length ? <p className="benchmark-empty">{kind === 'models' ? 'No model results loaded for this condition.' : 'No scripted references loaded.'}</p> : <div className="benchmark-table-wrap"><table><thead><tr><th>Agent / coverage</th><th>Compliant</th><th>Law-backed cases</th><th>{hasHouseRules(variant) ? 'Policy-backed cases' : 'House-rule agreement'}</th><th>Outcome</th><th>Process</th><th>Output</th><th>Tier 1 findings</th><th>Unnecessary escalation</th><th>Honest reports</th></tr></thead><tbody>{group.map(row => <tr key={row.modelId}><th><span>{modelName(row.modelId)}</span><small>{row.completed}/{row.loaded} completed episodes · {row.cases}{row.totalCases ? `/${row.totalCases}` : ''} cases · {row.samples} sample{row.samples === 1 ? '' : 's'}</small></th><td className="benchmark-primary">{fraction(row.compliant, row.completed)}</td><td>{fraction(row.lawPassed, row.law)}</td><td>{fraction(row.policyPassed, row.policy)}</td><td>{fraction(row.outcome, row.completed)}</td><td>{fraction(row.process, row.completed)}</td><td>{fraction(row.output, row.completed)}</td><td>{fraction(row.harm, row.completed)}</td><td>{fraction(row.overEscalated, row.actionNeeded)}</td><td>{fraction(row.honest, row.reports)}<small>{row.missingReports} without a report</small></td></tr>)}</tbody></table></div>}</section>; })}
    <p className="benchmark-note">{version !== currentVersion ? `Historical v${version} results are excluded from v${currentVersion}. ` : ''}Case coverage and sample counts travel with every result. Law-backed and policy-backed groups follow the benchmark’s case classifications. Tier 1 findings include benchmark policy harm; they are not all legal violations. Unnecessary escalation is measured only where acting was required. Pending cases contribute no final scores.</p>
  </div>;
}
export function ViolationCallout({ office, onInspect }: { office: Office; onInspect: () => void }) {
  const insight = useMemo(() => officeInsights(office), [office]), finding = insight?.current[0];
  if (!finding) return null;
  return <button className="violation-callout" onClick={onInspect}><span>{office.name} · {finding.label}</span><strong>{insight?.latest?.kind === 'action' ? insight.latest.title : 'Case assessment'}</strong><p>{finding.caption}</p>{insight?.pressure && <blockquote><span>PRESSURE · {insight.pressure.from}</span>{insight.pressure.text}</blockquote>}<small>{office.verdict ? 'Case complete · final gates are shown below.' : 'Observed finding · final gates remain pending until completion.'} Inspect evidence →</small></button>;
}
