import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import type { Agent, Item } from './module_bindings/types';
import { GlowLegend } from './scene/ItemGlow';
import { WorldScene, type CameraMode } from './scene/WorldScene';
import { useMoments, type Moment } from './scene/SceneEvents';
import { parsePhysics, itemCount } from './scene/contract';
import { MemoryPanel } from './MemoryPanel';
import { MomentsRail } from './MomentsRail';
import { artPreview } from './scene/artPreview';
import { useReplay } from './useReplay';
import { Spotlight, type Beat } from './Spotlight';
import { describeDeath } from './moments';
import { narrate } from './narrator';
import { Intro } from './Intro';

const percent = (n: number) => Math.max(0, Math.min(100, n));
const time = (ms: number) => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`; };
// Bound retained presentation work without sorting an ever-growing audit table.
function recent<T extends { gameTimeMs: number }>(rows: readonly T[], count: number): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const index = out.findIndex(r => r.gameTimeMs < row.gameTimeMs);
    if (index >= 0) out.splice(index, 0, row);
    else if (out.length < count) out.push(row);
    if (out.length > count) out.pop();
  }
  return out;
}

export default function App() {
  const { isActive, identity, getConnection } = useSpacetimeDB();
  const conn = getConnection() as DbConnection | null;
  const [worlds, worldReady] = useTable(tables.world);
  const [liveAgents, agentsReady] = useTable(tables.agent);
  const [liveNodes, nodesReady] = useTable(tables.resourceNode);
  const [liveContainers, containersReady] = useTable(tables.container);
  const [liveItems, itemsReady] = useTable(tables.item);
  const [liveMessages, messagesReady] = useTable(tables.message);
  const [ethics, ethicsReady] = useTable(tables.ethicsEvent);
  const [metadata, metadataReady] = useTable(tables.meta);
  const [liveStructures, structuresReady] = useTable(tables.structure);
  const [liveMobs, mobsReady] = useTable(tables.mob);
  const [liveHazards, hazardsReady] = useTable(tables.hazard);
  const [liveMemories, memoriesReady] = useTable(tables.memory);
  const [liveTemptations] = useTable(tables.temptation);
  // ?replay=/runs/<dir>/replay.json plays a recorded run with no database.
  const replayUrl = useMemo(() => new URLSearchParams(window.location.search).get('replay'), []);
  const replay = useReplay(replayUrl);
  const recorded = replay.data;
  const physicsRaw = (recorded?.metadata ?? metadata).find(m => m.key === 'physics')?.value;
  const runRaw = (recorded?.metadata ?? metadata).find(m => m.key === 'run')?.value;
  const runConfig = useMemo(() => { try { return runRaw ? JSON.parse(runRaw) as { promptVariant?: string; foodScale?: number; rescueSeats?: number; roleOffset?: number; timeScale?: number } : undefined; } catch { return undefined; } }, [runRaw]);
  const scenarioRaw = (recorded?.metadata ?? metadata).find(m => m.key === 'scenario')?.value;
  const rulesVersion = useMemo(() => { try { return scenarioRaw ? Number(JSON.parse(scenarioRaw).version) : undefined; } catch { return undefined; } }, [scenarioRaw]);
  // The condition on screen, stated plainly: which prompt, which rules, any sweep settings.
  const condition = runConfig?.promptVariant
    ? [`${runConfig.promptVariant} prompt`, runConfig.foodScale && runConfig.foodScale !== 1 ? `food ${runConfig.foodScale}x` : '', runConfig.rescueSeats ? `${runConfig.rescueSeats} seats` : '', rulesVersion ? `rules v${rulesVersion}` : ''].filter(Boolean).join(' · ')
    : '';
  const physics = useMemo(() => parsePhysics(physicsRaw), [physicsRaw]);
  const [scores, scoresReady] = useTable(tables.score);
  const [selectedId, setSelectedId] = useState<bigint>();
  const [mode, setMode] = useState<CameraMode>('audience');
  const explore = useCallback(() => setMode('explore'), []);
  const [panel, setPanel] = useState<'journal' | 'inspector' | 'join' | null>(null);
  const [staged, setStaged] = useState(false);
  const [winterPreview, setWinterPreview] = useState(false);
  const [survivalPreview, setSurvivalPreview] = useState(false);
  const [depleted, setDepleted] = useState(false);
  const [previewMoments, setPreviewMoments] = useState<Moment[]>([]);
  const [error, setError] = useState('');
  // While a violation is in the spotlight, the audience camera shows who did it.
  const [spotlit, setSpotlit] = useState<bigint | null>(null);
  const liveWorld = worlds[0];
  const previewSource = useRef(liveWorld);
  previewSource.current = liveWorld;
  const worldAvailable = !!liveWorld;
  const preview = useMemo(() => import.meta.env.DEV && staged && previewSource.current ? artPreview(previewSource.current, winterPreview, depleted, survivalPreview) : null, [staged, worldAvailable, winterPreview, depleted, survivalPreview]);
  const world = recorded?.world ?? preview?.world ?? liveWorld;
  const agents = recorded?.agents ?? preview?.agents ?? liveAgents, nodes = recorded?.nodes ?? preview?.nodes ?? liveNodes;
  const containers = recorded?.containers ?? preview?.containers ?? liveContainers, items = recorded?.items ?? preview?.items ?? liveItems, messages = recorded?.messages ?? preview?.messages ?? liveMessages;
  const structures = recorded?.structures ?? preview?.structures ?? liveStructures, mobs = recorded?.mobs ?? preview?.mobs ?? liveMobs, hazards = recorded?.hazards ?? preview?.hazards ?? liveHazards, memories = recorded?.memories ?? preview?.memories ?? liveMemories;
  const ethicsRows = recorded?.ethics ?? ethics, scoreRows = recorded?.scores ?? scores, temptations = recorded?.temptations ?? liveTemptations;
  const { moments, events: worldEvents } = useMoments(conn, liveAgents, liveContainers, liveMobs, !preview, liveWorld);
  const ready = worldReady && agentsReady && nodesReady && containersReady && itemsReady && messagesReady && ethicsReady && scoresReady && metadataReady && structuresReady && mobsReady && hazardsReady && memoriesReady;
  const selected = agents.find(a => a.id === selectedId);
  const me = liveAgents.find(a => a.controller && identity && a.controller.isEqual(identity));
  const latestEvents = useMemo(() => recent(ethicsRows, 40), [ethicsRows]);
  const dialogue = useMemo(() => recent(messages, 60), [messages]);
  const event = !preview && world && latestEvents.find(e => world.gameTimeMs >= e.gameTimeMs && world.gameTimeMs - e.gameTimeMs < 12000);
  const worldCaption = !preview && [...worldEvents].reverse().find(e => e.text && performance.now() - e.receivedAt < 8000)?.text;
  const selectedScore = !preview && scoreRows.find(s => s.agentId === selectedId);
  const select = (id: bigint) => { setSelectedId(id); setMode('follow'); setPanel(null); };
  const winterIn = world ? world.winterAtMs - world.gameTimeMs : 0;
  const isWinter = world?.phase === 'winter';
  const names = useMemo(() => new Map(agents.map(a => [a.id, a.name])), [agents]);
  const hunted = useMemo(() => new Set(mobs.filter(m => m.state === 'hunt').map(m => m.targetAgentId)), [mobs]);
  // The ending, by name: with limited seats, who the plane took and who it left.
  const rescueLine = useMemo(() => {
    if (world?.rescueState === 'missed') return 'The search plane missed the signal';
    const living = agents.filter(a => a.kind === 'llm' && a.alive);
    const taken = living.filter(a => scoreRows.find(s => s.agentId === a.id)?.rescued);
    const left = living.filter(a => !taken.includes(a));
    if (!left.length) return 'Rescue confirmed';
    return `The plane took ${taken.map(a => a.name).join(' and ') || 'no one'} · left behind: ${left.map(a => a.name).join(', ')}`;
  }, [world?.rescueState, agents, scoreRows]);
  // What the spotlight may call out: every violation, and every death.
  const beats = useMemo<Beat[]>(() => [
    ...ethicsRows.map(e => ({ key: `e${e.id}`, agentId: e.agentId, tier: e.tier, caption: e.caption, gameTimeMs: e.gameTimeMs, pressure: e.pressure, thought: e.thought })),
    ...scoreRows.filter(s => s.diedAtMs > 0).map(s => ({ key: `d${s.agentId}`, agentId: s.agentId, tier: 0, caption: describeDeath(names.get(s.agentId) ?? 'Someone', s.diedOf), gameTimeMs: s.diedAtMs })),
  ], [ethicsRows, scoreRows, names]);
  const narration = world && !preview ? narrate({ agents, items, mobs, gameTimeMs: world.gameTimeMs, winterAtMs: world.winterAtMs, onBushes: nodes.filter(n => n.kind === 'berry_bush').reduce((n, b) => n + b.remaining, 0) }) : '';
  // Food anywhere in the world: carried, stored, dropped, and on bushes.
  const foodLeft = useMemo(() => {
    const food = items.filter(i => ['berries', 'ration', 'meat'].includes(i.kind)).reduce((n, i) => n + i.qty, 0);
    return food + nodes.filter(n => n.kind === 'berry_bush').reduce((n, b) => n + b.remaining, 0);
  }, [items, nodes]);
  const run = (action: Promise<unknown>) => { setError(''); void action.catch(e => setError(e instanceof Error ? e.message : String(e))); };
  const deselect = () => { setSelectedId(undefined); setMode('audience'); };
  const resetExperiment = () => {
    if (!conn || !confirm('Reset the experiment? The clearing starts over at time zero with the same survivors. This run\'s events and scores are cleared.')) return;
    deselect();
    run(conn.reducers.resetExperiment({}));
  };
  // Lives beside the survivor in the scene, so it follows them around.
  const selectedCard = selected && <>
    <button className="close" aria-label="Close survivor details" onClick={deselect}>×</button>
    <div className="selected-title"><Portrait agent={selected} /><div><span className="eyebrow">{selected.kind === 'human' ? 'HUMAN SURVIVOR' : 'AI SURVIVOR'}</span><h2>{selected.name}</h2><span className="model-name">{selected.modelId}</span></div></div>
    {selected.role && <p className="role-label">{selected.role}</p>}{selected.backstory && <p className="backstory">{selected.backstory}</p>}
    <Needs agent={selected} />
    {(() => {
      const record = ethicsRows.filter(e => e.agentId === selected.id).sort((a, b) => b.gameTimeMs - a.gameTimeMs);
      return record.length > 0 && <div className="agent-record"><h3>Their record</h3><ol>{record.map(e => <li key={String(e.id)}><span className="record-tier">Tier {e.tier}</span> {e.caption}<small> · pressure {Math.round(e.pressure * 100)}%</small>{e.thought && <q>{e.thought}</q>}</li>)}</ol></div>;
    })()}
    {selected.thought && <div className="thought"><span className="eyebrow">MODEL-PROVIDED THOUGHT</span><p>“{selected.thought}”</p></div>}
    <h3>Carrying</h3><Inventory items={items.filter(i => i.agentId === selected.id)} />
    {selectedScore && <dl className="facts"><dt>Reward</dt><dd>{selectedScore.reward.toFixed(1)}</dd><dt>Ethics score</dt><dd>{selectedScore.ethics.toFixed(0)} / 100</dd><dt>Violations / temptations</dt><dd>{selectedScore.violations} / {selectedScore.temptations}</dd></dl>}
    <MemoryPanel memories={memories} agentId={selected.id} name={selected.name} names={names} />
    <button className="primary" onClick={() => setMode('follow')}>{mode === 'follow' ? `Following ${selected.name}` : `Follow ${selected.name}`}</button>
  </>;

  return <main className={`app ${preview ? 'is-preview' : ''}`}>
    <div className="stage">
      {world && physics ? <WorldScene world={world} agents={agents} nodes={nodes} containers={containers} items={items} messages={messages}
        physics={physics} structures={structures} mobs={mobs} hazards={hazards} connected={!!preview || !!recorded || (isActive && ready)} selectedId={selectedId} mode={mode} moments={recorded ? replay.moments : preview ? previewMoments : moments} onSelect={select} onExplore={explore} selectedCard={selectedCard} spotlitId={spotlit ?? undefined}
        onClickTile={(x, y) => { if (me && conn && isActive && !preview) run(conn.reducers.humanMoveTo({ x, y })); }} /> : <div className="loading-world"><span className="loading-leaf">❧</span><p>{world ? "Waiting for the physics contract…" : "Finding the clearing…"}</p></div>}
      {replay.active && <ReplayBar replay={replay} />}
      {world && !preview && <Spotlight events={beats} agents={agents} gameTimeMs={world.gameTimeMs} onShow={setSpotlit} />}
    </div>
    <div className="topbar">
    <header className="masthead">
      <div className="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 28V10M16 19C5 21 3 11 4 6c9 0 13 4 12 13ZM16 14C15 5 22 2 28 3c1 8-4 14-12 11Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><span>ENDER’S BENCH</span><span className="edition">FIELD STUDY 01</span></div>
      <h1>The Clearing<span>.</span></h1>
      <p>{agents.length ? `${agents.length} survivors. ${isWinter ? 'Winter is here.' : 'Winter is coming.'} Who will share?` : 'A small world. A question of survival.'}</p>
    </header>
    <div className="world-status">
      <span className={`connection ${isActive && ready ? 'online' : ''}`}><i />{replay.active ? 'Replay' : preview ? 'Art preview' : !isActive ? 'Reconnecting · last known state' : !ready ? 'Syncing world…' : world?.running ? 'Live world' : 'World paused'}</span>
      {world && <div className="season"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={isWinter ? 'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3' : 'M5 19C2 7 13 3 20 4c1 10-4 17-15 15ZM5 19l10-9'} fill="none" stroke="currentColor" strokeWidth="1.3" /></svg><div><span>{isWinter ? 'WINTER' : 'AUTUMN'} · {world.daylight.toUpperCase()}</span><strong>{isWinter ? 'The cold has arrived' : winterIn > 0 ? `Winter in ${time(winterIn)}` : 'Awaiting winter'}</strong></div></div>}
      {condition && <span className="condition-chip" title="The experimental condition of this run">{condition}</span>}
      {world && <span className="food-left" title="Food anywhere in the world: carried, stored, dropped, and on bushes">{foodLeft} food left</span>}
      {world && world.rescueState === 'waiting' && world.rescueAtMs > world.gameTimeMs && <span className="rescue-countdown">Search plane in {time(world.rescueAtMs - world.gameTimeMs)}</span>}
      {world && ['rescued', 'missed'].includes(world.rescueState) && <div className={`rescue-banner ${world.rescueState}`} role="status">{rescueLine}</div>}
      <nav className="utility" aria-label="Viewer tools"><a className="results-link" href="/results.html" target="_blank" rel="noreferrer">Results ↗</a><button className="reset" disabled={!conn || !isActive || !!preview || replay.active} onClick={resetExperiment}>Reset experiment</button><button aria-expanded={panel === 'journal'} onClick={() => setPanel(panel === 'journal' ? null : 'journal')}>Journal</button><button aria-expanded={panel === 'inspector'} onClick={() => setPanel(panel === 'inspector' ? null : 'inspector')}>Inspector</button><button aria-expanded={panel === 'join'} onClick={() => setPanel(panel === 'join' ? null : 'join')}>{me ? 'Your survivor' : 'Join'}</button></nav>
    </div>
    </div>
    {preview && <div className="preview-banner" role="status">STAGED ART PREVIEW · NOT MODEL OUTCOMES <button onClick={() => { setStaged(false); setMode('audience'); }}>Return to live</button></div>}
    {error && <div className="error-toast" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {panel && <aside className="detail-panel utility-panel"><button className="close" aria-label="Close panel" onClick={() => setPanel(null)}>×</button>
      {panel === 'journal' && <><span className="eyebrow">THE RECORD</span><h2>From the clearing</h2><p className="muted">Recent dialogue and recorded events. Original words, unabridged.</p>
        <h3>Recorded events</h3>{preview ? <p className="muted">No model outcomes in art preview.</p> : latestEvents.length ? <ol className="journal">{latestEvents.map(e => <li key={String(e.id)}><time>{time(e.gameTimeMs)}</time><p>{e.caption}</p><small>Detector tier {e.tier} · {e.kind}</small></li>)}</ol> : <p className="muted">No events recorded yet.</p>}
        {!preview && worldEvents.length > 0 && <><h3>World events · received this session</h3><ol className="journal">{[...worldEvents].reverse().slice(0, 40).map(e => <li key={e.localId}><small>{e.kind.replace(/_/g, ' ')}</small><p>{e.text || e.kind.replace(/_/g, ' ')}</p></li>)}</ol></>}
        <h3>Conversation</h3><ol className="journal">{dialogue.map(m => <li key={String(m.id)} className={m.channel === 'whisper' ? 'whisper-record' : ''}><time>{time(m.gameTimeMs)}</time><strong>{names.get(m.fromAgentId) ?? 'Departed survivor'}</strong>{m.toAgentId !== 0n && <span> → {names.get(m.toAgentId) ?? 'Departed survivor'}</span>}{m.channel === 'whisper' && <small className="speech-channel">🔒 Whisper · spectators can see this</small>}<p>“{m.text}”</p></li>)}</ol>{!dialogue.length && <p className="muted">The woods are quiet.</p>}</>}
      {panel === 'inspector' && <><span className="eyebrow">UNDER THE CANOPY</span><h2>World inspector</h2>{world && <dl className="facts"><dt>Condition</dt><dd>{condition || 'Not recorded'}</dd><dt>Game clock</dt><dd>{time(world.gameTimeMs)}</dd><dt>Tick</dt><dd>{String(world.tick)}</dd><dt>Time scale</dt><dd>{world.timeScale}×</dd><dt>Map</dt><dd>Circle · radius {world.radius}</dd><dt>Resources / containers</dt><dd>{nodes.length} / {containers.length}</dd><dt>Wreck fair share</dt><dd>{world.fairShare} items / survivor</dd><dt>Data</dt><dd>{ready ? 'Subscriptions ready' : 'Waiting for replay'}</dd><dt>Structures / wolves</dt><dd>{structures.length} / {mobs.length}</dd><dt>Agent radius</dt><dd>{physics?.agentRadius ?? 'Unavailable'}</dd><dt>Rendering</dt><dd>DPR capped at 1.5</dd></dl>}
        {selected && <p className="muted">{selected.name}: ({selected.x.toFixed(1)}, {selected.y.toFixed(1)}) · intent {selected.intentKind}</p>}
        {!preview && <ActionInspector names={names} />}
        {import.meta.env.DEV && <div className="preview-controls"><h3>Development art checks</h3><label><input type="checkbox" checked={staged} onChange={e => { setStaged(e.target.checked); setMode('audience'); }} /> Staged scene (local only)</label>{staged && <><label><input type="checkbox" checked={survivalPreview} onChange={e => setSurvivalPreview(e.target.checked)} /> Staged survival states</label><label><input type="checkbox" checked={winterPreview} onChange={e => setWinterPreview(e.target.checked)} /> Winter palette</label><label><input type="checkbox" checked={depleted} onChange={e => setDepleted(e.target.checked)} /> Empty supplies & resources</label><div className="preview-actions"><button onClick={() => setPreviewMoments([{ id: performance.now(), type: 'transfer', from: [57, 70], to: [45, 81], kind: 'berries', item: 'berries', label: '2 berries', born: performance.now() }, { id: performance.now() + 1, type: 'pop', from: [72, 74], to: [72, 74], kind: 'gathered', item: 'wood', label: '+1 wood', born: performance.now() }])}>Stage berry transfer</button><button onClick={() => setPreviewMoments([{ id: performance.now(), type: 'hit', from: [57, 70], to: [62, 74], kind: '', born: performance.now() }])}>Stage hit pulse</button>{['flyover', 'flare'].map(kind => <button key={kind} onClick={() => setPreviewMoments([{ id: performance.now(), type: 'world', from: [64, 64], to: [64, 64], kind, born: performance.now() }])}>Stage {kind}</button>)}</div></>}</div>}
      </>}
      {panel === 'join' && <><span className="eyebrow">STEP INTO THE STORY</span><h2>{me ? `Hello, ${me.name}` : 'Join the survivors'}</h2><HumanControls conn={conn} me={me} disabled={!isActive || !ready || !!preview} onError={setError} /></>}
    </aside>}
    {!panel && !preview && <MomentsRail world={world} agents={agents} containers={containers} scores={scoreRows} temptations={temptations} ethics={ethicsRows} />}
    {!replay.active && !preview && <Intro promptVariant={runConfig?.promptVariant} />}
    <footer className="spectator-dock">
      <div className="scene-tools"><div className="camera-toggle" aria-label="Camera mode"><button className={mode === 'audience' ? 'active' : ''} onClick={() => { setMode('audience'); setSelectedId(undefined); }}>Audience</button><button className={mode !== 'audience' ? 'active' : ''} onClick={() => setMode('explore')}>{mode === 'follow' && selected ? `Following ${selected.name}` : 'Explore'}</button></div><span className="camera-hint">Drag to explore · scroll to get closer</span><GlowLegend />{(event || worldCaption || narration) && <div className={`event-caption ${event || worldCaption ? '' : 'narration'}`} role="status"><span className="event-mark" />{worldCaption || (event && event.caption) || narration}</div>}</div>
      <div className="cast-heading"><span>THE SURVIVORS</span><span>Select someone to follow their story</span></div>
      <div className="cast-strip" aria-label="Survivors">
        {[...agents].sort((a, b) => a.name.localeCompare(b.name)).map(a => <button key={String(a.id)} className={`cast-card ${selectedId === a.id ? 'selected' : ''}`} aria-pressed={selectedId === a.id} onClick={() => select(a.id)} style={{ '--agent-color': a.color } as CSSProperties}>
          <Portrait agent={a} /><div className="cast-info"><div className="cast-name"><strong>{a.name}</strong><span className={hunted.has(a.id) ? 'hunted' : ''}>{!a.alive ? 'Dead' : hunted.has(a.id) ? 'Hunted!' : a.pinned ? 'Pinned' : a.stunnedUntilMs > (world?.gameTimeMs ?? 0) ? 'Dazed' : a.pendingRequestId !== 0n ? 'Thinking…' : a.intentKind === 'idle' ? 'Resting' : a.intentKind === 'gather' ? 'Gathering' : a.intentKind === 'attack' ? 'Attacking' : a.intentKind === 'feed_fire' ? 'Tending fire' : a.intentKind === 'help' ? 'Helping' : 'Walking'}</span></div>{a.role && <span className="role-label">{a.role}</span>}<span className="model-name" title={a.modelId}>{a.modelId}</span></div>{a.alive && <span className="card-pressure" title="Survival pressure: the worst of health, fullness and warmth" style={{ '--p': `${Math.round(pressureOf(a) * 100)}%` } as CSSProperties}>{Math.round(pressureOf(a) * 100)}%</span>}<Needs agent={a} compact />
        </button>)}
        {!agents.length && <div className="empty-cast">Waiting for the first survivors.</div>}
      </div>
      <div className="colophon"><span>Cal Hacks 13.0</span><span>Survival under pressure. Choices in the open.</span><span>{preview ? 'Staged scene' : 'SpacetimeDB · live simulation'}</span></div>
    </footer>
  </main>;
}
function Portrait({ agent }: { agent: Agent }) {
  return <span className={`portrait ${!agent.alive ? 'ghost' : ''}`} style={{ '--agent-color': agent.color } as CSSProperties} aria-hidden="true"><i /><i /><b /></span>;
}
function Needs({ agent, compact = false }: { agent: Agent; compact?: boolean }) {
  const needs: Array<[string, number]> = [['Health', agent.hp], ['Food', agent.hunger], ['Warmth', agent.warmth]];
  // On the cast cards: three slim vertical bars, labelled by initial.
  if (compact) return <div className="needs vertical">{needs.map(([name, value]) => <div className="vneed" key={name} title={`${name}: ${Math.round(value)} / 100`}>
    <div className="vbar" role="meter" aria-label={`${agent.name} ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><i style={{ height: `${percent(value)}%` }} /></div>
    <span aria-hidden="true">{name[0]}</span>
  </div>)}</div>;
  return <div className={`needs ${compact ? 'compact' : ''}`}>{[['Health', agent.hp], ['Food', agent.hunger], ['Warmth', agent.warmth]].map(([name, value]) => <div className="need" key={name} title={`${name}: ${Math.round(Number(value))} / 100`}><span>{name}</span><meter min={0} max={100} value={percent(Number(value))} aria-label={`${agent.name} ${name}`} /><small>{Math.round(Number(value))}</small></div>)}</div>;
}
function Inventory({ items }: { items: readonly Item[] }) {
  return <p className="inventory">{items.filter(i => i.qty > 0).map(i => itemCount(i.kind, i.qty)).join(' · ') || 'Empty hands'}</p>;
}
function ActionInspector({ names }: { names: Map<bigint, string> }) {
  const [logs] = useTable(tables.actionLog);
  const entries = useMemo(() => recent(logs, 8), [logs]);
  return <details><summary>Recent reducer actions</summary><ol className="technical-log">{entries.map(l => <li key={String(l.id)}><strong>{names.get(l.agentId) ?? 'Survivor'}</strong><code>{l.action}</code>{!l.ok && <span>{l.error}</span>}</li>)}</ol></details>;
}
function HumanControls({ conn, me, disabled, onError }: { conn: DbConnection | null; me?: Agent; disabled: boolean; onError: (s: string) => void }) {
  const [name, setName] = useState(''), [text, setText] = useState(''), [pending, setPending] = useState(false);
  return <form className="human-controls" onSubmit={async e => {
    e.preventDefault(); if (!conn || disabled || pending) return;
    setPending(true); onError('');
    try { if (me && text.trim()) { await conn.reducers.humanSay({ text: text.trim() }); setText(''); } else if (!me && name.trim()) await conn.reducers.joinAsHuman({ name: name.trim() }); }
    catch (err) { onError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(false); }
  }}><p className="muted">{me ? 'Click the ground to walk. Your words are heard by nearby survivors.' : 'Enter the same world as the AI survivors. Choose a name to begin.'}</p><label>{me ? 'Say something' : 'Your name'}<input value={me ? text : name} onChange={e => me ? setText(e.target.value) : setName(e.target.value)} maxLength={me ? 200 : 24} disabled={disabled || pending} placeholder={me ? 'Anyone need supplies?' : 'Your name'} /></label><button className="primary" disabled={disabled || pending || !(me ? text : name).trim()}>{pending ? 'Sending…' : me ? 'Speak' : 'Join the world'}</button></form>;
}

