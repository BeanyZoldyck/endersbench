import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Agent, Container, EthicsEvent, Record as GameRecord, ResourceNode, Score, Temptation, World } from './module_bindings/types';
import { describeChoice, describeDeath, describeRecord, listedInRail, railTally, type ChoicePoint } from './moments';
import { stanceLabel } from './fairShare';
import { eventLabel } from './eventPresentation';

const time = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
// Every take, every death and every find or weapon is listed. A pass is listed only under
// real pressure (see listedInRail), and only when asked: the record leads with what happened.

type Entry = { key: string; at: number; kind: 'taken' | 'resisted' | 'died' | 'noted'; text: string; pressure?: number; thought?: string; stance?: string; color?: string };

// In a replay, onJump makes each entry a link back to its moment.
export function MomentsRail({ agents, containers, nodes, records, scores, temptations, ethics, promptVariant, onJump }: { world?: World; agents: readonly Agent[]; containers: readonly Container[]; nodes: readonly ResourceNode[]; records: readonly GameRecord[]; scores: readonly Score[]; temptations: readonly Temptation[]; ethics: readonly EthicsEvent[]; promptVariant?: string; onJump?: (gameTimeMs: number) => void }) {
  const names = useMemo(() => new Map(agents.map(a => [a.id, a.name])), [agents]);

  const entries = useMemo(() => {
    const list: Entry[] = [];
    for (const t of temptations) {
      const text = describeChoice(t, names, containers);
      // True claims, about one's own supplies or the crate, are counted, not listed: they are the norm.
      if (!text || !listedInRail(t)) continue;
      // An elapsed window has no deciding thought. Only show filed evidence.
      const thought = t.state === 'taken' ? ethics.find(e => e.temptationId === t.id)?.thought : undefined;
      list.push({ key: `t${t.id}`, at: t.closedAtMs, kind: t.state === 'taken' ? 'taken' : 'resisted', text, pressure: t.pressure, thought, stance: t.state === 'taken' ? stanceLabel(t.kind, thought) : undefined, color: agents.find(a => a.id === t.agentId)?.color });
    }
    // Finding the crate and making a weapon: things done, neither taken nor passed up.
    for (const r of records) {
      const text = describeRecord(r, names, containers, nodes);
      if (text) list.push({ key: `r${r.id}`, at: r.gameTimeMs, kind: 'noted', text, color: agents.find(a => a.id === r.agentId)?.color });
    }
    for (const s of scores) {
      if (!s.diedAtMs) continue;
      const a = agents.find(a => a.id === s.agentId);
      if (a) list.push({ key: `d${s.agentId}`, at: s.diedAtMs, kind: 'died', text: describeDeath(a.name, (s as Score & { diedOf?: string }).diedOf ?? ''), color: a.color });
    }
    return list.sort((a, b) => b.at - a.at).slice(0, 40);
  }, [temptations, ethics, records, scores, agents, containers, nodes, names]);

  // The crate's kinds are listed above but kept out of these counts and the chart, as in the report.
  const { taken, resisted, points } = useMemo(() => railTally(temptations), [temptations]);
  const alive = agents.filter(a => a.kind === 'llm' && a.alive).length, total = agents.filter(a => a.kind === 'llm').length;
  const [showPasses, setShowPasses] = useState(false);
  // The crate's marks are listed but counted apart, as the report keeps them.
  const crateMarks = temptations.filter(t => (t.kind === 'crate_secret' || t.kind === 'crate_claim') && t.state === 'taken').length;
  const passes = entries.filter(e => e.kind === 'resisted').length;
  const shown = showPasses ? entries : entries.filter(e => e.kind !== 'resisted');
  const label = eventLabel(promptVariant);

  return <aside className="moments-rail" aria-label="Moments of choice">
    <span className="eyebrow">THE RECORD</span>
    <h2>Moments of choice</h2>
    <p className="rail-stats" title="A window without a recorded event does not prove deliberate restraint.">
      <span><b>{alive}</b>/{total} alive</span>
      <span className="taken"><b>{taken}</b> {label.toLowerCase()}</span>
      <span className="resisted"><b>{resisted}</b> passed</span>
      {crateMarks > 0 && <span className="taken" title="Keeping the crate a secret, or denying it: listed below, but kept out of these counts and the chart, as in the report."><b>{crateMarks}</b> about the crate</span>}
    </p>
    <PressureStrip points={points} names={names} label={label} />
    {shown.length === 0 && <p className="muted rail-empty">{passes ? 'Nothing recorded yet beyond passed windows.' : 'Recorded actions, deaths and finds appear here as they happen.'}</p>}
    <ol>
      {shown.map(e => <li key={e.key} className={`moment ${e.kind}${onJump ? ' jumpable' : ''}`} style={{ '--agent-color': e.color } as CSSProperties}
        {...(onJump ? { role: 'button', tabIndex: 0, title: 'Replay this moment', onClick: () => onJump(e.at), onKeyDown: (k: KeyboardEvent) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); onJump(e.at); } } } : {})}>
        <div className="moment-head"><span className="moment-mark">{e.kind === 'taken' ? label : e.kind === 'resisted' ? 'Passed' : e.kind === 'noted' ? 'Noted' : 'Died'}</span>
          <span className="moment-meta">{e.pressure !== undefined && <span title="Survival pressure when the choice arose: how close they were to death on their worst need">{Math.round(e.pressure * 100)}% pressure · </span>}<time>{time(e.at)}</time></span></div>
        <p>{e.text}</p>
        {e.thought && <blockquote>“{e.thought}”</blockquote>}
        {e.stance && <span className={`stance ${e.stance === 'called it fair' ? 'claims-fair' : 'admits-over'}`}>{e.stance}</span>}
      </li>)}
    </ol>
    {passes > 0 && <button className="rail-passes" aria-expanded={showPasses} onClick={() => setShowPasses(!showPasses)}>{showPasses ? 'Hide' : 'Show'} {passes} passed {passes === 1 ? 'window' : 'windows'} under pressure</button>}
  </aside>;
}

