import { BenchmarkRunStatus } from '../BenchmarkRunStatus';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import type { FinanceFrame, FinanceRecording } from './replay';
import ReplayDesk from './ReplayDesk';
import { RunControls } from './RunControls';
import { ApifyRun } from './ApifyRun';
import { CONDITION_NAMES, currentVersion, scenarioFor } from './conditions';
import { EVENT_STEP } from '../../spacetimedb/src/finance/engine';
import { OfficeScene } from './OfficeScene';
import { cohorts, officesFor, STATIONS, type Office } from './comparison';
import { caseSummary, crsLine, crsStatus, describe, SEAT_NAMES } from './format';
import { PolicyMenu, ChoiceCard, VacantOffices, ReportComparison, BenchmarkPanel, ViolationCallout } from './AnalysisPanels';
import { officeInsights, policyBrief } from './insights';
import { officeState } from './officeState';
import { liveRecord } from './liveEval';
import { LiveRecord } from './LiveRecord';
import { TONE_COLORS } from './OfficeProps';

export const REPLAYS = [
  { url: '/replays/finance-v6-luna.json', label: 'gpt-6-luna · ten cases' },
  { url: '/replays/finance-v6-four-luna.json', label: 'gpt-6-luna · four runs of one case' },
  { url: '/replays/finance-v6-live-crs-script.json', label: 'Policy reference · 25 held-out cases · live CRS' },
  { url: '/replays/finance-reference.json', label: 'Scripted references · v5' },
];

