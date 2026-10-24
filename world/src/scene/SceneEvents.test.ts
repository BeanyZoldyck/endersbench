import { describe, expect, it } from 'vitest';
import { actorPosition, eventMoments, worldEventPosition, momentDuration, momentPriority, popLabel, shelterPanels, type Moment } from './SceneEvents';

describe('spectator event attribution', () => {
  it('resolves overlapping agent and mob IDs in the correct table', () => {
    const agents = [{ id: 1n, x: 10, y: 20 }];
    const mobs = [{ id: 1n, x: 80, y: 90 }];
    expect(actorPosition(1n, false, agents, mobs)).toEqual([10, 20]);
    expect(actorPosition(1n, true, agents, mobs)).toEqual([80, 90]);
    expect(actorPosition(2n, true, agents, mobs)).toBeUndefined();
    expect(actorPosition(1n, true, agents, [])).toBeUndefined();
  });
  it('centers global rescue events without relocating physical events', () => {
    const world = { width: 128, height: 128 };
    expect(worldEventPosition({ kind: 'flyover', x: 0, y: 0 }, world)).toEqual([64, 64]);
    expect(worldEventPosition({ kind: 'rescued', x: 0, y: 0 }, world)).toEqual([64, 64]);
    expect(worldEventPosition({ kind: 'storm_start', x: 0, y: 0 }, world)).toEqual([64, 64]);
    expect(worldEventPosition({ kind: 'flare', x: 12, y: 40 }, world)).toEqual([12, 40]);
    expect(worldEventPosition({ kind: 'flyover', x: 0, y: 0 })).toBeUndefined();
  });
  it('holds a flyover long enough to cross and prioritizes actual harm', () => {
    const flyover: Moment = { id: 1, type: 'world', from: [64, 64], to: [64, 64], kind: 'flyover', born: 0 };
    expect(momentDuration(flyover)).toBe(10000);
    expect(momentDuration({ ...flyover, kind: 'flare' })).toBe(4000);
    expect(momentPriority({ ...flyover, kind: 'burn' })).toBeGreaterThan(momentPriority(flyover));
  });
});

describe('action feedback', () => {
  it('labels each visible action with what changed hands', () => {
    expect(popLabel('gathered', 'wood')).toBe('+1 wood');
    expect(popLabel('gathered', 'berries')).toBe('+1 berry');
    expect(popLabel('transfer', 'berries', 3)).toBe('3 berries');
    expect(popLabel('transfer', 'ration', 1)).toBe('1 ration');
    expect(popLabel('ate', 'berries')).toBe('ate a berry');
    expect(popLabel('built', '4')).toBe('+4 wood');
    expect(popLabel('fire_fed', 'campfire', 2)).toBe('+2 wood');
    expect(popLabel('hit', '', 12)).toBe('−12');
  });
  it('keeps the camera on story beats, not every berry', () => {
    const pop: Moment = { id: 1, type: 'pop', from: [1, 1], to: [1, 1], kind: 'gathered', born: 0 };
    expect(momentPriority(pop)).toBe(0);
  });
  it('raises one wall panel per share of wood delivered', () => {
    expect(shelterPanels(18, 18, 12)).toBe(0);
    expect(shelterPanels(9, 18, 12)).toBe(6);
    expect(shelterPanels(1, 18, 12)).toBe(11);
    expect(shelterPanels(0, 18, 12)).toBe(12);
  });
});

describe('eventMoments', () => {
  const lookup = {
    agents: [{ id: 1n, x: 10, y: 10 }, { id: 2n, x: 20, y: 10 }],
    containers: [{ id: 7n, x: 30, y: 30 }],
    mobs: [{ id: 1n, x: 50, y: 50 }],
    world: { width: 128, height: 128 },
  };
  it('turns a hand-off into a flying item from giver to receiver', () => {
    expect(eventMoments('transfer_event', { fromAgentId: 1n, fromContainerId: 0n, toAgentId: 0n, toContainerId: 7n, kind: 'berries', qty: 2 }, lookup))
      .toEqual([{ type: 'transfer', from: [10, 10], to: [30, 30], kind: 'berries', item: 'berries', label: '2 berries' }]);
  });
  it('turns a wolf bite into a hit and a damage pop on the victim', () => {
    const m = eventMoments('hit_event', { attackerId: 1n, attackerIsMob: true, victimId: 2n, victimIsMob: false, damage: 12, knockedOut: false }, lookup);
    expect(m.map(x => x.type)).toEqual(['hit', 'pop']);
    expect(m[0]).toMatchObject({ from: [50, 50], to: [20, 10] });
    expect(m[1]).toMatchObject({ to: [20, 10], label: '−12' });
  });
  it('turns building into wood flying from the builder', () => {
    expect(eventMoments('world_event', { kind: 'built', x: 64, y: 64, agentId: 2n, otherId: 9n, text: '3' }, lookup))
      .toEqual([{ type: 'flight', from: [20, 10], to: [64, 64], kind: 'built', item: 'wood', label: '+3 wood' }]);
  });
});
