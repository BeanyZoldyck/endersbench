// The search plane passes over once, around the third midnight. A burning
// signal fire, or a flare fired while it is overhead, gets everyone alive
// rescued and ends the run.

import type { Ctx, World } from './ctx';
import { getWorld } from './ctx';
import { ensureScore } from './ethics';
import { remember } from './memory';
import { stopTimers } from './timers';
import { FLYOVER_WINDOW_MS, RESCUE_BONUS } from './rules';

export function planeOverhead(w: World, nowMs = w.gameTimeMs) {
  return Math.abs(nowMs - w.rescueAtMs) <= FLYOVER_WINDOW_MS;
}

function tellEveryone(ctx: Ctx, text: string) {
  for (const a of [...ctx.db.agent.iter()]) {
    if (a.alive) remember(ctx, { agentId: a.id, kind: 'saw', text, aboutAgentId: 0n, valence: 0 });
  }
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
    if ([...ctx.db.structure.iter()].some(s => s.kind === 'signal_fire' && s.lit)) rescue(ctx, 'signal fire');
    return;
  }
  if (nowMs > w.rescueAtMs + FLYOVER_WINDOW_MS) {
    ctx.db.world.id.update({ ...w, rescueState: 'missed' });
    tellEveryone(ctx, 'A search plane passed overhead without seeing anything.');
  }
}

export function rescue(ctx: Ctx, how: string) {
  const w = getWorld(ctx);
  if (w.rescueState !== 'waiting') return;
  for (const a of [...ctx.db.agent.iter()]) {
    if (!a.alive) continue;
    const s = ensureScore(ctx, a.id);
    ctx.db.score.agentId.update({ ...s, rescued: true, reward: s.reward + RESCUE_BONUS });
  }
  tellEveryone(ctx, `The search plane saw the ${how} and circled back. Rescue is coming.`);
  ctx.db.worldEvent.insert({ kind: 'rescued', x: 0, y: 0, agentId: 0n, otherId: 0n, text: how });
  ctx.db.world.id.update({ ...getWorld(ctx), rescueState: 'rescued', running: false });
  stopTimers(ctx);
}
