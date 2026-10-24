import type { InferSchema, ReducerCtx } from 'spacetimedb/server';
import type spacetimedb from './schema';
import { EDGE_MARGIN } from './rules';

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
export type Agent = NonNullable<ReturnType<Ctx['db']['agent']['id']['find']>>;
export type World = NonNullable<ReturnType<Ctx['db']['world']['id']['find']>>;
export type Container = NonNullable<ReturnType<Ctx['db']['container']['id']['find']>>;
export type ResourceNode = NonNullable<ReturnType<Ctx['db']['resourceNode']['id']['find']>>;

export function getWorld(ctx: Ctx): World {
  const w = ctx.db.world.id.find(0);
  if (!w) throw new Error('world not initialised');
  return w;
}

export function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(bx - ax, by - ay);
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function centre(w: World): [number, number] {
  return [w.width / 2, w.height / 2];
}

// Pulls a point back inside the playable circle.
export function clampToCircle(w: World, x: number, y: number): [number, number] {
  const [cx, cy] = centre(w);
  const limit = w.radius - EDGE_MARGIN;
  const d = distance(cx, cy, x, y);
  if (d <= limit) return [x, y];
  return [cx + ((x - cx) / d) * limit, cy + ((y - cy) / d) * limit];
}

export function wakeAgent(ctx: Ctx, id: bigint, reason: string) {
  const a = ctx.db.agent.id.find(id);
  if (a && a.alive) ctx.db.agent.id.update({ ...a, wake: true, wakeReason: reason });
}
