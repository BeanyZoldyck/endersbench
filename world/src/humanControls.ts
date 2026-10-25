import { groundAxes } from './scene/framing';

// The pure part of keyboard play: which way WASD walks, what Space swings at and what
// E loots. Directions are in world x/y; the camera's ground axes come from framing.ts.

type Point = { x: number; y: number };
const { down, right } = groundAxes();

// W is up the screen, S down, A left, D right, as the default camera sees the clearing.
// Diagonals are unit length; opposite keys cancel. No key, no direction.
export function moveDirection(keys: ReadonlySet<string>): Point | null {
  const up = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
  const side = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  const x = -down.x * up + right.x * side, y = -down.z * up + right.z * side;
  const length = Math.hypot(x, y);
  return length < 1e-6 ? null : { x: x / length, y: y / length };
}

export type Swingable = { kind: 'agent' | 'wolf'; id: bigint; x: number; y: number };
// Reach for a swing: whoever stands in front within SWING_RANGE (a cone of about
// 70 degrees either side of where you face), nearest first; failing that, whoever
// is right beside you. The world walks you in if they are a step away.
export const SWING_RANGE = 5, SWING_BESIDE = 2.5;
export function swingTarget(me: Point, facing: Point, targets: readonly Swingable[]): Swingable | null {
  const ranked = targets.map(t => {
    const dx = t.x - me.x, dy = t.y - me.y, d = Math.hypot(dx, dy);
    return { t, d, ahead: d < 1e-6 ? 1 : (dx * facing.x + dy * facing.y) / d };
  }).sort((a, b) => a.d - b.d);
  return ranked.find(r => r.d <= SWING_RANGE && r.ahead > 0.34)?.t ?? ranked.find(r => r.d <= SWING_BESIDE)?.t ?? null;
}

// E: the nearest container within LOOT_RANGE, else the nearest bush, tree or pile with
// something left to gather.
export const LOOT_RANGE = 5;
export function lootTarget(me: Point, containers: ReadonlyArray<Point & { id: bigint }>, nodes: ReadonlyArray<Point & { id: bigint; remaining: number }>): { container: bigint } | { node: bigint } | null {
  const near = <T extends Point>(list: readonly T[]) => list
    .map(o => ({ o, d: Math.hypot(o.x - me.x, o.y - me.y) }))
    .filter(r => r.d <= LOOT_RANGE)
    .sort((a, b) => a.d - b.d)[0]?.o;
  const c = near(containers);
  if (c) return { container: c.id };
  const n = near(nodes.filter(n => n.remaining > 0));
  return n ? { node: n.id } : null;
}
