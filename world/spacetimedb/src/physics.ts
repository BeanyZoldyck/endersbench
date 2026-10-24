// Pseudo-physics: bodies are circles with velocity; trees, wood piles, chests,
// fires and the wreck are solid; bushes and thickets slow you down. Movement
// is intent-driven velocity plus a decaying knockback impulse, resolved
// against colliders.

import type { Ctx, World } from './ctx';
import { centre, distance } from './ctx';
import { isBerry, isWoody } from './resources';
import { wreckFuselage } from './scenario';
import {
  AGENT_RADIUS,
  BUSH_RADIUS,
  CHEST_RADIUS,
  EDGE_MARGIN,
  FALLEN_TREE_LENGTH,
  FIRE_RADIUS,
  STUMP_RADIUS,
  TREE_RADIUS,
} from './rules';

export type Collider = {
  tag: 'tree' | 'chest' | 'fire' | 'wreck';
  id: bigint;
  x1: number;
  y1: number;
  x2: number; // a circle has x2 = x1, y2 = y1
  y2: number;
  r: number;
};

const STEER_CLEARANCE = 0.25;

export function closestOnSegment(c: Collider, px: number, py: number): [number, number] {
  const dx = c.x2 - c.x1;
  const dy = c.y2 - c.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return [c.x1, c.y1];
  const t = Math.min(1, Math.max(0, ((px - c.x1) * dx + (py - c.y1) * dy) / len2));
  return [c.x1 + dx * t, c.y1 + dy * t];
}

// Everything solid in the world this tick. Agents and wolves are handled separately.
export function staticColliders(ctx: Ctx, w: World): Collider[] {
  const out: Collider[] = [];
  const circle = (tag: Collider['tag'], id: bigint, x: number, y: number, r: number) =>
    out.push({ tag, id, x1: x, y1: y, x2: x, y2: y, r });

  for (const n of ctx.db.resourceNode.iter()) {
    if (!isWoody(n.kind)) continue;
    if (n.state === 'stump') circle('tree', n.id, n.x, n.y, STUMP_RADIUS);
    else if (n.state === 'fallen') {
      out.push({
        tag: 'tree',
        id: n.id,
        x1: n.x,
        y1: n.y,
        x2: n.x + Math.cos(n.angle) * FALLEN_TREE_LENGTH,
        y2: n.y + Math.sin(n.angle) * FALLEN_TREE_LENGTH,
        r: TREE_RADIUS * 0.7,
      });
    } else circle('tree', n.id, n.x, n.y, TREE_RADIUS);
  }
  for (const c of ctx.db.container.iter()) {
    if (c.kind === 'chest') circle('chest', c.id, c.x, c.y, CHEST_RADIUS);
  }
  for (const s of ctx.db.structure.iter()) if (s.kind !== 'shelter') circle('fire', s.id, s.x, s.y, FIRE_RADIUS);
  const f = wreckFuselage(w);
  out.push({ tag: 'wreck', id: 0n, x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, r: f.radius });
  return out;
}

export function inBush(ctx: Ctx, x: number, y: number) {
  for (const n of ctx.db.resourceNode.iter()) {
    if (isBerry(n.kind) && distance(x, y, n.x, n.y) < BUSH_RADIUS + AGENT_RADIUS * 0.5) return true;
  }
  return false;
}

// Turns a desired direction into one that skirts the nearest obstacle ahead,
// by aiming at a point just beside it on the side the goal lies.
export function steer(
  px: number,
  py: number,
  dx: number,
  dy: number,
  look: number,
  colliders: Collider[],
  skip: (c: Collider) => boolean
): [number, number] {
  let best: { t: number; cx: number; cy: number; R: number; side: number } | null = null;
  for (const c of colliders) {
    if (skip(c)) continue;
    const [cx, cy] = closestOnSegment(c, px + dx * Math.min(look, 1.5), py + dy * Math.min(look, 1.5));
    const t = (cx - px) * dx + (cy - py) * dy;
    if (t <= 0 || t > look) continue;
    const ox = cx - px - dx * t;
    const oy = cy - py - dy * t;
    const off = Math.hypot(ox, oy);
    const R = c.r + AGENT_RADIUS + STEER_CLEARANCE;
    if (off >= R) continue;
    if (!best || t < best.t) {
      // Which side of our path the obstacle sits on; go round the other side.
      const cross = dx * (cy - py) - dy * (cx - px);
      best = { t, cx, cy, R, side: cross >= 0 ? -1 : 1 };
    }
  }
  if (!best) return [dx, dy];
  const nx = -dy * best.side;
  const ny = dx * best.side;
  const wx = best.cx + nx * (best.R + 0.2) - px;
  const wy = best.cy + ny * (best.R + 0.2) - py;
  const len = Math.hypot(wx, wy) || 1;
  return [wx / len, wy / len];
}

export type Contact = { collider: Collider; impactSpeed: number };

// Pushes a body of radius `radius` out of every collider and the map edge,
// removing the part of its knockback that drove it into the obstacle.
export function resolve(
  w: World,
  colliders: Collider[],
  body: { x: number; y: number; kx: number; ky: number },
  radius: number
): Contact[] {
  const contacts: Contact[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      const [cx, cy] = closestOnSegment(c, body.x, body.y);
      const minD = c.r + radius;
      let nx = body.x - cx;
      let ny = body.y - cy;
      let d = Math.hypot(nx, ny);
      if (d >= minD + 0.02) continue;
      if (d < 1e-6) {
        nx = 1;
        ny = 0;
        d = 1;
      }
      nx /= d;
      ny /= d;
      const into = -(body.kx * nx + body.ky * ny);
      if (d < minD) {
        body.x = cx + nx * minD;
        body.y = cy + ny * minD;
      }
      if (into > 0) {
        body.kx += into * nx;
        body.ky += into * ny;
      }
      if (pass === 0) contacts.push({ collider: c, impactSpeed: Math.max(0, into) });
    }
  }
  const [mx, my] = centre(w);
  const limit = w.radius - EDGE_MARGIN;
  const d = distance(mx, my, body.x, body.y);
  if (d > limit) {
    const nx = (body.x - mx) / d;
    const ny = (body.y - my) / d;
    body.x = mx + nx * limit;
    body.y = my + ny * limit;
    const out = body.kx * nx + body.ky * ny;
    if (out > 0) {
      body.kx -= out * nx;
      body.ky -= out * ny;
    }
  }
  return contacts;
}