export default function DeskApp({ lineup = false }: { lineup?: boolean }) {
  const { isActive } = useSpacetimeDB();
  const [cases, casesReady] = useTable(tables.financeCase);
  const [steps, stepsReady] = useTable(tables.financeStep);
  const [verdicts, verdictsReady] = useTable(tables.financeVerdict);
  const [recording, setRecording] = useState<FinanceRecording>();
  const [returnTo, setReturnTo] = useState('');
  if (recording) return <ReplayDesk lineup={lineup} snapshot={recording} onExit={() => setRecording(undefined)} />;
  return <DeskView lineup={lineup} cases={cases} steps={steps} verdicts={verdicts} isActive={isActive} ready={casesReady && stepsReady && verdictsReady} initialComparisonKey={returnTo} onReplay={snapshot => { setReturnTo(cohorts(snapshot.cases, lineup)[0]?.key ?? ''); setRecording(snapshot); }} />;
}
export function DeskView({ lineup = false, cases, steps, verdicts, isActive, ready, replay, onReplay, initialComparisonKey }: FinanceFrame & { lineup?: boolean; isActive: boolean; ready: boolean; initialComparisonKey?: string; onReplay?: (recording: FinanceRecording) => void; replay?: { controls: ReactNode; error: string; comparisonKey?: string; url?: string; onExit?: () => void; pause: () => void; onComparisonChange: (key: string) => void; live?: string } }) {
  const [selection, setSelection] = useState(initialComparisonKey ?? '');
  const [selectedOffice, setSelectedOffice] = useState(0);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [mode, setMode] = useState<'case' | 'reports' | 'benchmark'>('case');
  const [viewReset, setViewReset] = useState(0);
  // Focus follows the selected office up close, as the clearing's audience camera follows the
  // action; All offices shows the four side by side.
  const [camera, setCamera] = useState<'focus' | 'all'>('focus');
  // Above 1100px the finding and the ledger float over the stage, so the camera frames around them.
  const wide = useWide();
  const inspectOffice = (index: number) => { setSelectedOffice(index); setLedgerOpen(true); replay?.pause(); };
  // A card or office picks where to look; picking the one already in view opens its ledger.
  const chooseOffice = (index: number) => { if (index === selectedOffice) inspectOffice(index); else setSelectedOffice(index); };
  const groups = useMemo(() => cohorts(cases, lineup), [cases, lineup]);
  const group = groups.find(g => g.key === (replay?.comparisonKey ?? selection)) ?? groups.find(g => g.row.benchmarkVersion === currentVersion && g.row.variant === 'house-rules') ?? groups.find(g => g.row.benchmarkVersion === currentVersion) ?? groups[0];
  const offices = useMemo(() => officesFor(group?.key, cases, steps, verdicts), [group?.key, cases, steps, verdicts]);
  const scenario = group && scenarioFor(group.row);
  const summary = scenario && caseSummary(scenario);
  const closed = offices.filter(o => o.verdict);
  const scripts = offices.some(o => o.modelId.startsWith('script:'));
  const models = offices.some(o => o.modelId && !o.modelId.startsWith('script:'));
  const selected = offices[selectedOffice];
  const insights = useMemo(() => offices.map(officeInsights), [offices]);
  // What each office's props show: its rack, folder, visitor and audit cabinet.
  const states = useMemo(() => offices.map((office, i) => {
    const insight = insights[i];
    return insight && office.row ? officeState(insight.scenario, office.steps, insight.findings, office.row.variant, insight.report) : undefined;
  }), [offices, insights]);
  const record = useMemo(() => liveRecord(offices, insights), [offices, insights]);
  const alertIndices = insights.flatMap((insight, index) => insight?.current.length ? [index] : []);
  const alertIndex = alertIndices.includes(selectedOffice) ? selectedOffice : alertIndices[0];
  const reportMismatches = insights.filter(i => i?.report?.honest === false).length;
  const crs = useMemo(() => crsStatus(offices.flatMap(o => o.steps)), [offices]);
  const online = !replay && isActive && ready;
  const status = replay ? replay.live ?? 'Replay' : !isActive ? cases.length ? 'Reconnecting' : 'Connecting' : !ready ? 'Syncing' : 'Live';
  const statusDetail = replay ? replay.live ? 'An Apify Actor run in progress · the recording reloads as each case finishes' : scripts && !models ? 'Scripted replay · paced actions · no model calls' : 'Recorded SpacetimeDB case data · paced playback'
    : !isActive ? cases.length ? 'Reconnecting · showing the last synced state' : 'Connecting to SpacetimeDB'
    : !ready ? 'Syncing the offices' : scripts && models ? 'Live model activity · scripted references also shown' : scripts ? 'Live scripted reference run · no model calls' : 'Live · state and audit trail in SpacetimeDB';
  // A popover closes when you click anywhere else, or pick something inside a menu.
  useEffect(() => {
    const close = (e: PointerEvent) => document.querySelectorAll<HTMLDetailsElement>('details.finance-pop[open]').forEach(d => { if (!d.contains(e.target as Node)) d.open = false; });
    // Capture: the 3D canvas's camera controls stop the event before it bubbles.
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, []);
  const view = (next: typeof mode) => { setMode(next); if (next !== 'case') replay?.pause(); };
  // Reports and Results are their tables alone: no cards, no record beside them.
  return <div className={`finance-app ${mode !== 'case' ? 'analysis' : ''}`}>
    <header className="finance-top">
      <a className="dashboard-back" href="/?studio=landing" aria-label="Back to dashboard" title="Back to dashboard">←</a>
      <a className="finance-brand" href="/?studio=landing" title="Ender’s Bench · Observation Studio"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 28V10M16 19C5 21 3 11 4 6c9 0 13 4 12 13ZM16 14C15 5 22 2 28 3c1 8-4 14-12 11Z" /></svg><span>ENDER’S BENCH</span></a>
      <h1>Ledger Street<span>.</span></h1>
      <p className="finance-case" title={scenario ? `${SEAT_NAMES[scenario.seat]} · ${summary?.headline}\nThe job: ${policyBrief(scenario, group.row.variant, group.row.benchmarkVersion).task}` : undefined}>
        {scenario ? <><b>{String(scenario.brief.caseId)}</b><span>{summary?.headline}</span></> : <span>No case yet</span>}
      </p>
      <div className="finance-status">
        {new URLSearchParams(window.location.search).has('benchmark') && <BenchmarkRunStatus />}
        {/* One status: connection, with where the CRS answers came from in its tooltip and in the record. */}
        <span className={`finance-connection ${online ? 'online' : ''} ${replay ? 'replay' : ''}`} role="status" title={`${statusDetail}${crs.live ? ` · ${crs.live} live CRS call${crs.live > 1 ? 's' : ''}` : ''}${crs.fellBack ? ` · ${crs.fellBack} from the snapshot` : ''}`}><i />{status}</span>
        {scripts && <span className="finance-chip" title="Scripted reference agents · no model calls">Scripted</span>}
        {scenario && <PolicyMenu scenario={scenario} variant={group.row.variant} version={group.row.benchmarkVersion} />}
        <select className="finance-comparison" aria-label="Comparison" value={group?.key ?? ''} disabled={!groups.length} onChange={e => { setSelection(e.target.value); setSelectedOffice(0); replay?.onComparisonChange(e.target.value); }}>
          {!groups.length && <option value="">{replay ? 'Loading' : 'No cases'}</option>}
          {groups.map(g => <option key={g.key} value={g.key}>{String(scenarioFor(g.row)?.brief.caseId ?? g.row.scenarioId)} · {(CONDITION_NAMES[g.row.variant] ?? g.row.variant).split(' · ')[0]} · {g.replicas ? `${g.samples.length} runs` : `run ${g.row.sample + 1}`}{g.row.benchmarkVersion !== currentVersion ? ` · v${g.row.benchmarkVersion} · historical` : ''}</option>)}
        </select>
        <nav className="finance-tabs" aria-label="Views">
          <button aria-pressed={mode === 'case'} onClick={() => view('case')}>Offices</button>
          <button aria-pressed={mode === 'reports'} onClick={() => view('reports')} title={reportMismatches ? `${reportMismatches} report${reportMismatches > 1 ? 's' : ''} contradict the record` : 'Recorded actions beside each agent’s report'}>Reports{reportMismatches > 0 && <span>{reportMismatches}</span>}</button>
          <button aria-pressed={mode === 'benchmark'} onClick={() => view('benchmark')}>Results</button>
        </nav>
        {!replay && onReplay && <details className="finance-pop run-pop"><summary>Run</summary><RunControls data={{ cases, steps, verdicts }} comparisonKey={group?.key} connected={isActive && ready} onSelect={setSelection} onReplay={onReplay} /></details>}
        {replay && <ApifyRun replayUrl={replay.url} />}
        <details className="finance-pop more-menu">
          <summary aria-label="More">⋯</summary>
          <div className="more-items" onClick={e => (e.currentTarget.parentElement as HTMLDetailsElement).open = false}>
            <button aria-expanded={ledgerOpen} onClick={() => setLedgerOpen(v => !v)}>Case ledger</button>
            <span className="more-heading">Recordings</span>
            {REPLAYS.map(r => <a key={r.url} href={`/finance.html?replay=${r.url}`} aria-current={replay?.url === r.url ? 'page' : undefined}>{r.label}</a>)}
            {replay && <a href="/finance.html" onClick={e => { if (replay.onExit) { e.preventDefault(); replay.onExit(); } }}>Back to live</a>}
            <hr />
            <a href="/?legacy=1">The Clearing ↗</a>
            <a href="/?studio=landing">Observation Studio ↗</a>
          </div>
        </details>
      </div>
    </header>
    <section className="district-world" aria-label="Four parallel offices">
      <div className={`finance-scene-layer ${mode !== 'case' ? 'covered' : ''}`}><OfficeScene offices={offices} states={states} selected={selectedOffice} onSelect={chooseOffice} viewReset={viewReset} alertIds={alertIndices.map(i => offices[i].id)}
        focus={camera === 'focus'} insets={{ left: wide && mode === 'case' && alertIndex !== undefined ? 320 : 0, right: wide && ledgerOpen ? 420 : 0 }} /></div>
      {/* Keyed by what it says, so each new finding plays its entrance. The case's messages
          (the applicant's pressure included) are in the record, not over the offices. */}
      {mode === 'case' && alertIndex !== undefined && <ViolationCallout key={`${offices[alertIndex].id}:${insights[alertIndex]?.current[0]?.key}`} office={offices[alertIndex]} onInspect={() => inspectOffice(alertIndex)} />}
      {mode === 'reports' && <ReportComparison offices={offices} selected={selectedOffice} onInspect={index => { view('case'); inspectOffice(index); }} />}
      {mode === 'benchmark' && <BenchmarkPanel data={{ cases, steps, verdicts }} variant={group?.row.variant ?? 'house-rules'} version={group?.row.benchmarkVersion ?? currentVersion} />}
      {!replay && !cases.length && <div className="district-state" role="status">
        <strong>{!isActive ? 'Connecting to SpacetimeDB' : !ready ? 'Loading live cases' : 'No live runs yet'}</strong>
        <a href={`/finance.html?replay=${REPLAYS[0].url}`}>Watch a recorded run →</a>
      </div>}
      {mode === 'case' && <div className="camera-modes" role="group" aria-label="Camera">
        <button aria-pressed={camera === 'focus'} onClick={() => { setCamera('focus'); setViewReset(v => v + 1); }} title="Follow the selected office up close">Focus</button>
        <button aria-pressed={camera === 'all'} onClick={() => { setCamera('all'); setViewReset(v => v + 1); }} title="All four offices side by side">All offices</button>
      </div>}
      {mode === 'case' && <SceneKey />}
      {mode === 'case' && <button className="recenter-view" onClick={() => setViewReset(v => v + 1)} aria-label="Recenter view" title="Recenter view"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" /></svg></button>}
      {replay?.controls}
    </section>
    {mode === 'case' && <>
      <section className="office-cards" aria-label="Compare agent choices">
        {offices.map((office, index) => <ChoiceCard key={office.id} office={office} selected={selectedOffice === index} onInspect={() => chooseOffice(index)} onReports={() => { setSelectedOffice(index); setLedgerOpen(false); view('reports'); }} />)}
        <VacantOffices count={offices.filter(o => !o.row).length} total={offices.length} />
      </section>
      <LiveRecord entries={record} offices={offices} selected={selectedOffice} onInspect={inspectOffice} crs={crs} />
    </>}
    <aside className="finance-evidence" hidden={!ledgerOpen} aria-label="Case ledger">
      <button className="ledger-panel-close" onClick={() => setLedgerOpen(false)} aria-label="Close case ledger">×</button>
      <header className="ledger-heading"><span className="finance-eyebrow">Office {selectedOffice + 1}{selected?.row ? ` · ${STATIONS[selected.station].label}` : ''}</span><h2>{selected?.row ? selected.name : 'Vacant office'}</h2></header>
      {summary?.note && <p className="case-file-note">{summary.note}</p>}
      {selected?.thought && <div className="finance-current-thought"><span>{selected.modelId.startsWith('script:') ? 'Scripted explanation' : 'Model’s explanation'}</span><blockquote>{selected.thought}</blockquote></div>}
      {scenario && selected?.row ? <ol className="finance-timeline">{selected.steps.map((step, index) => {
        const line = describe(scenario, step), flags = insights[selectedOffice]?.findings.filter(f => f.step === index) ?? [];
        return <li key={index} className={`${line.kind === 'message' ? 'case-message' : ''} ${flags.length ? 'flagged' : ''}`}><span className="timeline-index">{index + 1}</span><div><strong>{line.kind === 'message' ? line.from : line.title}</strong><p>{line.kind === 'message' ? line.text : line.detail}</p>{line.kind === 'action' && step.crs && <span className={`crs-call ${step.crs.source}`} title={`${step.crs.endpoint}${step.crs.requestId ? `
RequestID ${step.crs.requestId}` : ''}
Sent ${step.crs.at}`}>{crsLine(step.crs)}</span>}{flags.map((flag, i) => <span className="event-flag" key={i}>{flag.label} · {flag.caption}</span>)}{selected.notes[index] && <blockquote>“{selected.notes[index]}”</blockquote>}</div></li>;
      })}</ol> : <p className="ledger-empty">No case in this office yet.</p>}
      {selected?.row?.stopped && <p className="run-stopped" role="alert">Run interrupted · {selected.row.stopped}</p>}
      <section className="finance-audit"><span className="finance-eyebrow">Audit</span><Audit office={selected} /></section>
      <div className="completion-score" title="Outcome, process and output must all pass"><span>Compliant completion</span><strong>{closed.length ? `${closed.filter(o => o.verdict?.pass).length}/${closed.length}` : '—'}</strong></div>
    </aside>
  </div>;
}
function useWide() {
  const query = '(min-width: 1101px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query), change = () => setWide(list.matches);
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, []);
  return wide;
}
// What the colours in the offices mean, as the clearing's glow key explains its glows.
function SceneKey() {
  const evidence: [keyof typeof TONE_COLORS, string][] = [['clean', 'Clean'], ['adverse', 'Adverse'], ['flag', 'Red flag'], ['frozen', 'Frozen'], ['none', 'No file']];
  // Closed until asked for; not a .finance-pop, so once open it stays open while you look.
  return <details className="scene-key">
    <summary>Key</summary>
    <div className="scene-key-panel">
      <span className="finance-eyebrow">Evidence rack: what each check returned</span>
      <ul>{evidence.map(([tone, label]) => <li key={tone}><i style={{ background: TONE_COLORS[tone] }} />{label}</li>)}</ul>
      <ul>
        <li><i className="key-bar gold" />The case requires this check</li>
        <li><i className="key-bar red" />Required check skipped</li>
        <li><i className="key-door" />Off-limits for this desk</li>
      </ul>
    </div>
  </details>;
}
function Audit({ office }: { office?: Office }) {
  const report = office && officeInsights(office)?.report;
  const names = report?.actual ?? [...new Set(office?.steps.filter(s => s.tool !== EVENT_STEP && s.tool !== 'report_to_supervisor').map(s => s.tool) ?? [])];
  const friendly = (tool: string) => tool.replace(/_/g, ' ');
  return <><div className="audit-paper"><span>Recorded tools</span><p>{names.length ? names.map(friendly).join(' · ') : 'None yet.'}</p></div><div className="audit-paper reported"><span>Reported to supervisor</span><p>{report?.summary || 'No report yet.'}</p>{report && <small>{report.claimed.map(friendly).join(' · ') || 'No tools listed'}</small>}</div>{report && report.honest != null && <span className={`report-result ${report.honest ? 'pass' : 'fail'}`}>{report.honest ? 'Report matches the audit' : 'Verifier flagged the report'}</span>}</>;
}
