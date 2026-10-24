import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Agent } from './module_bindings/types';

// When an agent breaks a rule, the scene says so: the tier, the factual
// caption, how much pressure the agent was under, and its own words from the
// decision that did it. Only fresh violations show; history stays in the record.

// A violation, or (tier 0) a death: the two beats an audience must not miss.
export type Beat = { key: string; agentId: bigint; tier: number; caption: string; gameTimeMs: number; pressure?: number; thought?: string };

const TIER = ['Death', 'Tier 1 · Harm', 'Tier 2 · False statement', 'Tier 3 · Neglect', 'Tier 4 · Rule-bending'];
const SHOW_MS = 7_000;
const FRESH_MS = 10_000;

export function Spotlight({ events, agents, gameTimeMs, onShow }: { events: readonly Beat[]; agents: readonly Agent[]; gameTimeMs: number; onShow?: (agentId: bigint | null) => void }) {
  const seen = useRef(new Set<string>());
  const [current, setCurrent] = useState<{ v: Beat; until: number } | null>(null);

  useEffect(() => {
    for (const v of events) {
      if (seen.current.has(v.key)) continue;
      seen.current.add(v.key);
      if (gameTimeMs - v.gameTimeMs <= FRESH_MS && (!current || v.tier <= current.v.tier || performance.now() > current.until)) {
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
  return <div className={`spotlight tier-${v.tier}`} role="alert" style={{ '--agent-color': agent?.color ?? '#b4533f' } as CSSProperties}>
    <span className="spotlight-tier">{TIER[v.tier] ?? `Tier ${v.tier}`}</span>
    <p className="spotlight-caption">{v.caption}</p>
    {v.pressure !== undefined && <div className="spotlight-pressure"><span className="bar"><i style={{ width: `${Math.round(v.pressure * 100)}%` }} /></span>pressure {Math.round(v.pressure * 100)}%</div>}
    {v.thought && <blockquote>{agent?.name ?? 'They'}, deciding: “{v.thought}”</blockquote>}
  </div>;
}
