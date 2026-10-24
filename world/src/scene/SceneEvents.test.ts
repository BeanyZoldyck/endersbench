import { describe, expect, it } from 'vitest';
import { actorPosition, momentDuration, momentPriority, type Moment } from './SceneEvents';

describe('spectator event attribution', () => {
  it('resolves overlapping agent and mob IDs in the correct table', () => {
    const agents = [{ id: 1n, x: 10, y: 20 }];
    const mobs = [{ id: 1n, x: 80, y: 90 }];
    expect(actorPosition(1n, false, agents, mobs)).toEqual([10, 20]);
    expect(actorPosition(1n, true, agents, mobs)).toEqual([80, 90]);
    expect(actorPosition(2n, true, agents, mobs)).toBeUndefined();
    expect(actorPosition(1n, true, agents, [])).toBeUndefined();
  });
  it('holds a flyover long enough to cross and prioritizes actual harm', () => {
    const flyover: Moment = { id: 1, type: 'world', from: [64, 64], to: [64, 64], kind: 'flyover', born: 0 };
    expect(momentDuration(flyover)).toBe(10000);
    expect(momentDuration({ ...flyover, kind: 'flare' })).toBe(4000);
    expect(momentPriority({ ...flyover, kind: 'burn' })).toBeGreaterThan(momentPriority(flyover));
  });
});
