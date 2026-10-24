import type { Hazard, World } from '../module_bindings/types';

export type Physics = {
  agentRadius: number; treeRadius: number; stumpRadius: number; bushRadius: number;
  chestRadius: number; fireRadius: number; wolfRadius: number; fallenTreeLength: number;
  fireWarmthRadius?: number; shelterRadius?: number; shelterWood?: number;
  wreck: { x1: number; x2: number; y1: number; y2: number; radius: number };
  // Rules v11: the river's centre line in world x/y, and the supply crate. Absent in older recordings.
  river?: Array<[number, number]>;
  crate?: { x: number; y: number };
};
const radii = ['agentRadius', 'treeRadius', 'stumpRadius', 'bushRadius', 'chestRadius', 'fireRadius', 'wolfRadius', 'fallenTreeLength'] as const;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
// A river needs two points to be a line; a bad point means no river rather than a guessed one.
function parseRiver(raw: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const points: Array<[number, number]> = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || !finite(p[0]) || !finite(p[1])) return undefined;
    points.push([p[0], p[1]]);
  }
  return points;
}
function parseCrate(raw: unknown): { x: number; y: number } | undefined {
  const c = raw as { x?: unknown; y?: unknown } | null;
  return c && finite(c.x) && finite(c.y) ? { x: c.x, y: c.y } : undefined;
}
export function parsePhysics(raw?: string): Physics | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || radii.some(k => typeof value[k] !== 'number' || !Number.isFinite(value[k]) || value[k] <= 0)) return null;
    const w = value.wreck;
    if (!w || ['x1', 'x2', 'y1', 'radius'].some(k => typeof w[k] !== 'number' || !Number.isFinite(w[k])) || w.radius <= 0 || w.x2 <= w.x1) return null;
    // The published wreck is an east-west capsule, not a rotated prop at its cargo door.
    if (w.y2 !== undefined && w.y2 !== w.y1) return null;
    const river = parseRiver(value.river), crate = parseCrate(value.crate);
    const { river: _river, crate: _crate, ...rest } = value;
    return { ...rest, wreck: { ...w, y2: w.y1 }, ...(river && { river }), ...(crate && { crate }) };
  } catch { return null; }
}
export function gameTime(world: Pick<World, 'gameTimeMs' | 'running' | 'timeScale'>, receivedAt: number, now: number, connected: boolean) {
  // A stale/disconnected snapshot must not independently advance the simulation.
  return world.gameTimeMs + (connected && world.running ? Math.min(250, Math.max(0, now - receivedAt)) * Math.max(0, world.timeScale) : 0);
}
export function timeOfDay(ms: number, length: number, offset: number) {
  return length > 0 ? (((ms + offset) % length) + length) % length / length : 0.5;
}
export function activeStorm(hazards: readonly Hazard[], ms: number) {
  return hazards.some(h => h.kind === 'storm' && h.startsAtMs <= ms && ms < h.endsAtMs);
}
export const itemColor = (kind: string) => ({ berries: '#a65e68', ration: '#c4af81', wood: '#94725e', medkit: '#e5e1cb', flare: '#d49556', meat: '#a9776b', spear: '#8a6a4c', flaming_spear: '#d9733a' }[kind] ?? '#b7b5a2');
export const itemName = (kind: string) => ({ medkit: 'medical kit', flare: 'flare', meat: 'meat', berries: 'berries', ration: 'ration', wood: 'wood', spear: 'spear', flaming_spear: 'flaming spear' }[kind] ?? kind);
// "1 berry", "9 rations", "2 medical kits"; wood and meat do not count.
export function itemCount(kind: string, qty: number) {
  if (kind === 'wood' || kind === 'meat') return `${qty} ${kind}`;
  if (kind === 'berries') return `${qty} ${qty === 1 ? 'berry' : 'berries'}`;
  return `${qty} ${itemName(kind)}${qty === 1 ? '' : 's'}`;
}

// The weapon each survivor carries, the best of what they have: a flaming
// spear, then a spear. (The world reads it the same way.) Survivors with
// neither are absent.
export type Weapon = 'flaming_spear' | 'spear';
export function heldWeapons(items: ReadonlyArray<{ agentId: bigint; kind: string; qty: number }>) {
  const held = new Map<bigint, Weapon>();
  for (const i of items) {
    if (i.agentId === 0n || i.qty <= 0) continue;
    if (i.kind === 'flaming_spear') held.set(i.agentId, 'flaming_spear');
    else if (i.kind === 'spear' && !held.has(i.agentId)) held.set(i.agentId, 'spear');
  }
  return held;
}
