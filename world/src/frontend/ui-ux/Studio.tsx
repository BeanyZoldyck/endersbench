import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Agent, Message, Score } from '../../module_bindings/types';
import { WorldScene, type CameraMode } from '../../scene/WorldScene';
import { parsePhysics } from '../../scene/contract';
import { Spotlight } from '../../Spotlight';
import { stateAt, type RecordedTables } from '../../useReplay';
import { EXHIBITS, exhibitHref, nextTourHref, tourStep } from '../../exhibits';
import { DEFAULT_RUN, RUNS, agentStatus, formatClock, messagesFor, runInfo, scoreFor, type EvidenceMoment } from '../data';
import { initialStudioState, recordedStudioHref, requiresRecordedSource, transitionStudio, type StudioAction, type StudioModel, type StudioScreen, type StudioState } from '../model';
import { useLiveSource, useRecordedSource, type StudioSource } from '../source';
import { buildPresentation, buildResults } from '../presentation';
import '../studio.css';

const MODELS: StudioModel[] = ['Ender', 'Qwen', 'Claude', 'ChatGPT'];
const modelInitial: Record<StudioModel, string> = { Ender: 'E', Qwen: 'Q', Claude: 'C', ChatGPT: 'G' };
const recordedModelMark = (modelId: string): string => {
  const id = modelId.toLowerCase();
  if (id.includes('qwen')) return 'Q';
  if (id.includes('claude')) return 'C';
  if (id.includes('gemini')) return '✦';
  if (id.includes('gpt') || id.includes('openai')) return 'G';
  return 'M';
};
const playbackIcon = { previous: '/studio/f7bee.svg', play: '/studio/fbfe3.svg', stop: '/studio/4660a.svg', next: '/studio/aff88.svg' };

export default function Studio() {
  const [state, dispatch] = useReducer(transitionStudio, window.location.search, initialStudioState);
  const live = new URLSearchParams(window.location.search).has('live');
  return live
    ? <LiveStudio state={state} dispatch={dispatch} />
    : <RecordedStudio key={state.runId} state={state} dispatch={dispatch} />;
}

function RecordedStudio({ state, dispatch }: { state: StudioState; dispatch: React.Dispatch<StudioAction> }) {
  const source = useRecordedSource(state);
  return <StudioPages state={state} dispatch={dispatch} source={source} />;
}

function LiveStudio({ state, dispatch }: { state: StudioState; dispatch: React.Dispatch<StudioAction> }) {
  const source = useLiveSource();
  return <StudioPages state={state} dispatch={dispatch} source={source} />;
}

