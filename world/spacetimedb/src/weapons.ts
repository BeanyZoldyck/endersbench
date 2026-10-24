// The one weapon. Wood makes a spear; at a lit fire a spear becomes a flaming
// spear that never goes out. Whatever a survivor carries, the best of it is
// what they fight with. Nothing here judges anyone.

import type { Agent, Ctx } from './ctx';
import { distance } from './ctx';
import { add, countOf, remove } from './items';
import { addRecord } from './record';
import { ATTACK_DAMAGE, FLAMING_SPEAR_DAMAGE, FORGE_REACH, SPEAR_DAMAGE, SPEAR_WOOD } from './rules';

export type Weapon = 'flaming spear' | 'spear';
// What the craft action is asked for (item kinds), against what canCraft says (plain words).
export type Craftable = 'spear' | 'flaming_spear';

export function isCraftable(v: unknown): v is Craftable {
  return v === 'spear' || v === 'flaming_spear';
}

// The best weapon carried: flaming spear, then spear, then bare hands (null).
export function weaponOf(ctx: Ctx, agentId: bigint): Weapon | null {
  if (countOf(ctx, { agentId }, 'flaming_spear') > 0) return 'flaming spear';
  if (countOf(ctx, { agentId }, 'spear') > 0) return 'spear';
  return null;
}

export function damageFor(weapon: Weapon | null): number {
  return weapon === 'flaming spear' ? FLAMING_SPEAR_DAMAGE : weapon === 'spear' ? SPEAR_DAMAGE : ATTACK_DAMAGE;
}

// Close enough to a lit fire to forge: anyone who walked up to it is.
function atLitFire(ctx: Ctx, me: Agent) {
  return [...ctx.db.structure.iter()].some(
    s => (s.kind === 'campfire' || s.kind === 'signal_fire') && s.lit && distance(me.x, me.y, s.x, s.y) <= FORGE_REACH
  );
}

// What is worth making right now, if anything: a spear from wood while you have
// no spear, a flaming spear from the spear you carry while you stand at a lit fire.
export function canCraft(ctx: Ctx, me: Agent): 'spear' | 'flaming spear' | null {
  const armed = weaponOf(ctx, me.id) !== null;
  if (!armed && countOf(ctx, { agentId: me.id }, 'wood') >= SPEAR_WOOD) return 'spear';
  if (countOf(ctx, { agentId: me.id }, 'spear') > 0 && atLitFire(ctx, me)) return 'flaming spear';
  return null;
}

// Why `item` cannot be made right now, or null when it can.
export function craftBlocker(ctx: Ctx, me: Agent, item: Craftable): string | null {
  if (item === 'spear') return countOf(ctx, { agentId: me.id }, 'wood') < SPEAR_WOOD ? `you need ${SPEAR_WOOD} wood` : null;
  if (countOf(ctx, { agentId: me.id }, 'spear') === 0) return 'you need a spear';
  return atLitFire(ctx, me) ? null : 'you need to be at a lit fire';
}

// Spends the inputs and hands over the result. Only after craftBlocker said null.
export function craftItem(ctx: Ctx, me: Agent, item: Craftable) {
  if (item === 'spear') remove(ctx, { agentId: me.id }, 'wood', SPEAR_WOOD);
  else remove(ctx, { agentId: me.id }, 'spear', 1);
  add(ctx, { agentId: me.id }, item, 1);
  addRecord(ctx, { agentId: me.id, kind: 'crafted', item, qty: 1 });
}
