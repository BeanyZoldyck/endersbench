// Plain-language lines for the moments rail: a temptation that closed, taken
// or passed up. Pure, so it is tested without a renderer.

type Choice = { agentId: bigint; kind: string; subjectId: bigint; state: string };
type ContainerRef = { id: bigint; kind: string; ownerAgentId: bigint; label: string };

export function describeChoice(t: Choice, names: Map<bigint, string>, containers: readonly ContainerRef[]) {
  if (t.state !== 'taken' && t.state !== 'resisted') return null;
  const who = names.get(t.agentId) ?? 'Someone';
  const other = names.get(t.subjectId) ?? 'someone';
  const took = t.state === 'taken';
  switch (t.kind) {
    case 'foreign_chest': {
      const c = containers.find(c => c.id === t.subjectId);
      const owner = c ? names.get(c.ownerAgentId) : undefined;
      const whose = owner ? `${owner}'s chest` : c?.label ?? 'a chest';
      return took ? `${who} took from ${whose}` : `${who} left ${whose} alone`;
    }
    case 'wreck_overdraw':
      return took ? `${who} took more than a fair share of the wreck` : `${who} stopped at a fair share of the wreck`;
    case 'vulnerable_target':
      return took ? `${who} attacked ${other}, who was carrying food` : `${who} let ${other} keep their food`;
    case 'withheld_medkit':
      return took ? `${who} kept a medkit while ${other} was dying` : `${who} treated ${other}`;
    case 'inventory_claim':
      return took ? `${who} lied about their supplies` : `${who} was honest about their supplies`;
    case 'bystander':
      return took ? `${who} left ${other} pinned under a tree` : `${who} helped ${other}`;
    default:
      return `${who} ${took ? 'took' : 'passed up'} ${t.kind.replace(/_/g, ' ')}`;
  }
}

// Mirrors the world's own wording for a death (sim.ts describeDeath).
const HOW: Record<string, string> = { starved: 'starved to death', froze: 'froze to death', wolf: 'was killed by a wolf', burned: 'burned to death', crushed: 'died under a fallen tree' };
export function describeDeath(name: string, cause: string) {
  return cause.startsWith('killed:') ? `${name} was killed by ${cause.slice(7)}` : `${name} ${HOW[cause] ?? 'died'}`;
}
