import type { Agent, Container, Item, Message, ResourceNode, World, Structure, Mob, Hazard, Memory } from '../module_bindings/types';

// Local artwork fixtures only. Never submitted to reducers or mixed with live results.
export function artPreview(source: World, winter: boolean, depleted: boolean, survival = false) {
  const world = { ...source, gameTimeMs: 36000, winterAtMs: 240000, phase: winter ? 'winter' : 'autumn', width: 128, height: 128, radius: 64, fairShare: 12, running: false, dayLengthMs: 180000, dayOffsetMs: survival ? -36000 : 54000, daylight: survival ? 'night' : 'day', rescueAtMs: 486000, rescueState: 'waiting' };
  const agents: Agent[] = ['Ada', 'Bo', 'Cy', 'Di'].map((name, i) => ({
    id: BigInt(i + 1), name, kind: 'llm', modelId: 'staged art fixture', controller: undefined,
    color: ['#af755b', '#648f91', '#c6a455', '#87955e'][i], role: survival ? ['pilot', 'nurse', 'cook', 'engineer'][i] : '', backstory: survival ? 'Staged role description, not a model outcome.' : '', x: 57 + i * 5, y: 70 + i % 2 * 4, vx: 0, vy: 0, kx: 0, ky: 0, stunnedUntilMs: survival && i === 0 ? 40000 : 0, stuckMs: 0,
    intentKind: 'idle', targetX: 0, targetY: 0, targetAgentId: 0n, targetNodeId: 0n, intentSinceMs: 0, progressMs: 0, lastHitById: 0n, lastHitAtMs: 0, hp: i === 3 ? 0 : 100 - i * 15, hunger: 90 - i * 25, warmth: survival && i === 1 ? 10 : 100, pinned: survival && i === 2,
    alive: i !== 3, ghostUntilMs: i === 3 ? 44000 : 0, homeX: 45 + i * 12, homeY: 81,
    thought: 'Staged artwork preview; no model was called.', pendingRequestId: i === 1 ? 1n : 0n, nextThinkAtMs: 0, wake: false, wakeReason: '',
  }));
  const containers: Container[] = [{ id: 1n, kind: 'wreck', x: 73, y: 57, ownerAgentId: 0n, label: 'Shared wreck cargo' },
    ...agents.map((a, i) => ({ id: BigInt(i + 2), kind: 'chest', x: a.homeX, y: a.homeY, ownerAgentId: a.id, label: `${a.name}'s chest` })),
    { id: 6n, kind: 'drop', x: 76, y: 76, ownerAgentId: 4n, label: 'Dropped supplies' }];
  const items: Item[] = depleted ? [] : [
    { id: 1n, agentId: 0n, containerId: 1n, kind: 'ration', qty: 32 },
    { id: 2n, agentId: 0n, containerId: 1n, kind: 'wood', qty: 15 },
    { id: 3n, agentId: 0n, containerId: 1n, kind: 'berries', qty: 24 },
    { id: 4n, agentId: 0n, containerId: 2n, kind: 'berries', qty: 5 },
    { id: 5n, agentId: 0n, containerId: 3n, kind: 'ration', qty: 3 },
    { id: 6n, agentId: 0n, containerId: 6n, kind: 'wood', qty: 2 },
  ];
  const nodes: ResourceNode[] = [];
  for (let i = 0; i < 38; i++) {
    const angle = i * 2.399963;
    const radius = 34 + (i % 4) * 6;
    nodes.push({ id: BigInt(i + 1), kind: i % 3 ? 'tree' : 'berry_bush', x: 64 + Math.cos(angle) * radius, y: 64 + Math.sin(angle) * radius, remaining: depleted ? 0 : 12, capacity: 12, state: depleted && i % 3 ? 'stump' : 'standing', angle: 0 });
  }
  for (let i = 0; i < 4; i++) nodes.push({ id: BigInt(i + 50), kind: 'berry_bush', x: 39 + i * 3, y: 61 + i % 2 * 3, remaining: depleted || i === 3 ? 0 : 9, capacity: 12, state: 'standing', angle: 0 });
  const messages: Message[] = [{ id: 1n, fromAgentId: 1n, toAgentId: survival ? 2n : 0n, channel: survival ? 'whisper' : 'say', text: 'A staged dialogue bubble, for checking readability.', x: 57, y: 70, gameTimeMs: 36000 }];
  const structures: Structure[] = survival ? [
    { id: 1n, kind: 'campfire', x: 64, y: 64, lit: !depleted, fuel: depleted ? 0 : 150, maxFuel: 300, woodNeeded: 0 },
    { id: 9n, kind: 'shelter', x: 64, y: 64, lit: false, fuel: 0, maxFuel: 0, woodNeeded: depleted ? 9 : 0 },
    { id: 2n, kind: 'signal_fire', x: 38, y: 52, lit: !depleted, fuel: depleted ? 0 : 500, maxFuel: 600, woodNeeded: depleted ? 15 : 0 },
  ] : [];
  const mobs: Mob[] = survival ? [{ id: 1n, kind: 'wolf', x: 80, y: 70, vx: 0, vy: 0, kx: 0, ky: 0, hp: 100, state: 'roam', targetAgentId: 0n, progressMs: 0 }] : [];
  const hazards: Hazard[] = survival ? [{ id: 1n, kind: 'storm', startsAtMs: 30000, endsAtMs: 45000 }] : [];
  const memories: Memory[] = survival ? [{ id: 1n, agentId: 2n, aboutAgentId: 1n, gameTimeMs: 32000, kind: 'helped', text: 'Staged memory: Ada gave you one berry.', valence: 1 }] : [];
  if (survival) nodes.push({ id: 99n, kind: 'tree', x: 66, y: 70, state: 'fallen', angle: 0.7, remaining: 4, capacity: 6 });
  return { world, agents, containers, items, nodes, messages, structures, mobs, hazards, memories };
}
