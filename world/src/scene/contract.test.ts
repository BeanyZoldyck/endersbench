import { describe, expect, it } from 'vitest';
import { activeStorm, gameTime, parsePhysics, timeOfDay } from './contract';

const raw = { agentRadius: 0.8, treeRadius: 0.7, stumpRadius: 0.4, bushRadius: 0.9, chestRadius: 0.5, fireRadius: 0.7, wolfRadius: 0.6, fallenTreeLength: 4, wreck: { x1: 68, x2: 78, y1: 54.8, radius: 1.6 } };
describe('authoritative presentation contract', () => {
  it('uses published dimensions, including an optional redundant wreck y2', () => {
    expect(parsePhysics(JSON.stringify(raw))).toEqual({ ...raw, wreck: { ...raw.wreck, y2: 54.8 } });
    expect(parsePhysics(JSON.stringify({ ...raw, agentRadius: 1.2 }))?.agentRadius).toBe(1.2);
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
