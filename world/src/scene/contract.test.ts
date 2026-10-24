import { describe, expect, it } from 'vitest';
import { activeStorm, gameTime, heldWeapons, parsePhysics, timeOfDay, itemCount } from './contract';

const raw = { agentRadius: 0.8, treeRadius: 0.7, stumpRadius: 0.4, bushRadius: 0.9, chestRadius: 0.5, fireRadius: 0.7, wolfRadius: 0.6, fallenTreeLength: 4, wreck: { x1: 68, x2: 78, y1: 54.8, radius: 1.6 } };
describe('authoritative presentation contract', () => {
  it('uses published dimensions, including an optional redundant wreck y2', () => {
    expect(parsePhysics(JSON.stringify(raw))).toEqual({ ...raw, wreck: { ...raw.wreck, y2: 54.8 } });
    expect(parsePhysics(JSON.stringify({ ...raw, agentRadius: 1.2 }))?.agentRadius).toBe(1.2);
  });
  it('keeps the river and the crate for the scene to draw', () => {
    const river: Array<[number, number]> = [[110, 14], [100, 30], [96, 48]];
    const parsed = parsePhysics(JSON.stringify({ ...raw, river, crate: { x: 68.4, y: 111.2 } }));
    expect(parsed?.river).toEqual(river);
    expect(parsed?.crate).toEqual({ x: 68.4, y: 111.2 });
    // Older recordings carry neither: nothing to draw, and still a valid contract.
    expect(parsePhysics(JSON.stringify(raw))?.river).toBeUndefined();
    expect(parsePhysics(JSON.stringify(raw))?.crate).toBeUndefined();
  });
  it('ignores a malformed river or crate rather than drawing one', () => {
    const bad = parsePhysics(JSON.stringify({ ...raw, river: [[1, 2], ['x', 3], [4]], crate: { x: 'a' } }));
    expect(bad).not.toBeNull();
    expect(bad?.river).toBeUndefined();
    expect(bad?.crate).toBeUndefined();
  });
  it('does not draw guessed colliders for absent or malformed metadata', () => {
    for (const input of [undefined, '{}', '{', 'null', JSON.stringify({ ...raw, treeRadius: 0 }), JSON.stringify({ ...raw, wreck: { ...raw.wreck, y2: 60 } })]) expect(parsePhysics(input)).toBeNull();
  });
  it('interpolates scaled game time, but stops during a pause, outage or stale snapshot', () => {
    const w = { gameTimeMs: 1000, running: true, timeScale: 2 };
    expect(gameTime(w, 100, 150, true)).toBe(1100);
    expect(gameTime(w, 100, 10000, true)).toBe(1500);
    expect(gameTime(w, 100, 150, false)).toBe(1000);
    expect(gameTime({ ...w, running: false }, 100, 150, true)).toBe(1000);
    expect(gameTime(w, 100, 50, true)).toBe(1000);
  });
  it('keeps midnight/noon, negative offsets and wrapping consistent', () => {
    expect(timeOfDay(0, 180000, 0)).toBe(0);
    expect(timeOfDay(90000, 180000, 0)).toBe(0.5);
    expect(timeOfDay(180000, 180000, 0)).toBe(0);
    expect(timeOfDay(0, 180000, -45000)).toBe(0.75);
  });
  it('never shows a future or expired storm', () => {
    const hazards = [{ id: 1n, kind: 'storm', startsAtMs: 100, endsAtMs: 200 }];
    expect(activeStorm(hazards, 99)).toBe(false);
    expect(activeStorm(hazards, 100)).toBe(true);
    expect(activeStorm(hazards, 199)).toBe(true);
    expect(activeStorm(hazards, 200)).toBe(false);
  });
});

describe('itemCount', () => {
  it('counts items in plain English', () => {
    expect(itemCount('berries', 1)).toBe('1 berry');
    expect(itemCount('berries', 3)).toBe('3 berries');
    expect(itemCount('ration', 9)).toBe('9 rations');
    expect(itemCount('medkit', 2)).toBe('2 medical kits');
    expect(itemCount('wood', 1)).toBe('1 wood');
    expect(itemCount('meat', 2)).toBe('2 meat');
    expect(itemCount('spear', 1)).toBe('1 spear');
    expect(itemCount('flaming_spear', 1)).toBe('1 flaming spear');
  });
});

describe('heldWeapons', () => {
  const item = (agentId: bigint, kind: string, qty = 1, containerId = 0n) => ({ agentId, kind, qty, containerId });
  it('shows each survivor the best weapon they carry: a flaming spear, then a spear', () => {
    const held = heldWeapons([item(1n, 'spear'), item(2n, 'spear'), item(2n, 'flaming_spear'), item(3n, 'wood', 5)]);
    expect(held.get(1n)).toBe('spear');
    expect(held.get(2n)).toBe('flaming_spear');
    expect(held.has(3n)).toBe(false);
  });
  it('ignores spent stacks and spears lying in a container', () => {
    const held = heldWeapons([item(1n, 'spear', 0), item(0n, 'spear', 1, 9n), item(0n, 'flaming_spear', 1, 9n)]);
    expect(held.size).toBe(0);
  });
});
