import { useMemo, type CSSProperties, type KeyboardEvent } from 'react';
import type { Agent, Container, EthicsEvent, Score, Temptation, World } from './module_bindings/types';
import { describeChoice, describeDeath, pressureBands } from './moments';
import { stanceLabel } from './fairShare';
import { eventLabel } from './eventPresentation';

const time = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
// Every take and every death is listed. A pass is listed only under real
// pressure; comfortable passes are still counted in the header.
const NOTABLE_PASS = 0.4;

type Entry = { key: string; at: number; kind: 'taken' | 'resisted' | 'died'; text: string; pressure?: number; thought?: string; stance?: string; color?: string };

// In a replay, onJump makes each entry a link back to its moment.
export function MomentsRail({ agents, containers, scores, temptations, ethics, promptVariant, onJump }: { world?: World; agents: readonly Agent[]; containers: readonly Container[]; scores: readonly Score[]; temptations: readonly Temptation[]; ethics: readonly EthicsEvent[]; promptVariant?: string; onJump?: (gameTimeMs: number) => void }) {
  const names = useMemo(() => new Map(agents.map(a => [a.id, a.name])), [agents]);

  const entries = useMemo(() => {
    const list: Entry[] = [];
    for (const t of temptations) {
      const text = describeChoice(t, names, containers);
      // True claims about one's own supplies are counted, not listed: they are the norm.
      if (!text || (t.state === 'resisted' && (t.pressure < NOTABLE_PASS || t.kind === 'inventory_claim'))) continue;
      // An elapsed window has no deciding thought. Only show filed evidence.
      const thought = t.state === 'taken' ? ethics.find(e => e.temptationId === t.id)?.thought : undefined;
      list.push({ key: `t${t.id}`, at: t.closedAtMs, kind: t.state === 'taken' ? 'taken' : 'resisted', text, pressure: t.pressure, thought, stance: t.state === 'taken' ? stanceLabel(t.kind, thought) : undefined, color: agents.find(a => a.id === t.agentId)?.color });
    }
    for (const s of scores) {
      if (!s.diedAtMs) continue;
      const a = agents.find(a => a.id === s.agentId);
      if (a) list.push({ key: `d${s.agentId}`, at: s.diedAtMs, kind: 'died', text: describeDeath(a.name, (s as Score & { diedOf?: string }).diedOf ?? ''), color: a.color });
    }
    return list.sort((a, b) => b.at - a.at).slice(0, 40);
  }, [temptations, ethics, scores, agents, containers, names]);

  const taken = temptations.filter(t => t.state === 'taken').length;
  const resisted = temptations.filter(t => t.state === 'resisted').length;
  const alive = agents.filter(a => a.kind === 'llm' && a.alive).length, total = agents.filter(a => a.kind === 'llm').length;

  return <aside className="moments-rail" aria-label="Moments of choice">
    <span className="eyebrow">THE RECORD</span>
    <h2>Moments of choice</h2>
    <div className="rail-stats">
      <span><b>{alive}</b>/{total} alive</span>
      <span className="taken"><b>{taken}</b> recorded events</span>
      <span className="resisted" title="No violation recorded during the window; this does not prove deliberate restraint."><b>{resisted}</b> windows without a recorded violation</span>
    </div>
    <div className="rail-curve" aria-label="Share of temptations taken, by survival pressure">
      {pressureBands(temptations).map(b => <div key={b.band} className="curve-bar" title={`${b.band} pressure: ${b.taken} taken of ${b.exposed}`}>
        <span className="curve-fill" style={{ height: `${b.exposed ? Math.max(4, (b.taken / b.exposed) * 100) : 0}%` }} />
        <span className="curve-label">{b.band}<br /><b>{b.taken}/{b.exposed}</b></span>
      </div>)}
      <span className="curve-caption">events by pressure · exploratory</span>
    </div>
    {entries.length === 0 && <p className="muted">Recorded actions, deaths and elapsed opportunity windows appear here. An elapsed window does not prove deliberate restraint.</p>}
    <ol>
      {entries.map(e => <li key={e.key} className={`moment ${e.kind}${onJump ? ' jumpable' : ''}`} style={{ '--agent-color': e.color } as CSSProperties}
        {...(onJump ? { role: 'button', tabIndex: 0, title: 'Replay this moment', onClick: () => onJump(e.at), onKeyDown: (k: KeyboardEvent) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); onJump(e.at); } } } : {})}>
        <div className="moment-head"><span className="moment-mark">{e.kind === 'taken' ? eventLabel(promptVariant) : e.kind === 'resisted' ? 'No violation recorded' : 'Died'}</span><time>{time(e.at)}</time></div>
        <p>{e.text}</p>
        {e.pressure !== undefined && <div className="pressure" title="Survival pressure when the choice arose: the worst of health, fullness and warmth"><span className="bar"><i style={{ width: `${Math.round(e.pressure * 100)}%` }} /></span><span>pressure {Math.round(e.pressure * 100)}%</span></div>}
        {e.thought && <blockquote>Model-provided explanation: “{e.thought}”</blockquote>}
        {e.stance && <span className={`stance ${e.stance === 'called it fair' ? 'claims-fair' : 'admits-over'}`}>{e.stance}</span>}
      </li>)}
    </ol>
  </aside>;
}
