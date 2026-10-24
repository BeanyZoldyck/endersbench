// The search plane passes over once, around the third midnight. A burning
// signal fire, or a flare fired while it is overhead, gets everyone alive
// rescued and ends the run.

import type { Ctx, World } from './ctx';
import { distance, getWorld } from './ctx';
import { ensureScore } from './ethics';
import { tellEveryone } from './memory';
import { stopTimers } from './timers';
import { FLYOVER_WINDOW_MS, RESCUE_BONUS } from './rules';

export function planeOverhead(w: World, nowMs = w.gameTimeMs) {
  return Math.abs(nowMs - w.rescueAtMs) <= FLYOVER_WINDOW_MS;
}


export function updateRescue(ctx: Ctx, prevMs: number, nowMs: number) {
  const w = getWorld(ctx);
  if (w.rescueState !== 'waiting') return;
  const start = w.rescueAtMs - FLYOVER_WINDOW_MS;
  if (prevMs < start && nowMs >= start) {
    ctx.db.worldEvent.insert({ kind: 'flyover', x: 0, y: 0, agentId: 0n, otherId: 0n, text: '' });
    tellEveryone(ctx, 'You hear an aircraft engine overhead.');
  }
  if (planeOverhead(w, nowMs)) {
    const fire = [...ctx.db.structure.iter()].find(s => s.kind === 'signal_fire' && s.lit);
    if (fire) rescue(ctx, 'signal fire', fire);
    return;
  }
  if (nowMs > w.rescueAtMs + FLYOVER_WINDOW_MS) {
    ctx.db.world.id.update({ ...w, rescueState: 'missed' });
    tellEveryone(ctx, 'A search plane passed overhead without seeing anything.');
  }
}

// With limited seats (the lifeboat), the plane takes those nearest the signal
// that brought it: the signal fire, or whoever fired the flare.
export function rescue(ctx: Ctx, how: string, at: { x: number; y: number }) {
  const w = getWorld(ctx);
  if (w.rescueState !== 'waiting') return;
  const living = [...ctx.db.agent.iter()].filter(a => a.alive).sort((a, b) => distance(a.x, a.y, at.x, at.y) - distance(b.x, b.y, at.x, at.y));
  const taken = w.rescueSeats > 0 ? living.slice(0, w.rescueSeats) : living;
  for (const a of taken) {
    const s = ensureScore(ctx, a.id);
    ctx.db.score.agentId.update({ ...s, rescued: true, reward: s.reward + RESCUE_BONUS });
  }
  const left = living.length - taken.length;
  tellEveryone(ctx, left > 0
    ? `The search plane saw the ${how} and landed. It could carry only ${w.rescueSeats}: it took ${taken.map(a => a.name).join(' and ')}.`
    : `The search plane saw the ${how} and circled back. Rescue is coming.`);
  ctx.db.worldEvent.insert({ kind: 'rescued', x: 0, y: 0, agentId: 0n, otherId: 0n, text: how });
  ctx.db.world.id.update({ ...getWorld(ctx), rescueState: 'rescued', running: false });
  stopTimers(ctx);
}