function StudioPages({ state, dispatch, source }: { state: StudioState; dispatch: React.Dispatch<StudioAction>; source: StudioSource }) {
  const [camera, setCamera] = useState<CameraMode>('audience');
  const [landingAgent, setLandingAgent] = useState<string | null>(null);
  const [lendingAgent, setLendingAgent] = useState('Nova');
  const [liveEventKey, setLiveEventKey] = useState<string | null>(null);
  const [spotlitId, setSpotlitId] = useState<bigint | null>(null);
  const [tourEnabled, setTourEnabled] = useState(() => tourStep(window.location.search) !== null);
  const presentation = useMemo(() => buildPresentation(source.data), [source.data]);
  const results = useMemo(
    () => buildResults(source.live ? source.data : source.final, source.ready, source.live),
    [source.live, source.data, source.final, source.ready],
  );
  const onSpotlight = useCallback((id: bigint | null) => setSpotlitId(id), []);
  const finalAgents = source.final?.agents ?? [];
  const agentCountLabel = source.ready ? `${finalAgents.length} agents` : 'Agent count unavailable';
  const featuredEvent = source.moments.find(event => event.detail && event.kind !== 'start' && event.kind !== 'transfer') ?? source.moments.find(event => event.kind !== 'start');
  const agents = source.data?.agents ?? finalAgents;
  const latestEvent = source.moments.reduce<EvidenceMoment | null>((latest, event) => event.t <= source.t ? event : latest, null);
  const selectedId = state.selectedAgentId ?? latestEvent?.agentId ?? String(finalAgents[0]?.id ?? '');
  const selected = agents.find(agent => String(agent.id) === selectedId) ?? finalAgents.find(agent => String(agent.id) === selectedId);
  const visibleEvent = state.screen === 'context' && selected
    ? (source.live && liveEventKey ? source.moments.find(event => event.key === liveEventKey && event.agentId === String(selected.id)) : null)
      ?? [...source.moments].reverse().find(event => event.agentId === String(selected.id) && event.t <= source.t)
      ?? null
    : latestEvent;
  const inspectorEvent = state.selectedAgentId
    ? [...source.moments].reverse().find(event => event.agentId === selectedId && event.t <= source.t) ?? null
    : visibleEvent;
  const contextData = source.replay && visibleEvent ? stateAt(source.replay, visibleEvent.t) : source.data;
  const run = source.live ? { ...runInfo(state.runId), label: 'Current simulation', condition: 'Live' } : runInfo(state.runId);
  const nav = (screen: StudioScreen) => {
    if (source.live && requiresRecordedSource(screen)) {
      window.location.assign(recordedStudioHref(screen, state.runId));
      return;
    }
    dispatch({ type: 'navigate', screen, timeMs: source.t });
  };
  const openRecorded = (screen: StudioScreen, runId: string, atMs: number, view?: 'graph' | 'details') => {
    if (source.live) {
      window.location.assign(recordedStudioHref(screen, runId, atMs, view));
      return;
    }
    if (state.runId === runId) source.seek(atMs);
    dispatch({ type: 'select-run', runId });
    if (view) dispatch({ type: 'context-tab', tab: view });
    dispatch({ type: 'navigate', screen, timeMs: atMs });
  };
  const selectAgent = (id: string | null) => {
    setLiveEventKey(null);
    if (!id) setSpotlitId(null);
    setCamera(id ? 'follow' : 'audience');
    dispatch({ type: 'select-agent', agentId: id });
  };
  const goContext = () => {
    setLiveEventKey(null);
    dispatch({ type: 'context-tab', tab: 'details' });
    nav('context');
  };
  const goFollow = (id: string) => { dispatch({ type: 'select-briefing-scenario', scenario: 'clearing' }); selectAgent(id); setCamera('follow'); nav('follow'); };
  const eventAt = (event: EvidenceMoment) => {
    if (source.live) setLiveEventKey(event.key);
    else source.seek(event.t);
    dispatch({ type: 'select-event', index: source.moments.findIndex(item => item.key === event.key) });
  };
  const replayCommand = (command: 'previous' | 'next' | 'stop' | 'play' | 'pause') => {
    if (source.live || !source.ready) return;
    const current = source.moments.reduce((index, event, i) => event.t <= source.t ? i : index, -1);
    if (command === 'pause') source.setPlaying(false);
    else if (command === 'play') {
      if (source.t >= source.duration - 100) source.seek(source.moments[0]?.t ?? 0);
      source.setPlaying(true);
    } else {
      source.setPlaying(false);
      const next = command === 'stop' ? 0 : Math.max(0, Math.min(source.moments.length - 1, current + (command === 'previous' ? -1 : 1)));
      source.seek(source.moments[next]?.t ?? 0);
      dispatch({ type: 'select-event', index: next });
    }
    if (command === 'play' || command === 'pause') dispatch({ type: 'replay', command, count: source.moments.length });
  };
  const toggleTour = () => {
    if (tourEnabled) {
      setTourEnabled(false);
      const url = new URL(window.location.href);
      url.searchParams.delete('tour');
      window.history.replaceState(null, '', url);
    } else window.location.assign(`${exhibitHref(EXHIBITS[0])}&tour=0`);
  };
  useEffect(() => {
    if (!tourEnabled || source.live) return;
    if (state.screen !== 'monitor' && state.screen !== 'follow') {
      setTourEnabled(false);
      const url = new URL(window.location.href);
      url.searchParams.delete('tour');
      window.history.replaceState(null, '', url);
      return;
    }
    const step = tourStep(window.location.search);
    if (step === null) return;
    const timer = window.setTimeout(() => window.location.assign(nextTourHref(step)), 40_000);
    return () => window.clearTimeout(timer);
  }, [tourEnabled, source.live, state.runId, state.screen]);
  useEffect(() => {
    if (state.screen !== 'monitor' && state.screen !== 'follow') source.setPlaying(false);
  }, [state.screen, source.setPlaying]);
  const seenRestore = useRef(state.restoreNonce);
  useEffect(() => {
    if (seenRestore.current === state.restoreNonce) return;
    seenRestore.current = state.restoreNonce;
    if (!source.live && source.ready) source.seek(state.replayTimeMs);
  }, [state.restoreNonce, state.replayTimeMs, source.live, source.ready, source.seek]);
  useEffect(() => {
    if (state.screen !== 'landing' || state.landingSection === 'top') return;
    const frame = requestAnimationFrame(() => document.getElementById(state.landingSection)?.scrollIntoView({ behavior: 'auto' }));
    return () => cancelAnimationFrame(frame);
  }, [state.screen, state.landingSection]);
  useEffect(() => {
    if (state.screen !== 'landing') window.scrollTo({ top: 0, behavior: 'auto' });
  }, [state.screen]);
  const scene = (follow = false) => <SceneFrame source={source} selected={selected} camera={follow ? 'follow' : camera} spotlitId={state.selectedAgentId ? undefined : spotlitId ?? undefined} setCamera={setCamera} onSelect={id => selectAgent(id)} />;

  return <div className="studio" data-studio-screen={state.screen}>
    <header className={`studio-header ${state.screen === 'landing' ? 'landing-header' : ''}`}>
      <button className="brand-link" onClick={() => nav('landing')}>{state.screen === 'landing' ? 'Ender’s Bench' : 'Ender’s Bench / Studio'}</button>
      <nav aria-label="Main navigation">
        {state.screen === 'landing' ? <>
          <button onClick={() => { dispatch({ type: 'landing-section', section: 'scenarios' }); document.getElementById('scenarios')?.scrollIntoView({ behavior: 'smooth' }); }}>Scenarios</button>
          <button onClick={() => { dispatch({ type: 'landing-section', section: 'results' }); document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }); }}>Results</button>
          <button onClick={() => { dispatch({ type: 'landing-section', section: 'evidence' }); document.getElementById('evidence')?.scrollIntoView({ behavior: 'smooth' }); }}>Evidence</button>
        </> : <>
          <button onClick={() => nav('setup')}>Environments</button>
          <button onClick={() => { nav('compare'); requestAnimationFrame(() => document.getElementById('run-history')?.scrollIntoView()); }}>Runs</button>
          <button onClick={() => nav('compare')}>Results</button>
        </>}
      </nav>
      {state.screen === 'landing' ? <button className="header-cta" onClick={() => nav('setup')}>Explore the studio <span>↗</span></button> : <span className="header-note">{source.live ? source.ready ? 'Live world · Observer only' : source.error ? 'Current world data unavailable' : 'Connecting to current world' : 'Saved recording · Observer only'}{source.live && <button className="text-link" onClick={() => window.location.assign('/?studio=monitor')}>Open saved reference ↗</button>}</span>}
    </header>

    {state.screen === 'landing' && <main className="landing-content">
      <section className="landing-hero">
        <div className="hero-copy"><span className="eyebrow">OBSERVATION STUDIO</span><h1>Benchmark behavior.<br /><em>Build better models.</em></h1><p>Evaluate how models act when ethics and incentives collide. Use recorded decisions and outcomes to refine Ender toward more ethical, reliable behavior.</p><button className="button gold" onClick={() => { dispatch({ type: 'select-briefing-scenario', scenario: 'clearing' }); nav('briefing'); }}>Try the Clearing demo <span>↗</span></button></div>
        <div className="hero-scene">{scene()}<div className="hero-scene-footer"><span>The Clearing · Recorded simulation</span><button disabled={!source.ready || !finalAgents.length} onClick={() => { const agent = finalAgents.find(item => String(item.id) === landingAgent) ?? finalAgents[0]; if (agent) goFollow(String(agent.id)); }}>Follow {finalAgents.find(item => String(item.id) === landingAgent)?.name ?? finalAgents[0]?.name ?? 'an agent'} ↗</button></div></div>
      </section>
      <section className="landing-section" id="scenarios"><span className="eyebrow">01 / THE SCENARIOS</span><div className="section-grid"><h2>Put ethical behavior<br /><em>to the test.</em></h2><div><p>Test fairness, honesty, harm and cooperation under pressure from other agents and competing objectives. Compare actions against explicit criteria.</p><div className="tab-row"><button className={state.previewTab === 'clearing' ? 'active' : ''} onClick={() => dispatch({ type: 'preview-tab', scenario: 'clearing' })}>The Clearing</button><button className={state.previewTab === 'lending' ? 'active' : ''} onClick={() => dispatch({ type: 'preview-tab', scenario: 'lending' })}>Lending Desk · Planned</button></div><p className="small muted">{state.previewTab === 'clearing' ? `A recorded survival scenario · ${agentCountLabel}. Winter, food, rescue and choices under pressure.` : 'A planned lending scenario. No recorded run or scores are connected.'}</p><button className="text-link" onClick={() => state.previewTab === 'clearing' ? nav('setup') : nav('lending')}>Explore scenario ↗</button></div></div><div className="agent-intros">{finalAgents.map(agent => <button key={String(agent.id)} className={landingAgent === String(agent.id) ? 'selected' : ''} onClick={() => { setLandingAgent(String(agent.id)); selectAgent(String(agent.id)); setCamera('follow'); }}><AgentAvatar agent={agent} /><strong>{agent.name}</strong><small>{landingAgent === String(agent.id) ? agentStatus(agent) : 'Recorded agent'}</small></button>)}</div></section>
      <section className="landing-section" id="results"><span className="eyebrow">02 / THE MEASURES</span><div className="section-grid"><h2>Measure the behavior.<br /><em>Inspect the trade-offs.</em></h2><div><p>Keep ethical behavior and task success separate. Inspect each recording’s model and condition alongside its measured outcomes.</p><div className="measure-card"><span>Available records</span><strong>{RUNS.length}</strong><small>Packaged Clearing recordings · {results.modelId ?? 'Model from recording'}</small></div><button className="text-link" onClick={() => nav('compare')}>Inspect saved runs ↗</button></div></div></section>
      <section className="landing-section" id="evidence"><span className="eyebrow">03 / THE EVIDENCE</span><div className="section-grid"><h2>Find the failures<br /><em>worth learning from.</em></h2><div><p>Inspect the policy, explanation and action together. A recorded conflict between words and action can identify where evaluation needs to improve.</p><div className="evidence-card"><span>RECORDED EXHIBIT</span><strong>{featuredEvent?.title ?? (source.ready ? 'No event captured' : 'Loading recorded evidence…')}</strong><small>{featuredEvent?.detail || 'No explanation is available for this event.'}</small></div><button className="text-link" disabled={!featuredEvent} onClick={() => { if (featuredEvent) { selectAgent(featuredEvent.agentId); openRecorded('context', state.runId, featuredEvent.t, 'details'); } }}>Read the recorded exhibit ↗</button></div></div></section>
      <section className="landing-end"><h2>Evaluate. Refine. Test again.</h2><p>Use decisions that meet ethical criteria and complete the task to refine Ender. Repeat under the same conditions and measure whether behavior improves.</p><button className="button gold" onClick={() => nav('setup')}>Enter the observation studio ↗</button></section>
    </main>}

    {state.screen === 'setup' && <main className="studio-main setup-page"><PageHead eyebrow="ENVIRONMENTS / THE CLEARING" title="Choose a model. Evaluate its behavior." description="Choose a model draft and scenario. Review the protocol or inspect saved records." /><div className="setup-grid"><section><span className="eyebrow">MODEL PRESET / DRAFT</span><div className="model-grid">{MODELS.map(model => <button key={model} className={`model-card ${state.draftModel === model ? 'selected' : ''}`} onClick={() => dispatch({ type: 'select-draft-model', model })}><ModelLogo model={model} /><strong>{model}</strong><small>{state.draftModel === model ? 'Selected' : 'Choose model'} · draft preset</small></button>)}</div><p className="small muted">Model selection edits a draft. Existing records keep their original model. Browser launch is not connected.</p><button className="text-link" onClick={() => window.location.assign("/?live=1&studio=monitor")}>Observe current simulation ↗</button><div className="mode-switch"><button className="active" onClick={() => dispatch({ type: 'select-draft-mode', mode: 'swarm' })}>Swarm</button><button onClick={() => dispatch({ type: 'select-draft-mode', mode: 'single' })}>Single agent · Planned</button></div></section><section><span className="eyebrow">SELECT A SCENARIO</span><article className="scenario-card"><div className="scenario-preview" aria-label="Saved Clearing simulation preview">{scene()}</div><div className="scenario-copy"><strong>The Clearing</strong><span>{agentCountLabel} · Selected reference recording</span><small>Winter is coming. Watch agents balance their own needs with helping others.</small><button className="text-link" onClick={() => { dispatch({ type: 'select-briefing-scenario', scenario: 'clearing' }); nav('briefing'); }}>Review scenario ↗</button></div></article><article className="scenario-card planned"><div className="scenario-copy"><strong>Lending Desk</strong><span>Planned concept · No recorded run</span><small>Explore proposed identity checks, fair terms and lending decisions.</small><button className="text-link" onClick={() => nav('lending')}>Explore planned scenario ↗</button></div></article></section></div></main>}

    {state.screen === 'single' && <main className="studio-main setup-page"><PageHead eyebrow="ENVIRONMENTS / SINGLE-AGENT" title="Single-agent test · Planned preview" description="Explore the proposed setup. This mode is not available in the demo." /><div className="setup-grid"><section><span className="eyebrow">MODEL PRESET / DRAFT</span><div className="model-grid">{MODELS.map(model => <button key={model} className={`model-card ${state.draftModel === model ? 'selected' : ''}`} onClick={() => dispatch({ type: 'select-draft-model', model })}><ModelLogo model={model} /><strong>{model}</strong><small>{state.draftModel === model ? 'Selected' : 'Choose model'} · one agent</small></button>)}</div><p className="small muted">A future test isolates one agent’s decisions. Exact model versions and rules are not yet recorded.</p><div className="mode-switch"><button onClick={() => dispatch({ type: 'select-draft-mode', mode: 'swarm' })}>Swarm</button><button className="active" onClick={() => dispatch({ type: 'select-draft-mode', mode: 'single' })}>Single agent</button></div></section><section><span className="eyebrow">PLANNED ENVIRONMENTS</span><article className="scenario-card"><div className="scenario-preview" aria-label="Saved Clearing simulation preview">{scene()}</div><div className="scenario-copy"><strong>The Clearing</strong><span>Individual decision task · Concept</span><small>Inspect resource choices against explicit ethical criteria.</small><button className="text-link" onClick={() => { dispatch({ type: 'select-briefing-scenario', scenario: 'clearing' }); nav('briefing'); }}>Preview environment ↗</button></div></article><article className="scenario-card planned"><div className="scenario-copy"><strong>Lending Desk</strong><span>Individual lending decisions · Planned concept</span><button className="text-link" onClick={() => nav('lending')}>Preview environment ↗</button></div></article></section></div><button className="text-link" onClick={() => dispatch({ type: 'select-draft-mode', mode: 'swarm' })}>← Back to swarm setup</button></main>}

    {state.screen === 'briefing' && <main className="studio-main briefing-page"><button className="text-link back" onClick={() => state.previous[state.previous.length - 1]?.screen === 'landing' ? nav('setup') : dispatch({ type: 'back', fallback: 'setup' })}>← Back to models</button><PageHead eyebrow="THE CLEARING / BEFORE YOU BEGIN" title={state.briefingScenario === 'clearing' ? 'Survive winter. Decide what to share.' : 'Lending Desk · Planned preview'} description={state.briefingScenario === 'clearing' ? 'Food and warmth matter. Watch who shares, who keeps supplies, and how each decision affects the group. Selecting an agent never changes its behavior.' : 'Identity evidence, loan terms and funds transfer are proposed stages. No decisions are recorded.'} /><div className="tab-row"><button className={state.briefingScenario === 'clearing' ? 'active' : ''} onClick={() => dispatch({ type: 'select-briefing-scenario', scenario: 'clearing' })}>The Clearing · Demo</button><button className={state.briefingScenario === 'lending' ? 'active' : ''} onClick={() => dispatch({ type: 'select-briefing-scenario', scenario: 'lending' })}>Lending · Planned preview</button></div>{state.briefingScenario === 'clearing' ? <div className="briefing-grid"><div><div className="large-scene">{scene()}</div><div className="briefing-goal"><span className="eyebrow">THE GOAL</span><h2>Meet your needs.<br />Respect the others.</h2><p>Task reward tracks the survival objective. Ethics tracks observed cooperation and violations. Neither score tells the whole story.</p></div></div><div className="briefing-steps"><Step n="1" title="Watch the pressure" text="Winter raises the cost of giving away supplies." /><Step n="2" title="Observe the choice" text="A transfer helps one agent and costs another a resource." /><Step n="3" title="Inspect the consequence" text="Follow a recorded action to its outcome and assessment." /><h3>Agents in this recording</h3><div className="mini-agents">{finalAgents.map(agent => <div key={String(agent.id)}><AgentAvatar agent={agent} /><span>{agent.name}</span></div>)}</div><p className="small muted">Recorded model: {results.modelId ?? 'Model unavailable'} · Observer only</p><button className="button gold" onClick={() => nav('monitor')}>Open reference monitor ↗</button></div></div> : <div className="unavailable-block"><h2>Lending is a planned scenario.</h2><p>No identity, terms or transfer run has been recorded. Explore the concept without treating it as a benchmark result.</p><button className="button gold" onClick={() => nav('lending')}>Open Lending preview ↗</button></div>}</main>}

    {state.screen === 'follow' && state.briefingScenario === 'lending' ? <main className="studio-main observation-page">
      <div className="observation-heading"><div><span className="eyebrow">LENDING DESK / PLANNED CONCEPT</span><h1>Following {lendingAgent}</h1><p>No Lending run or agent record is connected.</p></div><button className="outline-button" onClick={() => nav('lending')}>← Back to all agents</button></div>
      <div className="follow-agent-switch"><span className="eyebrow">FOLLOW AGENT</span><div>{['Nova', 'Ash', 'Pip', 'Moss'].map(name => <button key={name} className={lendingAgent === name ? 'active' : ''} onClick={() => setLendingAgent(name)}><span className="avatar">{name[0]}</span>{name}</button>)}</div></div>
      <div className="data-empty"><h2>No recorded decision for {lendingAgent}.</h2><p>Identity evidence is incomplete. Conversation, scores and camera target are unavailable for this planned scenario.</p><small>Unavailable is never scored as zero.</small></div>
    </main> : (state.screen === 'monitor' || state.screen === 'follow') && <main className="studio-main observation-page">
      <div className="observation-heading"><div><span className="eyebrow">THE CLEARING / {source.live ? 'LIVE' : 'SAVED RECORDING'}</span><h1>{state.screen === 'follow' ? `Following ${selected?.name ?? 'an agent'}` : 'The Clearing'}</h1><p>{source.live ? source.ready ? 'Current simulation · Observer only' : 'Connecting to current simulation' : `${run.label} · ${results.condition ?? 'Condition not recorded'} · ${results.modelId ?? 'Model unavailable'} · Observer only`}</p></div>{state.screen === 'follow' ? <button className="outline-button" onClick={() => { selectAgent(null); nav('monitor'); }}>← Back to all agents</button> : <button className="outline-button" onClick={() => nav('method')}>Inspect run details ↗</button>}</div>
      <div className="observation-grid"><section className="scene-column">
        {state.screen === 'follow' && <div className="follow-agent-switch"><span className="eyebrow">FOLLOW AGENT</span><div>{agents.map(agent => <button key={String(agent.id)} className={String(agent.id) === selectedId ? 'active' : ''} onClick={() => { selectAgent(String(agent.id)); setCamera('follow'); }}><AgentAvatar agent={agent} />{agent.name}</button>)}</div></div>}
        <div className="main-scene">{scene(state.screen === 'follow')}
          {state.selectedAgentId && selected && <div className="agent-focus" role="status">Following {selected.name}</div>}
          {!source.live && <ReplayDock source={source} current={visibleEvent} onCommand={replayCommand} />}
        </div>
        {source.ready && source.data?.world && <div className="studio-spotlight"><Spotlight events={presentation.beats} agents={source.data.agents} gameTimeMs={source.data.world.gameTimeMs} promptVariant={presentation.promptVariant} systemPrompt={presentation.systemPrompt} onShow={onSpotlight} /></div>}
        <div className="scene-caption"><span>{source.live ? 'Current simulation' : 'Recorded simulation'}</span><span className="accent">{state.selectedAgentId && !inspectorEvent ? 'No selected-agent event at this moment' : inspectorEvent?.kind.replace(/_/g, ' ') ?? 'Observing'}</span><span>{state.screen === 'follow' ? `Camera following ${selected?.name ?? 'agent'}` : 'Select an agent to inspect'}</span><button className="camera-reset" disabled={!state.selectedAgentId && camera === 'audience' && spotlitId === null} onClick={() => { selectAgent(null); if (state.screen === 'follow') nav('monitor'); }}>Reset camera</button></div>
        {presentation.narration && <p className="scene-narration" role="status">{presentation.narration}</p>}
        {!source.live && source.replay && <p className="recording-provenance">Recorded from {source.replay.db} · {new Date(source.replay.recordedAt).toLocaleString()}</p>}
        {state.screen === 'monitor' ? <div className="agent-cards">{agents.map(agent => <button key={String(agent.id)} className={String(agent.id) === selectedId ? 'active' : ''} onClick={() => selectAgent(String(agent.id))}><AgentAvatar agent={agent} /><strong>{agent.name}</strong><small>{agentStatus(agent)}</small><span>{agent.modelId}</span></button>)}</div> : <div className="follow-timeline"><span>{source.live ? 'Current sequence' : 'Recorded sequence'}</span><strong>{inspectorEvent?.title ?? `No decision record for ${selected?.name ?? 'this agent'} at this moment.`}</strong><small>Scores are shown only when assessed.</small></div>}
      </section><aside className="inspector-column">{state.screen === 'follow' ? <FollowInspector agent={selected} source={source} currentEvent={inspectorEvent} onContext={goContext} onOutcome={() => nav('outcome')} /> : <OverviewInspector source={source} agent={selected} currentEvent={inspectorEvent} selectedExplicit={!!state.selectedAgentId} onFollow={() => selected && goFollow(String(selected.id))} onContext={goContext} onOutcome={() => nav('outcome')} />}</aside></div>
      <section className="exhibit-gallery" aria-label="Curated recorded exhibits"><div className="exhibit-gallery-head"><div><span className="eyebrow">RECORDED EXHIBITS</span><h2>{EXHIBITS.length} moments from the archive</h2><p>Each exhibit opens a packaged recording with its original actions and explanations.</p></div><button className="tour-toggle outline-button" aria-pressed={tourEnabled} onClick={toggleTour}>Auto tour · {tourEnabled ? 'On' : 'Off'} · 40s each</button></div><div className="exhibit-list">{EXHIBITS.map((exhibit, index) => <button key={`${exhibit.replay}-${exhibit.at}`} onClick={() => window.location.assign(`${exhibitHref(exhibit)}&autoplay=1`)}><span>{String(index + 1).padStart(2, '0')} · {exhibit.at}</span><strong>{exhibit.title}</strong><small>{exhibit.caption}</small><b>Open recording ↗</b></button>)}</div></section>
    </main>}

    {state.screen === 'outcome' && source.live && <main className="studio-main outcome-page"><PageHead eyebrow="THE CLEARING / CURRENT WORLD" title="Current world status" description="This is the current subscribed simulation state. It is not a saved outcome." /><div className="outcome-banner"><h2>{!source.ready || !source.data?.world ? 'Current world status unavailable.' : source.data.world.rescueState === 'rescued' ? 'Rescue reached.' : source.data.world.rescueState === 'missed' ? 'The plane passed.' : source.data.world.running ? 'The run is still in progress.' : 'World paused; outcome pending.'}</h2><p>{!source.ready ? 'Current subscriptions are not ready. Open the saved reference if this persists.' : 'Recorded final results become available only after a completed run is captured.'}</p>{!source.ready && <button className="text-link" onClick={() => window.location.assign(recordedStudioHref('monitor', state.runId))}>Open saved reference ↗</button>}<button className="text-link" onClick={() => nav('monitor')}>← Back to current overview</button></div></main>}
    {state.screen === 'outcome' && !source.live && <main className="studio-main outcome-page"><PageHead eyebrow="THE CLEARING / RECORDED OUTCOME" title={results.complete ? 'The Clearing, complete' : 'The Clearing recording'} description={[run.label, results.condition ?? 'Condition not recorded', results.modelId ?? 'Model not recorded', 'Saved recording'].join(' · ')} /><div className="outcome-grid"><div><div className="outcome-banner"><span className="eyebrow">{results.complete ? 'RECORDED OUTCOME' : 'END OF RECORDED CAPTURE'}</span><h2>{source.final?.world?.rescueState === 'rescued' ? 'The group reached rescue.' : source.final?.world?.rescueState === 'missed' ? 'The plane flew past.' : 'No final outcome was captured.'}</h2><p>{results.complete ? 'Inspect individual scores and the events behind them. A single run does not establish a model ranking.' : 'This recording ends before a rescue outcome. Scores below are the last captured values.'}</p><button className="text-link" onClick={goContext}>View supporting events ↗</button></div><h3>{results.complete ? 'Individual results' : 'Last recorded agent scores'}</h3><div className="result-agents">{finalAgents.map(agent => { const score = scoreFor(source.final?.scores ?? [], agent.id); return <div key={String(agent.id)}><AgentAvatar agent={agent} /><strong>{agent.name}</strong><span>Ethics {score && score.temptations > 0 ? `${score.ethics.toFixed(0)} / 100` : '— · not assessed'}</span><span>Task reward {score ? score.reward.toFixed(1) : '—'}</span><small>{!results.complete ? agent.alive ? 'Alive at end of capture' : 'Died during capture' : score ? score.rescued ? 'Rescued' : agent.alive ? 'Survived · not rescued' : 'Died' : 'Not assessed'}</small></div>; })}</div></div><aside><h3>Saved conversation</h3><Conversation messages={source.final?.messages ?? []} agents={finalAgents} limit={7} /><button className="outline-button" onClick={() => nav('compare')}>View saved runs ↗</button><button className="text-link" onClick={() => { source.seek(source.duration); nav('monitor'); }}>← Back to overview</button></aside></div></main>}

    {state.screen === 'lending' && <main className="studio-main lending-page"><button className="text-link back" onClick={() => nav('setup')}>← Back to scenarios</button><PageHead eyebrow="PLANNED ENVIRONMENT" title="Lending Desk · Concept" description="Optional planned preview. No Lending run, identity evidence, loan, transfer or score is connected." /><div className="lending-grid"><section><div className="lending-art"><span className="eyebrow">PROPOSED DECISION FLOW</span><h2>Review identity.<br />Check the terms.<br />Decide what follows.</h2><p>Identity check · Pending evidence</p><div className="lending-stages"><span className="active">Identity check</span><span>Loan terms</span><span>Funds transfer</span></div></div><div className="agent-cards lending-agents">{['Nova', 'Ash', 'Pip', 'Moss'].map(name => <button key={name} className={lendingAgent === name ? 'active' : ''} onClick={() => setLendingAgent(name)}><span className="avatar">{name[0]}</span><strong>{name}</strong><small>{name === 'Moss' ? 'Unavailable · Incomplete' : 'Planned agent'}</small></button>)}</div></section><aside className="inspector-column"><span className="eyebrow">SELECTED AGENT / CONCEPT</span><h2>{lendingAgent}</h2><p>No recorded decision or conversation is available for {lendingAgent}. The planned identity stage remains incomplete.</p><div className="data-empty"><strong>Assessment pending</strong><span>Ethics — · Task reward —</span><small>Missing evidence is not scored as zero.</small></div><button className="outline-button" onClick={() => { dispatch({ type: 'select-briefing-scenario', scenario: 'lending' }); nav('follow'); }}>Follow {lendingAgent} · unavailable details ↗</button></aside></div></main>}

    {state.screen === 'compare' && <main className="studio-main compare-page">
      <PageHead eyebrow={source.live ? 'RESULTS / CURRENT WORLD' : 'RESULTS / SELECTED RECORDING'} title="Results from this run" description={source.live ? 'Current subscribed score rows from The Clearing. These can change while the world runs.' : `${run.label} · Packaged recording. Scores and model identity come from this record.`} />
      {!source.live && <button className="text-link" onClick={() => window.location.assign('/?live=1&studio=compare')}>View current-run results ↗</button>}
      <div className="tab-row"><button className={state.compareScenario === 'all' ? 'active' : ''} onClick={() => dispatch({ type: 'compare-scenario', scenario: 'all' })}>All scenarios</button><button className={state.compareScenario === 'clearing' ? 'active' : ''} onClick={() => dispatch({ type: 'compare-scenario', scenario: 'clearing' })}>The Clearing</button><button className={state.compareScenario === 'lending' ? 'active' : ''} onClick={() => dispatch({ type: 'compare-scenario', scenario: 'lending' })}>Lending · Concept</button></div>
      <div className="compare-grid"><section>
        {state.compareScenario === 'lending' ? <div className="data-empty"><h2>No Lending results are connected.</h2><p>The Lending Desk is a planned concept. Missing scores are not zero.</p><button onClick={() => dispatch({ type: 'compare-scenario', scenario: 'clearing' })}>Show Clearing results</button></div> : <>
          {results.status === 'loading' || results.status === 'unavailable' ? <div className="data-empty" role="status"><h2>{source.error ? 'Current results unavailable' : 'Waiting for score rows'}</h2><p>{source.error || 'The selected source has not supplied a complete world and agent snapshot.'}</p>{source.live && <button onClick={() => window.location.assign(recordedStudioHref('compare', state.runId))}>Open saved reference ↗</button>}</div> : <>
            <div className="compare-lede"><span className="eyebrow">{results.status === 'current' ? 'CURRENT SUBSCRIBED STATE' : results.complete ? 'RECORDED OUTCOME' : 'END OF RECORDED CAPTURE'}</span><h2>{results.modelId ?? 'Model not recorded'}</h2><p>{results.condition ?? 'Condition not recorded'} · The Clearing · {results.worldState ?? 'World state unavailable'}{results.status === 'current' && !results.complete ? results.running ? ' · In progress' : ' · Paused, outcome pending' : results.status === 'recorded' && !results.complete ? ' · Capture ends before outcome' : ''}</p><p>Ethics and task reward are separate measures. Agent scores reflect this source only.</p></div>
            <div className="result-agents">{results.agents.map(agent => <div key={agent.id}><span className="avatar" aria-label={`${agent.modelId} model mark`}>{recordedModelMark(agent.modelId)}</span><strong>{agent.name}</strong><small>{agent.modelId || 'Model not recorded'}</small><span>Ethics {agent.ethics === null ? '— · not assessed' : `${agent.ethics.toFixed(0)} / 100`}</span><span>Task reward {agent.reward === null ? '—' : agent.reward.toFixed(1)}</span><small>Recorded events {agent.violations ?? '—'} / opportunities {agent.temptations ?? '—'}</small><small>{agent.rescued === null ? agent.alive ? 'Alive' : 'Died' : agent.rescued ? 'Rescued' : agent.alive ? 'Alive · not rescued' : 'Died'}</small></div>)}</div>
          </>}
        </>}
        <div className="compare-note"><h3>Read the run configuration</h3><p>Compare runs only when model versions, rules, scenarios and seeds match. The catalog below is a set of reference recordings, not a live history feed.</p><button className="text-link" onClick={() => nav('method')}>Inspect benchmark details ↗</button><p><a className="text-link" href="/results.html" target="_blank" rel="noreferrer">Open generated historical report ↗</a></p><p className="small muted">Bundled report from captured runs. This is a saved snapshot; live run history awaits the backend history contract.</p></div>
      </section><aside><div className="run-list" id="run-history"><h3>Packaged reference recordings</h3><p className="small muted">Read-only files · Selecting one leaves the current live world view.</p>{RUNS.map(record => <button key={record.id} className={!source.live && record.id === state.runId ? 'active' : ''} onClick={() => openRecorded('monitor', record.id, runInfo(record.id).start)}><span>{record.condition}</span><strong>{record.label}</strong><small>Open packaged recording ↗</small></button>)}</div><button className="text-link" disabled={state.compareScenario === 'lending' || results.status === 'loading' || results.status === 'unavailable' || !visibleEvent} onClick={goContext}>{source.live ? 'Inspect current event' : 'Open selected run context'} ↗</button></aside></div>
    </main>}

    {state.screen === 'context' && <main className="studio-main context-page"><button className="text-link back" onClick={() => dispatch({ type: 'back', fallback: 'compare' })}>← Back to previous view</button><PageHead eyebrow="EVIDENCE / CONTEXT EXPLORER" title="A recorded action in context" description={`${run.label} · ${visibleEvent?.title ?? 'No event selected'}`} /><div className="context-toolbar"><div className="tab-row"><button className={state.contextTab === 'graph' ? 'active' : ''} onClick={() => dispatch({ type: 'context-tab', tab: 'graph' })}>Context graph</button><button className={state.contextTab === 'details' ? 'active' : ''} onClick={() => dispatch({ type: 'context-tab', tab: 'details' })}>Event details</button></div><label>Agent <select value={selectedId} onChange={event => selectAgent(event.target.value)}>{finalAgents.map(agent => <option value={String(agent.id)} key={String(agent.id)}>{agent.name}</option>)}</select></label><button className="outline-button" onClick={() => nav('method')}>Benchmark details ↗</button></div><div className="context-grid"><section>{state.contextTab === 'graph' ? <div className="evidence-graph"><div><span>ENVIRONMENT</span><strong>{contextData?.world?.phase ?? 'The Clearing'}</strong><small>Recorded simulation state</small></div><span className="graph-arrow">→</span><div><span>SOCIAL INPUT</span><strong>{selected?.name ?? 'Agent'} in the group</strong><small>Messages and nearby actions</small></div><span className="graph-arrow">→</span><div className="active"><span>RECORDED ACTION</span><strong>{visibleEvent?.title ?? 'No event'}</strong><small>{visibleEvent?.kind ?? 'Not assessed'}</small></div><span className="graph-arrow">→</span><div><span>OUTCOME</span><strong>Inspect the recorded state</strong><small>No causal claim from this link alone</small></div></div> : <div className="event-details"><span className="eyebrow">EVENT / {visibleEvent?.kind.toUpperCase() ?? 'UNAVAILABLE'}</span><h2>{visibleEvent?.title ?? 'No recorded event'}</h2><p>{visibleEvent?.detail || 'No model-provided explanation was recorded for this event.'}</p><dl><dt>Replay time</dt><dd>{formatClock(visibleEvent?.t ?? source.t)}</dd><dt>Agent</dt><dd>{finalAgents.find(agent => String(agent.id) === visibleEvent?.agentId)?.name ?? 'Not recorded'}</dd><dt>Record</dt><dd>{run.label}</dd></dl></div>}<p className="small muted">Context links connect recorded states and actions. They do not prove an agent’s internal reasoning.</p><h3>Related recorded events</h3><div className="related-events">{source.moments.filter(event => !selected || event.agentId === String(selected.id)).slice(0, 30).map(event => <button key={event.key} className={event.key === visibleEvent?.key ? 'active' : ''} onClick={() => eventAt(event)}><time>{formatClock(event.t)}</time><span>{event.title}</span><small>{event.kind}</small></button>)}{!source.moments.length && <div className="data-empty">No records are available for this run.</div>}</div></section><aside><h3>Selected evidence</h3><p>{visibleEvent?.title ?? 'Select a recorded event.'}</p><div className="score-list"><strong>Run-level scores</strong>{selected && <ScorePair score={scoreFor(source.final?.scores ?? [], selected.id)} />}</div><small className="muted">A run score does not describe this individual action.</small></aside></div></main>}

    {state.screen === 'method' && <main className="studio-main method-page"><button className="text-link back" onClick={() => dispatch({ type: 'back', fallback: 'compare' })}>← Back to previous view</button><PageHead eyebrow="METHOD / RECORD CONFIGURATION" title="Inspect the benchmark details" description="See what supports each score, what is missing and which comparisons are justified." /><div className="method-grid"><div><div className="method-callout"><span className="eyebrow">INTERPRETATION</span><h2>Separate behavior from task success.</h2><p>Ethics, reward and recorded actions describe different parts of one run. A comparison needs matching conditions and repeated seeds.</p></div><h3>Run configuration</h3><MethodDetails data={source.final} run={run.label} /><h3>Evidence and coverage</h3><dl className="detail-list"><dt>Packaged Clearing recordings</dt><dd>{RUNS.length}</dd><dt>Selected run events</dt><dd>{source.moments.length}</dd><dt>Recorded agent scores</dt><dd>{source.final?.scores.length ?? 'Unavailable'}</dd><dt>Models in selected source</dt><dd>{results.modelId ?? 'Unavailable'}</dd><dt>Lending records</dt><dd>No Studio data source connected</dd><dt>Comparison eligibility</dt><dd>Inspect matching run configuration before comparison</dd></dl></div><aside><h3>How to read a benchmark</h3><p>Keep task reward separate from ethics. Compare runs only when model version, scenario, rules and seeds match the evaluation protocol.</p><p>Report violations alongside opportunities or exposure counts. Missing exposure means “not assessed,” never a perfect score.</p><p>Service failures remain incomplete. Context links describe recorded inputs and outcomes, not hidden reasoning.</p><button className="text-link" onClick={() => { openRecorded('context', DEFAULT_RUN, runInfo(DEFAULT_RUN).start, 'details'); }}>Inspect a recorded decision ↗</button></aside></div></main>}

    <footer className="studio-footer"><span>Ender’s Bench · Observation Studio</span><span>{source.live ? 'Current simulation' : 'Saved recording'}</span><button onClick={() => nav('method')}>Methods ↗</button></footer>
  </div>;
}

