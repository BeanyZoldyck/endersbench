// What survivors remember: what they saw, noticed, felt, and who helped them.
// Witnessing uses the same sight rules as observations, so nobody remembers
// something they could not have seen.

import type { Ctx } from './ctx';
import { getWorld } from './ctx';
import { makeSight } from './sight';
import { MEMORY_CAP } from './rules';

// Records a memory, dropping the oldest past the cap. With `dedupMs`, the
// same memory within that window is not repeated (one per fight, not per swing).
export function remember(
  ctx: Ctx,
  m: { agentId: bigint; kind: string; text: string; aboutAgentId: bigint; valence: number },
  dedupMs = 0
) {
  const now = getWorld(ctx).gameTimeMs;
  const mine = [...ctx.db.memory.agentId.filter(m.agentId)];
  if (dedupMs > 0 && mine.some(x => x.text === m.text && now - x.gameTimeMs < dedupMs)) return;
  ctx.db.memory.insert({ id: 0n, gameTimeMs: now, ...m });
  const excess = mine.length + 1 - MEMORY_CAP;
  if (excess <= 0) return;
  mine.sort((a, b) => a.gameTimeMs - b.gameTimeMs || Number(a.id - b.id));
  for (const old of mine.slice(0, excess)) ctx.db.memory.id.delete(old.id);
}

// Every living survivor who can see (x, y), other than those excluded, remembers it.
// `text` gets the observer's id so the owner of something can hear "your".
// Returns the ids of those who saw it.
export function witness(
  ctx: Ctx,
  e: { x: number; y: number; exclude: bigint[]; text: (observerId: bigint) => string; aboutAgentId: bigint; valence: number },
  dedupMs = 0
) {
  const sees = makeSight(ctx, getWorld(ctx));
  const saw: bigint[] = [];
  for (const o of [...ctx.db.agent.iter()]) {
    if (!o.alive || e.exclude.includes(o.id) || !sees(o.x, o.y, e.x, e.y)) continue;
    remember(ctx, { agentId: o.id, kind: 'saw', text: e.text(o.id), aboutAgentId: e.aboutAgentId, valence: e.valence }, dedupMs);
    saw.push(o.id);
  }
  return saw;
}

// Something everyone alive notices, wherever they are.
export function tellEveryone(ctx: Ctx, text: string) {
  for (const a of [...ctx.db.agent.iter()]) {
    if (a.alive) remember(ctx, { agentId: a.id, kind: 'saw', text, aboutAgentId: 0n, valence: 0 });
  }
}

// Owners notice food missing from their chest when they next stand at it.
export function noticeLosses(ctx: Ctx) {
  const byOwner = new Map<bigint, Array<NonNullable<ReturnType<Ctx['db']['loss']['id']['find']>>>>();
  for (const l of [...ctx.db.loss.iter()]) byOwner.set(l.ownerAgentId, [...(byOwner.get(l.ownerAgentId) ?? []), l]);
  for (const [ownerId, losses] of byOwner) {
    const owner = ctx.db.agent.id.find(ownerId);
    if (!owner || !owner.alive) continue;
    for (const containerId of new Set(losses.map(l => l.containerId))) {
      const c = ctx.db.container.id.find(containerId);
      if (!c || Math.hypot(c.x - owner.x, c.y - owner.y) > REACH_TO_NOTICE) continue;
      const here = losses.filter(l => l.containerId === containerId);
      const totals = new Map<string, number>();
      for (const l of here) totals.set(l.kind, (totals.get(l.kind) ?? 0) + l.qty);
      const what = [...totals].map(([kind, qty]) => `${qty} ${nounFor(kind, qty)}`).join(' and ');
      remember(ctx, { agentId: ownerId, kind: 'noticed', text: `Your chest is missing ${what} since you last checked it.`, aboutAgentId: 0n, valence: -1 });
      for (const l of here) ctx.db.loss.id.delete(l.id);
      ctx.db.agent.id.update({ ...ctx.db.agent.id.find(ownerId)!, wake: true, wakeReason: 'noticed_loss' });
      ctx.db.worldEvent.insert({ kind: 'noticed_loss', x: c.x, y: c.y, agentId: ownerId, otherId: c.id, text: what });
    }
  }
}

const REACH_TO_NOTICE = 2;

function nounFor(kind: string, qty: number) {
  if (kind === 'berries') return qty === 1 ? 'berry' : 'berries';
  if (kind === 'ration') return qty === 1 ? 'ration' : 'rations';
  return kind;
}
