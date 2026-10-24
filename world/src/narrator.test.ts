import { describe, expect, test } from 'vitest';
import { narrate } from './narrator';

const agent = (id: bigint, name: string, over: Record<string, unknown> = {}) => ({ id, name, kind: 'llm', alive: true, hp: 100, hunger: 80, warmth: 80, ...over });
const food = (agentId: bigint, kind: string, qty: number) => ({ agentId, containerId: 0n, kind, qty });

describe('narrate', () => {
  test('a hoard in someone\'s hands while others starve is the story', () => {
    const agents = [agent(1n, 'Ivy'), agent(2n, 'Rook', { hunger: 5 }), agent(3n, 'Sage', { hunger: 10 })];
    const items = [food(1n, 'ration', 7), food(2n, 'berries', 1), { agentId: 0n, containerId: 9n, kind: 'ration', qty: 1 }];
    expect(narrate({ agents, items, mobs: [], gameTimeMs: 300_000, winterAtMs: 240_000 })).toBe('Ivy is carrying 7 of the 9 food left. 2 survivors are starving.');
  });

  test('a wolf on someone comes first', () => {
    const agents = [agent(1n, 'Ivy'), agent(2n, 'Rook')];
    expect(narrate({ agents, items: [], mobs: [{ state: 'hunt', targetAgentId: 2n }], gameTimeMs: 100_000, winterAtMs: 240_000 })).toBe('A wolf is hunting Rook.');
  });

  test('otherwise it counts down to winter, or says who is still standing', () => {
    expect(narrate({ agents: [agent(1n, 'Ivy')], items: [], mobs: [], gameTimeMs: 60_000, winterAtMs: 240_000 })).toBe('Winter in 3:00. Food stops growing then.');
    expect(narrate({ agents: [agent(1n, 'Ivy'), agent(2n, 'Rook', { alive: false })], items: [], mobs: [], gameTimeMs: 300_000, winterAtMs: 240_000 })).toBe('1 of 2 survivors still alive.');
  });
});

describe('narrate: the signal fire', () => {
  const signal = (fuel: number) => ({ kind: 'signal_fire', lit: true, fuel });
  test('a lit signal fire that will burn out before the plane is the story', () => {
    const line = narrate({ agents: [agent(1n, 'Ivy')], items: [], mobs: [], gameTimeMs: 200_000, winterAtMs: 240_000, structures: [signal(120)], rescueAtMs: 486_000 });
    expect(line).toBe('The signal fire is burning: fuel for 2:00. The plane passes in 4:46, so it goes out first unless fed.');
  });
  test('one that will last is good news', () => {
    const line = narrate({ agents: [agent(1n, 'Ivy')], items: [], mobs: [], gameTimeMs: 400_000, winterAtMs: 240_000, structures: [signal(200)], rescueAtMs: 486_000 });
    expect(line).toBe('The signal fire is burning: fuel for 3:20. The plane passes in 1:26.');
  });
});
