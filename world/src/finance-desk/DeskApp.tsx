import { useMemo, useState, type ReactNode } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import type { FinanceFrame, FinanceRecording } from './replay';
import ReplayDesk from './ReplayDesk';
import { RunControls } from './RunControls';
import { CONDITION_NAMES, currentVersion, scenarioFor } from './conditions';
import { EVENT_STEP } from '../../spacetimedb/src/finance/engine';
import { OfficeScene } from './OfficeScene';
import { cohorts, modelName, officesFor, STATIONS, type Office } from './comparison';
import { caseSummary, describe, SEAT_NAMES } from './format';
import { PolicyBrief, ChoiceCard, ReportComparison, BenchmarkPanel, ViolationCallout } from './AnalysisPanels';
import { officeInsights } from './insights';

export default function DeskApp() {
  const { isActive } = useSpacetimeDB();
  const [cases, casesReady] = useTable(tables.financeCase);
  const [steps, stepsReady] = useTable(tables.financeStep);
  const [verdicts, verdictsReady] = useTable(tables.financeVerdict);
  const [recording, setRecording] = useState<FinanceRecording>();
  const [returnTo, setReturnTo] = useState('');
  if (recording) return <ReplayDesk snapshot={recording} onExit={() => setRecording(undefined)} />;
  return <DeskView cases={cases} steps={steps} verdicts={verdicts} isActive={isActive} ready={casesReady && stepsReady && verdictsReady} initialComparisonKey={returnTo} onReplay={snapshot => { setReturnTo(cohorts(snapshot.cases)[0]?.key ?? ''); setRecording(snapshot); }} />;
}
export function DeskView({ cases, steps, verdicts, isActive, ready, replay, onReplay, initialComparisonKey }: FinanceFrame & { isActive: boolean; ready: boolean; initialComparisonKey?: string; onReplay?: (recording: FinanceRecording) => void; replay?: { controls: ReactNode; error: string; comparisonKey?: string; onExit?: () => void; pause: () => void; onComparisonChange: (key: string) => void } }) {
  const [selection, setSelection] = useState(initialComparisonKey ?? '');
  const [selectedOffice, setSelectedOffice] = useState(0);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [mode, setMode] = useState<'case' | 'reports' | 'benchmark'>('case');
  const [viewReset, setViewReset] = useState(0);
  const inspectOffice = (index: number) => { setSelectedOffice(index); setLedgerOpen(true); replay?.pause(); };
  const groups = useMemo(() => cohorts(cases), [cases]);
  const group = groups.find(g => g.key === (replay?.comparisonKey ?? selection)) ?? groups.find(g => g.row.benchmarkVersion === currentVersion && g.row.variant === 'house-rules') ?? groups.find(g => g.row.benchmarkVersion === currentVersion) ?? groups[0];
  const offices = useMemo(() => officesFor(group?.key, cases, steps, verdicts), [group?.key, cases, steps, verdicts]);
  const scenario = group && scenarioFor(group.row);
  const summary = scenario && caseSummary(scenario);
  const closed = offices.filter(o => o.verdict);
  const scripts = offices.some(o => o.modelId.startsWith('script:'));
  const models = offices.some(o => o.modelId && !o.modelId.startsWith('script:'));
  const selected = offices[selectedOffice];
  const insights = useMemo(() => offices.map(officeInsights), [offices]);
  const alertIndices = insights.flatMap((insight, index) => insight?.current.length ? [index] : []);
  const alertIndex = alertIndices.includes(selectedOffice) ? selectedOffice : alertIndices[0];
  const pressureIndex = insights[selectedOffice]?.pressure ? selectedOffice : insights.findIndex(i => i?.pressure);
  const pressure = insights[pressureIndex]?.pressure;
  const reportMismatches = insights.filter(i => i?.report?.honest === false).length;
  return <div className="finance-app">
    <header className="finance-masthead">
      <a className="finance-brand" href="/"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M15 29V12m0 8C4 22 3 10 5 6c8 0 11 6 10 14Zm0-4C14 7 22 3 28 5c1 8-5 13-13 11Z" /></svg>ENDER’S BENCH <span>Ledger Street</span></a>
      <nav><span className={`finance-connection ${isActive && ready ? 'online' : ''}`} role="status"><i />{replay ? 'Recorded playback' : !isActive ? cases.length ? 'Reconnecting · last known state' : 'Connecting to the district' : !ready ? 'Syncing the offices' : 'Live · SpacetimeDB'}</span>{replay ? <a href="/finance.html" onClick={e => { if (replay.onExit) { e.preventDefault(); replay.onExit(); } }}>Live view</a> : <a href="/finance.html?replay=/replays/finance-v6-luna.json">Replay Luna v6</a>}<button className="ledger-toggle" aria-expanded={ledgerOpen} onClick={() => setLedgerOpen(v => !v)}>Case ledger</button><a href="/">The Clearing ↗</a></nav>
    </header>
    <section className="finance-case-strip" aria-label="Shared case">
      <div className="case-stamp">{scenario ? SEAT_NAMES[scenario.seat] : 'THE CASE FILE'}<strong>{scenario ? String(scenario.brief.caseId) : '—'}</strong></div>
      <div className="case-headline"><h2>{summary?.headline ?? 'The offices are ready for a shared case.'}</h2></div>
      <div className="case-switch"><label htmlFor="finance-case">COMPARISON</label><select id="finance-case" value={group?.key ?? ''} disabled={!groups.length} onChange={e => { setSelection(e.target.value); setSelectedOffice(0); replay?.onComparisonChange(e.target.value); }}>
        {!groups.length && <option value="">{replay ? 'Loading replay' : 'Awaiting live cases'}</option>}
        {groups.map(g => <option key={g.key} value={g.key}>{String(scenarioFor(g.row)?.brief.caseId ?? g.row.scenarioId)} · {CONDITION_NAMES[g.row.variant] ?? g.row.variant} · {g.replicas ? `${g.samples.length} independent runs` : `sample ${g.row.sample + 1}`} · v{g.row.benchmarkVersion}{g.row.benchmarkVersion !== currentVersion ? ' · historical' : ''}</option>)}
      </select></div>
      <nav className="finance-view-tabs" aria-label="Finance views"><button aria-pressed={mode === 'case'} onClick={() => setMode('case')}>Case comparison</button><button aria-pressed={mode === 'reports'} onClick={() => { setMode('reports'); replay?.pause(); }}>Actions vs reports{reportMismatches > 0 && <span>{reportMismatches} mismatch{reportMismatches > 1 ? 'es' : ''}</span>}</button><button aria-pressed={mode === 'benchmark'} onClick={() => { setMode('benchmark'); replay?.pause(); }}>Benchmark results</button></nav>
      {scenario && <PolicyBrief scenario={scenario} variant={group.row.variant} version={group.row.benchmarkVersion} />}
      {!replay && onReplay && <RunControls data={{ cases, steps, verdicts }} comparisonKey={group?.key} connected={isActive && ready} onSelect={setSelection} onReplay={onReplay} />}
    </section>
    <section className="district-world" aria-label="Four parallel offices">
      <div className="district-world-top"><span><i />{replay ? scripts && !models ? 'SCRIPTED REPLAY · PACED ACTIONS · NO MODEL CALLS' : 'RECORDED REPLAY · PACED ACTIONS' : !isActive && cases.length ? 'LAST SYNCED CASE ACTIVITY' : scripts && models ? 'LIVE MODEL ACTIVITY · SCRIPTED REFERENCES ALSO SHOWN' : scripts ? 'LIVE SCRIPTED REFERENCE RUN · NO MODEL CALLS' : 'LIVE CASE ACTIVITY'}</span><span>{group?.replicas ? `Same model · ${Math.min(group.samples.length, 4)} independent runs shown` : 'Independent evidence · independent decisions'}</span></div>
      <div className={`finance-scene-layer ${mode !== 'case' ? 'covered' : ''}`}><OfficeScene offices={offices} selected={selectedOffice} onSelect={inspectOffice} viewReset={viewReset} alertIds={alertIndices.map(i => offices[i].id)} /></div>
      {mode === 'case' && alertIndex !== undefined && <ViolationCallout office={offices[alertIndex]} onInspect={() => inspectOffice(alertIndex)} />}
      {mode === 'case' && alertIndex === undefined && pressure && <aside className="pressure-callout"><span>PRESSURE RECEIVED · {offices[pressureIndex].name} · {pressure.from}</span><p>{pressure.text}</p></aside>}
      {mode === 'reports' && <ReportComparison offices={offices} selected={selectedOffice} onInspect={inspectOffice} />}
      {mode === 'benchmark' && <BenchmarkPanel data={{ cases, steps, verdicts }} variant={group?.row.variant ?? 'house-rules'} version={group?.row.benchmarkVersion ?? currentVersion} />}
      {!replay && (!isActive || !ready || !cases.length) && <div className="district-state" role="status">
        <strong>{!isActive ? 'Waiting for SpacetimeDB' : !ready ? 'Loading live cases' : 'No finance runs yet'}</strong>
        <span>{cases.length ? 'Showing the last synced agents and case activity.' : 'Agents appear when live finance cases arrive.'}</span>
      </div>}
      {replay?.controls}
      <div className="district-world-bottom"><button className="recenter-view" onClick={() => setViewReset(v => v + 1)}>Recenter view</button><span>Drag to explore · scroll to zoom</span></div>
    </section>
    <section className="office-cards" aria-label="Compare agent choices">
      {offices.map((office, index) => <ChoiceCard key={office.id} office={office} index={index} selected={selectedOffice === index} onInspect={() => inspectOffice(index)} onReports={() => { setSelectedOffice(index); setMode('reports'); setLedgerOpen(false); replay?.pause(); }} />)}
    </section>
    <section className="finance-evidence" hidden={!ledgerOpen} aria-label="Case ledger"><button className="ledger-panel-close" onClick={() => setLedgerOpen(false)} aria-label="Close case ledger">×</button>
      <div className="evidence-ledger">{summary?.note && <p className="case-file-note">{summary.note}</p>}<div className="ledger-heading"><div><span className="finance-eyebrow">INSIDE OFFICE 0{selectedOffice + 1}</span><h2>{selected?.modelId ? `${modelName(selected.modelId)}’s case ledger` : 'A desk waiting for its first case'}</h2></div><span className="ledger-station">{selected && STATIONS[selected.station].label}</span></div>
        {selected?.thought && <div className="finance-current-thought"><span>{selected.modelId.startsWith('script:') ? 'SCRIPTED EXPLANATION' : 'MODEL-PROVIDED EXPLANATION'}</span><blockquote>{selected.thought}</blockquote></div>}
        {scenario && selected ? <ol className="finance-timeline">{selected.steps.map((step, index) => {
          const line = describe(scenario, step), flags = insights[selectedOffice]?.findings.filter(f => f.step === index) ?? [];
          return <li key={index} className={`${line.kind === 'message' ? 'case-message' : ''} ${flags.length ? 'flagged' : ''}`}><span className="timeline-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{line.kind === 'message' ? line.from : line.title}</strong><p>{line.kind === 'message' ? line.text : line.detail}</p>{flags.map((flag, i) => <span className="event-flag" key={i}>{flag.label} · {flag.caption}</span>)}{selected.notes[index] && <blockquote>{selected.modelId.startsWith('script:') ? 'Scripted explanation' : 'Model-provided explanation'} · “{selected.notes[index]}”</blockquote>}</div></li>;
        })}</ol> : <div className="ledger-empty"><span>⌁</span><p>Evidence belongs to the agent that gathered it.</p><small>Connect a finance run to follow the same case across these independent offices.</small></div>}
        {selected?.row?.stopped && <p className="run-stopped" role="alert">Run interrupted · {selected.row.stopped}</p>}
      </div>
      <aside className="finance-audit"><span className="finance-eyebrow">THE AUDIT TRAIL</span><h2>Actions meet words.</h2><p>Compare the recorded tool calls with the agent’s own report.</p><Audit office={selected} /><div className="completion-score"><span>COMPLIANT COMPLETION</span><strong>{closed.length ? `${closed.filter(o => o.verdict?.pass).length}/${closed.length}` : '—'}</strong><small>of the completed cases shown here<br />Outcome, process and output must all pass.</small></div></aside>
    </section>
    <footer className="district-footer"><span>Cal Hacks 13.0 · Ender’s Bench</span><span>{group ? `${group.row.variant} · benchmark v${group.row.benchmarkVersion} · ${group.replicas ? `${group.samples.length} independent runs` : `sample ${group.row.sample + 1}`}` : 'Shared case. Separate judgment.'}</span><span>{replay ? 'Recorded SpacetimeDB case data · paced playback' : 'State & audit trail powered by SpacetimeDB'}</span></footer>
  </div>;
}
function Audit({ office }: { office?: Office }) {
  const report = office && officeInsights(office)?.report;
  const names = report?.actual ?? [...new Set(office?.steps.filter(s => s.tool !== EVENT_STEP && s.tool !== 'report_to_supervisor').map(s => s.tool) ?? [])];
  const friendly = (tool: string) => tool.replace(/_/g, ' ');
  return <><div className="audit-paper"><span>RECORDED TOOLS</span><p>{names.length ? names.map(friendly).join(' · ') : 'No actions recorded yet.'}</p></div><div className="audit-paper reported"><span>REPORTED TO SUPERVISOR</span><p>{report?.summary || 'Awaiting the agent’s report.'}</p>{report && <small>{report.claimed.map(friendly).join(' · ') || 'No tools listed'}</small>}</div>{report && report.honest != null && <span className={`report-result ${report.honest ? 'pass' : 'fail'}`}>{report.honest ? 'Report matches the audit' : 'Verifier flagged the report'}</span>}</>;
}
