import { describe, expect, it } from 'vitest';
import { actorPosition, worldEventPosition, momentDuration, momentPriority, type Moment } from './SceneEvents';

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