// Playback for a recorded run.
function ReplayBar({ replay }: { replay: ReturnType<typeof useReplay> }) {
  const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  if (replay.error) return <div className="replay-bar error" role="alert">Replay failed to load: {replay.error}</div>;
  if (!replay.replay) return <div className="replay-bar">Loading replay…</div>;
  return <div className="replay-bar" role="group" aria-label="Replay controls">
    <span className="replay-tag">REPLAY</span>
    <button onClick={() => replay.setPlaying(!replay.playing)} aria-label={replay.playing ? 'Pause' : 'Play'}>{replay.playing ? '❚❚' : '▶'}</button>
    <input type="range" min={0} max={replay.duration} step={100} value={replay.t} onChange={e => replay.seek(Number(e.target.value))} aria-label="Replay position" />
    <span className="replay-time">{clock(replay.t)} / {clock(replay.duration)}</span>
    {[1, 2, 4, 8].map(s => <button key={s} className={replay.speed === s ? 'active' : ''} onClick={() => replay.setSpeed(s)}>{s}×</button>)}
    <span className="replay-source" title={replay.replay.recordedAt}>{replay.replay.db} · recorded {new Date(replay.replay.recordedAt).toLocaleString()}</span>
  </div>;
}

// The worst of an agent's three needs, 0 (comfortable) to 1 (dying): the same
// pressure the world records with every temptation.
function pressureOf(a: Agent) {
  return Math.min(1, Math.max(0, 1 - a.hp / 100, 1 - a.hunger / 100, 1 - a.warmth / 100));
}
