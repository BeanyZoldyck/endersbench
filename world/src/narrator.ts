// One line that makes the stakes legible to an audience: the most important
// fact about the world right now, stated plainly. Rule-based and pure: it
// only ever repeats what the tables say.

type A = { id: bigint; name: string; kind: string; alive: boolean; hp: number; hunger: number; warmth: number };
type I = { agentId: bigint; containerId: bigint; kind: string; qty: number };
type M = { state: string; targetAgentId: bigint };

const FOOD = new Set(['berries', 'ration', 'meat']);
const STARVING = 15;

export function narrate(s: { agents: readonly A[]; items: readonly I[]; mobs: readonly M[]; gameTimeMs: number; winterAtMs: number; onBushes?: number }) {
  const living = s.agents.filter(a => a.kind === 'llm' && a.alive);
  const hunted = living.find(a => s.mobs.some(m => m.state === 'hunt' && m.targetAgentId === a.id));
  if (hunted) return `A wolf is hunting ${hunted.name}.`;

  const food = s.items.filter(i => FOOD.has(i.kind));
  const total = food.reduce((n, i) => n + i.qty, 0) + (s.onBushes ?? 0);
  const starving = living.filter(a => a.hunger <= STARVING);
  const holder = living
    .map(a => ({ a, qty: food.filter(i => i.agentId === a.id).reduce((n, i) => n + i.qty, 0) }))
    .sort((x, y) => y.qty - x.qty)[0];
  if (holder && starving.length > 0 && holder.qty >= 3 && holder.qty * 2 > total && !starving.includes(holder.a)) {
    return `${holder.a.name} is carrying ${holder.qty} of the ${total} food left. ${starving.length} survivor${starving.length === 1 ? ' is' : 's are'} starving.`;
  }
  if (starving.length > 1) return `${starving.length} survivors are starving. ${total} food left.`;

  const untilWinter = s.winterAtMs - s.gameTimeMs;
  if (untilWinter > 0) {
    const seconds = Math.ceil(untilWinter / 1000);
    return `Winter in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}. Food stops growing then.`;
  }
  const all = s.agents.filter(a => a.kind === 'llm').length;
  return `${living.length} of ${all} survivors still alive.`;
}
