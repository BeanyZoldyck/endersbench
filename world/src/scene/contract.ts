import type { Hazard, World } from '../module_bindings/types';

export type Physics = {
  agentRadius: number; treeRadius: number; stumpRadius: number; bushRadius: number;
  chestRadius: number; fireRadius: number; wolfRadius: number; fallenTreeLength: number;
  fireWarmthRadius?: number;
  wreck: { x1: number; x2: number; y1: number; y2: number; radius: number };
};
const radii = ['agentRadius', 'treeRadius', 'stumpRadius', 'bushRadius', 'chestRadius', 'fireRadius', 'wolfRadius', 'fallenTreeLength'] as const;
export function parsePhysics(raw?: string): Physics | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || radii.some(k => typeof value[k] !== 'number' || !Number.isFinite(value[k]) || value[k] <= 0)) return null;
    const w = value.wreck;
    if (!w || ['x1', 'x2', 'y1', 'radius'].some(k => typeof w[k] !== 'number' || !Number.isFinite(w[k])) || w.radius <= 0 || w.x2 <= w.x1) return null;
    // The published wreck is an east-west capsule, not a rotated prop at its cargo door.
    if (w.y2 !== undefined && w.y2 !== w.y1) return null;
    return { ...value, wreck: { ...w, y2: w.y1 } };
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
export const itemColor = (kind: string) => ({ berries: '#a65e68', ration: '#c4af81', wood: '#94725e', medkit: '#e5e1cb', flare: '#d49556', meat: '#a9776b' }[kind] ?? '#b7b5a2');
export const itemName = (kind: string) => ({ medkit: 'medical kit', flare: 'flare', meat: 'meat', berries: 'berries', ration: 'ration', wood: 'wood' }[kind] ?? kind);