// Every decided choice at the survival pressure it arose under (0 to 100%, the worst of
// health, food and warmth): recorded behavior on the top row, passed windows below. A
// continuous axis, so nothing hangs on where a band was cut. Marks are jittered by id,
// so they hold still between renders; each has a hover label.
const W = 260, X0 = 6, X1 = 254;
function PressureStrip({ points, names, label }: { points: readonly ChoicePoint[]; names: Map<bigint, string>; label: string }) {
  if (!points.length) return null;
  const x = (p: number) => X0 + Math.min(1, Math.max(0, p)) * (X1 - X0);
  const jitter = (id: bigint, spread: number) => ((Number(id % 997n) * 7919) % 1000 / 1000 - 0.5) * spread;
  const title = (p: ChoicePoint) => `${names.get(p.agentId) ?? 'Someone'} · ${p.kind.replace(/_/g, ' ')} · ${Math.round(p.pressure * 100)}% pressure · ${p.taken ? label.toLowerCase() : 'passed'}`;
  const takes = points.filter(p => p.taken), passes = points.filter(p => !p.taken);
  return <figure className="pressure-strip" aria-label={`${takes.length} ${label.toLowerCase()} and ${passes.length} passed windows, by survival pressure`}>
    <figcaption title="Survival pressure: how close the survivor was to death on its worst need (health, food or warmth) when the choice arose.">Choices by survival pressure</figcaption>
    <svg viewBox={`0 0 ${W} 80`} role="img" aria-hidden="true">
      <text className="strip-row" x={X0} y={10}>{label} · {takes.length}</text>
      <text className="strip-row" x={X0} y={40}>Passed · {passes.length}</text>
      {passes.map(p => <circle key={String(p.id)} className="strip-pass" cx={x(p.pressure)} cy={52 + jitter(p.id, 9)} r={2.6}><title>{title(p)}</title></circle>)}
      {takes.map(p => <circle key={String(p.id)} className="strip-take" cx={x(p.pressure)} cy={22 + jitter(p.id, 9)} r={4.2}><title>{title(p)}</title></circle>)}
      <line className="strip-axis" x1={X0} x2={X1} y1={65} y2={65} />
      {[0, 0.5, 1].map(t => <text key={t} className="strip-tick" x={x(t)} y={77} textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}>{Math.round(t * 100)}%</text>)}
    </svg>
  </figure>;
}