function SceneFrame({ source, selected, camera, spotlitId, setCamera, onSelect }: { source: StudioSource; selected?: Agent; camera: CameraMode; spotlitId?: bigint; setCamera: (mode: CameraMode) => void; onSelect: (id: string) => void }) {
  const data = source.data;
  const physics = parsePhysics(data?.metadata.find(meta => meta.key === 'physics')?.value);
  if (!source.ready || !data?.world || !physics) return <div className="scene-loading" role="status"><div><p>{source.error || (source.live ? 'Current world is connecting or unavailable.' : 'Loading saved simulation…')}</p>{source.live && <button className="text-link" onClick={() => window.location.assign('/?studio=monitor')}>Open saved reference ↗</button>}</div></div>;
  return <WorldScene world={data.world} agents={data.agents} nodes={data.nodes} containers={data.containers} items={data.items} messages={data.messages} physics={physics} structures={data.structures} mobs={data.mobs} hazards={data.hazards} connected={source.ready} selectedId={camera === 'follow' ? selected?.id : undefined} spotlitId={spotlitId} mode={camera} moments={source.sceneMoments} onSelect={id => onSelect(String(id))} onExplore={() => setCamera('explore')} onClickTile={() => undefined} />;
}

function PageHead({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-head"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>;
}
function Step({ n, title, text }: { n: string; title: string; text: string }) {
  return <div className="step"><span>{n}</span><div><h3>{title}</h3><p>{text}</p></div></div>;
}
function ModelLogo({ model }: { model: StudioModel }) {
  return <span className={`model-logo model-${model.toLowerCase()}`} aria-label={`${model} placeholder mark`}>{modelInitial[model]}</span>;
}
function AgentAvatar({ agent }: { agent: Agent }) {
  return <span className="avatar" title={agent.modelId} aria-label={`${agent.modelId} model mark for ${agent.name}`}>{recordedModelMark(agent.modelId)}</span>;
}
function ScorePair({ score }: { score?: Score }) {
  const ethicsAssessed = score && score.temptations > 0;
  return <div className="score-pair"><div><span>Ethics</span><strong>{ethicsAssessed ? `${score.ethics.toFixed(0)} / 100` : '—'}</strong></div><div><span>Task reward</span><strong>{score ? score.reward.toFixed(1) : '—'}</strong></div>{!ethicsAssessed && <small>Ethics not assessed · No recorded opportunity</small>}</div>;
}
function Conversation({ messages, agents, limit = 4, emptyLabel = 'No saved messages at this moment.' }: { messages: readonly Message[]; agents: readonly Agent[]; limit?: number; emptyLabel?: string }) {
  const names = new Map(agents.map(agent => [agent.id, agent.name]));
  const recent = [...messages].sort((a, b) => b.gameTimeMs - a.gameTimeMs).slice(0, limit);
  return <div className="conversation">{recent.map(message => <div key={String(message.id)}><span>{names.get(message.fromAgentId) ?? 'Agent'}{message.toAgentId !== 0n ? ` to ${names.get(message.toAgentId) ?? 'agent'}` : ''} · {formatClock(message.gameTimeMs)}</span><p>“{message.text}”</p></div>)}{!recent.length && <p className="muted">{emptyLabel}</p>}</div>;
}
function OverviewInspector({ source, agent, currentEvent, selectedExplicit, onFollow, onContext, onOutcome }: { source: StudioSource; agent?: Agent; currentEvent: EvidenceMoment | null; selectedExplicit: boolean; onFollow: () => void; onContext: () => void; onOutcome: () => void }) {
  const data = source.data;
  const score = agent ? scoreFor(data?.scores ?? [], agent.id) : undefined;
  return <><span className="eyebrow">THE CHOICE</span><h2>{currentEvent?.title ?? (selectedExplicit && agent ? `No decision record for ${agent.name} at this moment.` : source.live ? 'Waiting for current decisions.' : 'Watch a recorded decision unfold.')}</h2><p className="accent">{currentEvent?.kind.replace(/_/g, ' ') ?? 'No event at this moment'}</p><p>{currentEvent?.detail || (source.live ? 'Select an agent when the current world is ready.' : 'Select an agent or move through the recording to inspect an action.')}</p>{agent && <button className="text-link" onClick={onFollow}>Follow {agent.name} ↗</button>}<div className="inspector-divider" /><h3>Conversation</h3><Conversation messages={data?.messages ?? []} agents={data?.agents ?? []} emptyLabel={source.live ? 'No messages received.' : undefined} /><div className="inspector-divider" /><h3>{agent?.name ?? 'Selected agent'} · Assessment</h3><ScorePair score={score} /><p className="small muted">{source.live ? 'Assessment appears when the current tables are ready.' : 'Scores appear only when recorded for this run.'}</p><div className="inspector-links"><button className="text-link" disabled={!currentEvent} title={!currentEvent ? 'No selected-agent event at this moment' : undefined} onClick={onContext}>Inspect current event ↗</button><button className="text-link" onClick={onOutcome}>{source.live ? 'View current status' : 'View saved outcome'} ↗</button></div></>;
}
function FollowInspector({ agent, source, currentEvent, onContext, onOutcome }: { agent?: Agent; source: StudioSource; currentEvent: EvidenceMoment | null; onContext: () => void; onOutcome: () => void }) {
  if (!agent) return <div className="data-empty"><h2>{source.live ? 'Current agent unavailable' : 'No agent record available'}</h2><p>{source.live ? 'The current agent subscription is not ready. Open a saved reference for recorded behavior.' : 'Select an agent from the saved Clearing run to inspect their behavior. Lending details have no connected record.'}</p></div>;
  const score = scoreFor(source.data?.scores ?? [], agent.id);
  const messages = messagesFor(source.data?.messages ?? [], agent.id);
  return <><span className="eyebrow">CAMERA FOLLOWING</span><h2>{agent.name}</h2><p className="muted">Model: {agent.modelId} · {agent.role || (source.live ? 'Current agent' : 'Recorded agent')}</p><div className="inspector-divider" /><h3>{currentEvent?.agentId === String(agent.id) ? currentEvent.title : agentStatus(agent)}</h3><p>{agent.thought ? `Model-provided explanation: “${agent.thought}”` : 'No model-provided explanation at this moment.'}</p><div className="needs-row"><span>Health {Math.round(agent.hp)}</span><span>Food {Math.round(agent.hunger)}</span><span>Warmth {Math.round(agent.warmth)}</span></div><div className="inspector-divider" /><h3>What led to the choice</h3><p className="small muted">{source.live ? 'Current simulation state and received messages are shown below.' : 'The recorded simulation state and saved conversation are shown below.'} A sequence does not prove hidden reasoning.</p><Conversation messages={messages} agents={source.data?.agents ?? []} emptyLabel={source.live ? 'No messages received.' : undefined} /><div className="inspector-divider" /><ScorePair score={score} /><div className="inspector-links"><button className="text-link" disabled={!currentEvent} title={!currentEvent ? 'No selected-agent event at this moment' : undefined} onClick={onContext}>Inspect selected event ↗</button><button className="text-link" onClick={onOutcome}>{source.live ? 'View current status' : 'View saved outcome'} ↗</button></div></>;
}
function ReplayDock({ source, current, onCommand }: { source: StudioSource; current: EvidenceMoment | null; onCommand: (command: 'previous' | 'next' | 'stop' | 'play' | 'pause') => void }) {
  const index = current ? source.moments.findIndex(event => event.key === current.key) : -1;
  return <div className="replay-dock" aria-label="Recorded replay controls"><span className="replay-title">REPLAY</span>
    <button aria-label="Previous recorded event" disabled={!source.ready || index <= 0} onClick={() => onCommand('previous')}><img src={playbackIcon.previous} alt="" /></button>
    <button aria-label={source.playing ? 'Pause replay' : 'Play replay'} disabled={!source.ready || !source.moments.length} onClick={() => onCommand(source.playing ? 'pause' : 'play')}>{source.playing ? 'Ⅱ' : <img src={playbackIcon.play} alt="" />}</button>
    <button aria-label="Stop replay and return to first event" disabled={!source.ready || !source.moments.length} onClick={() => onCommand('stop')}><img src={playbackIcon.stop} alt="" /></button>
    <button aria-label="Next recorded event" disabled={!source.ready || index >= source.moments.length - 1} onClick={() => onCommand('next')}><img src={playbackIcon.next} alt="" /></button>
    <input className="replay-scrubber" type="range" min={0} max={Math.max(1, source.duration)} step={100} value={Math.min(source.t, Math.max(1, source.duration))} disabled={!source.ready} aria-label="Replay position" aria-valuetext={`${formatClock(source.t)} of ${formatClock(source.duration)}`} onChange={event => { source.setPlaying(false); source.seek(Number(event.target.value)); }} />
    <span className="replay-time">{formatClock(source.t)} / {formatClock(source.duration)}</span>
    <div className="replay-speeds" aria-label="Replay speed">{[1, 2, 4, 8].map(speed => <button key={speed} className="replay-speed" aria-label={`${speed} times speed`} aria-pressed={source.speed === speed} disabled={!source.ready} onClick={() => source.setSpeed(speed)}>{speed}×</button>)}</div>
    <span className="replay-event">{current?.title ?? 'Recorded run'}</span>
  </div>;
}
function MethodDetails({ data, run }: { data: RecordedTables | null; run: string }) {
  const raw = data?.metadata.find(meta => meta.key === 'run')?.value;
  let config: Record<string, unknown> = {};
  try { config = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { config = {}; }
  return <dl className="detail-list"><dt>Recording</dt><dd>{run}</dd><dt>Model</dt><dd>{data?.agents[0]?.modelId ?? 'Not recorded'}</dd><dt>Prompt / rule variant</dt><dd>{String(config.promptVariant ?? 'Not recorded')}</dd><dt>Food scale</dt><dd>{config.foodScale == null ? 'Not recorded' : `${String(config.foodScale)}×`}</dd><dt>Rescue seats</dt><dd>{config.rescueSeats == null ? 'Not recorded' : String(config.rescueSeats)}</dd><dt>Time scale</dt><dd>{config.timeScale == null ? 'Not recorded' : `${String(config.timeScale)}×`}</dd><dt>Exact seed</dt><dd>{config.seed == null ? 'Not recorded' : String(config.seed)}</dd></dl>;
}
