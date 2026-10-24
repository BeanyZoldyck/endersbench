import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Agent } from './module_bindings/types';
import { stanceLabel } from './fairShare';
import { eventLabel, eventOutcome, eventPolicy } from './eventPresentation';

// When an agent breaks a rule, the scene says so: the tier, the factual
// caption, how much pressure the agent was under, and its own words from the
// decision that did it. Only fresh violations show; history stays in the record.

// A violation, or (tier 0) a death: the two beats an audience must not miss.
export type Beat = { key: string; agentId: bigint; tier: number; caption: string; gameTimeMs: number; pressure?: number; thought?: string; kind?: string };

const TIER = ['Death', 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Rescue'];
const SHOW_MS = 7_000;
const FRESH_MS = 10_000;

export function Spotlight({ events, agents, gameTimeMs, promptVariant, systemPrompt, onShow }: { events: readonly Beat[]; agents: readonly Agent[]; gameTimeMs: number; promptVariant?: string; systemPrompt?: string; onShow?: (agentId: bigint | null) => void }) {
  const seen = useRef(new Set<string>());
  const lastTime = useRef(gameTimeMs);
  const [current, setCurrent] = useState<{ v: Beat; until: number } | null>(null);

  useEffect(() => {
    const rewound = gameTimeMs < lastTime.current;
    lastTime.current = gameTimeMs;
    if (rewound) { seen.current.clear(); setCurrent(null); }
    for (const v of events) {
      if (seen.current.has(v.key)) continue;
      seen.current.add(v.key);
      if (gameTimeMs >= v.gameTimeMs && gameTimeMs - v.gameTimeMs <= FRESH_MS && (rewound || !current || v.tier <= current.v.tier || performance.now() > current.until)) {
        setCurrent({ v, until: performance.now() + SHOW_MS });
      }
    }
  }, [events, gameTimeMs, current]);

  useEffect(() => { onShow?.(current ? current.v.agentId : null); }, [current, onShow]);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setCurrent(null), Math.max(0, current.until - performance.now()));
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;
  const { v } = current;
  const agent = agents.find(a => a.id === v.agentId);
  const stance = stanceLabel(v.kind ?? '', v.thought);
  const policy = eventPolicy(v.kind ?? '', promptVariant, systemPrompt);
  const isBehavior = v.tier > 0 && v.tier < 5;
  return <div className={`spotlight tier-${v.tier}`} role="alert" style={{ '--agent-color': agent?.color ?? '#b4533f' } as CSSProperties}>
    <span className="spotlight-tier">{isBehavior ? `${eventLabel(promptVariant)} · ${TIER[v.tier]}` : TIER[v.tier]}</span>
    {policy && <p className="spotlight-policy"><b>Policy</b> · {policy}</p>}
    <p className="spotlight-caption">{isBehavior && <b>Action / outcome · </b>}{eventOutcome(v.kind ?? '', v.caption)}</p>
    {v.pressure !== undefined && <div className="spotlight-pressure"><span className="bar"><i style={{ width: `${Math.round(v.pressure * 100)}%` }} /></span>pressure {Math.round(v.pressure * 100)}%</div>}
    {v.thought && <blockquote><b>{agent?.name ?? 'Agent'}’s explanation</b> · “{v.thought}”</blockquote>}
    {stance && <span className={`stance ${stance === 'called it fair' ? 'claims-fair' : 'admits-over'}`}>{stance}</span>}
    {stance && <small className="explanation-note">Guilt-like language? Acknowledged tradeoff or inconsistent output? The words and action leave that question open.</small>}
  </div>;
}
