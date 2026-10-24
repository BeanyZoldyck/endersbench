// What can be seen from where. Night shortens sight, but firelight shows
// whoever stands in it; a burning fire itself is visible from far away.

import type { Ctx, World } from './ctx';
import { distance } from './ctx';
import { closestOnSegment } from './physics';
import { wreckFuselage } from './scenario';
import {
  DAY_LENGTH_MS,
  FIRE_GLOW_RADIUS,
  FIRE_WARMTH_RADIUS,
  NIGHT_VIEW_RADIUS,
  SHELTER_RANGE,
  TWILIGHT_VIEW_RADIUS,
  VIEW_RADIUS,
} from './rules';

// 0 = midnight, 0.5 = noon.
export function timeOfDay(w: World, gameTimeMs = w.gameTimeMs) {
  const len = w.dayLengthMs || DAY_LENGTH_MS;
  return (((gameTimeMs + w.dayOffsetMs) % len) + len) % len / len;
}

export function daylightAt(f: number) {
  if (f < 0.2 || f >= 0.8) return 'night';
  if (f < 0.27) return 'dawn';
  if (f >= 0.73) return 'dusk';
  return 'day';
}

// Seconds until the next nightfall (or, at night, until dawn).
export function untilChange(w: World) {
  const f = timeOfDay(w);
  const len = w.dayLengthMs || DAY_LENGTH_MS;
  const night = daylightAt(f) === 'night';
  const target = night ? 0.2 : 0.8;
  const delta = (target - f + 1) % 1;
  return { to: night ? 'dawn' : 'night', inSeconds: Math.round((delta * len) / 100) / 10 };
}

export function viewRadius(w: World) {
  const d = w.daylight;
  return d === 'night' ? NIGHT_VIEW_RADIUS : d === 'day' ? VIEW_RADIUS : TWILIGHT_VIEW_RADIUS;
}

export function litFires(ctx: Ctx) {
  return [...ctx.db.structure.iter()].filter(s => s.lit);
}

export function inFirelight(fires: Array<{ x: number; y: number }>, x: number, y: number) {
  return fires.some(f => distance(f.x, f.y, x, y) <= FIRE_WARMTH_RADIUS);
}

// Can someone at (fx, fy) see the point (x, y)?
export function makeSight(ctx: Ctx, w: World) {
  const radius = viewRadius(w);
  const fires = litFires(ctx);
  return (fx: number, fy: number, x: number, y: number) => {
    const d = distance(fx, fy, x, y);
    return d <= radius || (d <= VIEW_RADIUS && inFirelight(fires, x, y));
  };
}

export function fireVisible(fx: number, fy: number, fire: { x: number; y: number; lit: boolean }, radius: number) {
  return distance(fx, fy, fire.x, fire.y) <= (fire.lit ? FIRE_GLOW_RADIUS : radius);
}

export function sheltered(w: World, x: number, y: number) {
  const f = wreckFuselage(w);
  const [cx, cy] = closestOnSegment({ tag: 'wreck', id: 0n, x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, r: f.radius, burns: false }, x, y);
  return distance(cx, cy, x, y) - f.radius <= SHELTER_RANGE;
}
