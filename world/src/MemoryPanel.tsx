import { useMemo } from 'react';
import type { Memory } from './module_bindings/types';

export function MemoryPanel({ memories, agentId, name, names }: { memories: readonly Memory[]; agentId: bigint; name: string; names: Map<bigint, string> }) {
  const known = useMemo(() => memories.filter(m => m.agentId === agentId).sort((a, b) => b.gameTimeMs - a.gameTimeMs), [memories, agentId]);
  const summaries = useMemo(() => {
    const people = new Map<bigint, { records: number; helped: number }>();
    for (const m of known) if (m.aboutAgentId !== 0n) {
      const p = people.get(m.aboutAgentId) ?? { records: 0, helped: 0 };
      p.records++; if (m.kind === 'helped') p.helped++;
      people.set(m.aboutAgentId, p);
    }
    return [...people].slice(0, 8);
  }, [known]);
  return <section className="memory-panel"><h3>What {name} knows</h3>
    <p className="muted">Recorded memories from this survivor’s perspective.</p>
    {summaries.length > 0 && <ul className="memory-summary">{summaries.map(([id, s]) => <li key={String(id)}>{names.get(id) ?? 'Departed survivor'}: {s.records} recorded {s.records === 1 ? 'memory' : 'memories'}{s.helped > 0 && ` · ${s.helped} “helped” ${s.helped === 1 ? 'record' : 'records'}`}</li>)}</ul>}
    <ol className="journal memories">{known.slice(0, 30).map(m => <li key={String(m.id)}><small>{m.kind} · {(m.gameTimeMs / 1000).toFixed(0)}s · recorded valence {m.valence > 0 ? '+1' : m.valence}</small><p>{m.text}</p></li>)}</ol>
    {!known.length && <p className="muted">No memories recorded yet.</p>}
    {known.length > 30 && <p className="muted">Showing the latest 30 of {known.length} memories.</p>}
  </section>;
}
