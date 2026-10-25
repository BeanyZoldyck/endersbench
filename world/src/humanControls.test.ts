import { describe, expect, test } from 'vitest';
import { lootTarget, moveDirection, swingTarget } from './humanControls';
import { groundAxes } from './scene/framing';

const { down, right } = groundAxes();
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
};

describe('moveDirection', () => {
  test('WASD walk the way the default camera looks: W is up the screen, D is right', () => {
    close(moveDirection(new Set(['w']))!, { x: -down.x, y: -down.z });
    close(moveDirection(new Set(['s']))!, { x: down.x, y: down.z });
    close(moveDirection(new Set(['d']))!, { x: right.x, y: right.z });
    close(moveDirection(new Set(['a']))!, { x: -right.x, y: -right.z });
  });
  test('a diagonal is as fast as a straight line, and opposite keys cancel', () => {
    const d = moveDirection(new Set(['w', 'd']))!;
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 5);
    expect(moveDirection(new Set(['w', 's']))).toBeNull();
    expect(moveDirection(new Set())).toBeNull();
  });
});

describe('swingTarget', () => {
  const me = { x: 50, y: 50 };
  const facing = { x: 1, y: 0 };
  test('prefers someone in front over someone nearer behind', () => {
    const t = swingTarget(me, facing, [
      { kind: 'agent', id: 1n, x: 48.5, y: 50 },
      { kind: 'agent', id: 2n, x: 53, y: 50.5 },
    ]);
    expect(t).toMatchObject({ kind: 'agent', id: 2n });
  });
  test('with nobody in front, swings at whoever is right beside you; nobody near, nothing', () => {
    expect(swingTarget(me, facing, [{ kind: 'wolf', id: 7n, x: 48.8, y: 50 }])).toMatchObject({ kind: 'wolf', id: 7n });
    expect(swingTarget(me, facing, [{ kind: 'agent', id: 1n, x: 40, y: 50 }])).toBeNull();
  });
});

describe('lootTarget', () => {
  const me = { x: 50, y: 50 };
  test('the nearest container in range comes first, then the nearest thing to gather', () => {
    expect(lootTarget(me, [{ id: 3n, x: 52, y: 50 }, { id: 4n, x: 51, y: 50 }], [{ id: 9n, x: 50.5, y: 50, remaining: 4 }])).toEqual({ container: 4n });
    expect(lootTarget(me, [{ id: 3n, x: 70, y: 50 }], [{ id: 9n, x: 52, y: 50, remaining: 4 }, { id: 8n, x: 51, y: 50, remaining: 0 }])).toEqual({ node: 9n });
    expect(lootTarget(me, [], [])).toBeNull();
  });
});
