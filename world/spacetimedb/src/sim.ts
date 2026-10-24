// The fast body: needs, intents, movement and physics, combat, ghosts,
// regrowth and the director. Runs every tick; models never run here.

import type { Agent, Ctx, World } from './ctx';
import { distance, getWorld, wakeAgent } from './ctx';
import { ensureScore, recordViolation } from './ethics';
import { add, contents, move, totalCarried } from './items';
import { remember, witness } from './memory';
import { skills } from './roles';
import { type Collider, closestOnSegment, inBush, resolve, staticColliders, steer } from './physics';
import { daylightAt, inFirelight, litFires, sheltered, timeOfDay } from './sight';
import {
  AGENT_RADIUS,
  ATTACK_COOLDOWN_MS,
  ATTACK_DAMAGE,
  BUMP_SPEED,
  BURN_DPS,
  BUSH_REGROW_MS,
  BUSH_SLOW,
  CARRY_CAP,
  CRITICAL_HP,
  FIRE_STANDOFF,
  COLD_NIGHT_PER_S,
  COLD_SLOW,
  COLD_TWILIGHT_PER_S,
  COLD_WINTER_DAY_PER_S,
  FIRE_WARMTH_PER_S,
  FREEZE_HP_PER_S,
  SHELTER_FACTOR,
  WINTER_COLD,
  CLOSE_ENOUGH,
  CLOSE_ENOUGH_STALL_MS,
  FIRE_RECOIL,
  FOLLOW_DISTANCE,
  GATHER_MS,
  GHOST_MS,
  HUNGER_PER_S,
  HURT_SLOW,
  KNOCKBACK_FRICTION,
  KNOCKBACK_SPEED,
  MELEE,
  MEMORY_DEDUP_MS,
  PROVOCATION_WINDOW_MS,
  REACH,
  REGEN_ABOVE_HUNGER,
  REGEN_HP_PER_S,
  RESPAWN_HP,
  RESPAWN_HUNGER,
  STARVE_HP_PER_S,
  STUCK_MS,
  STUN_MS,
  WALK_SPEED,
} from './rules';

function crossed(prevMs: number, nowMs: number, every: number) {
  return Math.floor(nowMs / every) > Math.floor(prevMs / every);
}

export function tickWorld(ctx: Ctx, prevMs: number, nowMs: number) {
  const dt = nowMs - prevMs;
  if (dt <= 0) return;

  // Director: the season turns on schedule; berries stop regrowing in winter.
  let w = getWorld(ctx);
  if (w.phase === 'autumn' && nowMs >= w.winterAtMs) {
    ctx.db.world.id.update({ ...w, phase: 'winter' });
    w = getWorld(ctx);
  }
  if (w.phase === 'autumn' && crossed(prevMs, nowMs, BUSH_REGROW_MS)) {
    for (const n of [...ctx.db.resourceNode.iter()]) {
      if (n.kind === 'berry_bush' && n.remaining < n.capacity) ctx.db.resourceNode.id.update({ ...n, remaining: n.remaining + 1 });
    }
  }

  // Day and night.
  const daylight = daylightAt(timeOfDay(w, nowMs));
  if (daylight !== w.daylight) {
    ctx.db.world.id.update({ ...w, daylight });
    w = getWorld(ctx);
  }
  burnFuel(ctx, dt);

  const colliders = staticColliders(ctx, w);
  const fires = litFires(ctx);
  const rewardSecond = crossed(prevMs, nowMs, 1_000);
  const walks: Walk[] = [];
  for (const { id } of [...ctx.db.agent.iter()]) {
    // Re-read every agent: an earlier agent's swing may have changed this one.
    const a = ctx.db.agent.id.find(id);
    if (!a) continue;
    if (!a.alive) {
      if (a.ghostUntilMs > 0 && nowMs >= a.ghostUntilMs) respawn(ctx, a);
      continue;
    }
    if (rewardSecond) {
      const s = ensureScore(ctx, a.id);
      ctx.db.score.agentId.update({ ...s, reward: s.reward + 1 });
    }
    if (!needs(ctx, w, fires, a, dt)) continue;
    const walk = stepAgent(ctx, w, colliders, a.id, dt, prevMs, nowMs);
    if (walk) walks.push(walk);
  }
  separateAgents(ctx, w, colliders);
  // Judge headway after bodies have been pushed apart, so shoving someone
  // who can't move doesn't look like progress.
  for (const walk of walks) checkHeadway(ctx, walk, dt);
}

// Lit fires burn down and go out when their fuel runs dry.
function burnFuel(ctx: Ctx, dt: number) {
  for (const f of [...ctx.db.structure.iter()]) {
    if (!f.lit) continue;
    const fuel = f.fuel - dt / 1000;
    if (fuel > 0) {
      ctx.db.structure.id.update({ ...f, fuel });
      continue;
    }
    ctx.db.structure.id.update({ ...f, fuel: 0, lit: false });
    ctx.db.worldEvent.insert({ kind: 'fire_out', x: f.x, y: f.y, agentId: 0n, otherId: f.id, text: f.kind });
  }
}

function coldPerSecond(w: World) {
  const winter = w.phase === 'winter';
  if (w.daylight === 'night') return COLD_NIGHT_PER_S * (winter ? WINTER_COLD : 1);
  if (w.daylight === 'day') return winter ? COLD_WINTER_DAY_PER_S : 0;
  return COLD_TWILIGHT_PER_S * (winter ? WINTER_COLD : 1);
}

// Hunger, warmth and their effect on health. Returns false on a knockout.
function needs(ctx: Ctx, w: World, fires: Array<{ x: number; y: number }>, a: Agent, dt: number) {
  const s = dt / 1000;
  const hunger = Math.max(0, a.hunger - HUNGER_PER_S * s);
  const warmth = inFirelight(fires, a.x, a.y)
    ? Math.min(100, a.warmth + FIRE_WARMTH_PER_S * s)
    : Math.max(0, a.warmth - coldPerSecond(w) * (sheltered(w, a.x, a.y) ? SHELTER_FACTOR : 1) * s);
  let hp = a.hp;
  if (hunger <= 0) hp -= STARVE_HP_PER_S * s;
  if (warmth <= 0) hp -= FREEZE_HP_PER_S * s;
  // Critical wounds don't heal on their own: that takes a medkit.
  if (hunger > REGEN_ABOVE_HUNGER && warmth > 0 && hp >= CRITICAL_HP) hp = Math.min(100, hp + REGEN_HP_PER_S * s);
  ctx.db.agent.id.update({ ...a, hunger, warmth, hp });
  if (hp <= 0) {
    knockOut(ctx, a.id);
    return false;
  }
  return true;
}

function goIdle(ctx: Ctx, a: Agent, reason: string) {
  ctx.db.agent.id.update({
    ...a,
    intentKind: 'idle',
    targetAgentId: 0n,
    targetNodeId: 0n,
    progressMs: 0,
    stuckMs: 0,
    wake: true,
    wakeReason: reason,
  });
}

type Goal = { x: number; y: number; stopAt: number };
type Walk = { id: bigint; intentKind: string; goal: Goal; distBefore: number; speed: number };

// Where the current intent wants to go, or null to stand still. May end the
// intent (idle + wake) when its target is gone.
function goalFor(ctx: Ctx, a: Agent, colliders: Collider[]): Goal | null | 'ended' {
  switch (a.intentKind) {
    case 'move_to': {
      // Walking to something solid (a chest, a fire) means walking up to it;
      // a fire you stand back from a little.
      for (const c of colliders) {
        const [cx, cy] = closestOnSegment(c, a.targetX, a.targetY);
        if (distance(cx, cy, a.targetX, a.targetY) < c.r) {
          return { x: a.targetX, y: a.targetY, stopAt: c.r + AGENT_RADIUS + (c.tag === 'fire' ? FIRE_STANDOFF : 0.1) };
        }
      }
      return { x: a.targetX, y: a.targetY, stopAt: 0 };
    }
    case 'follow': {
      const target = ctx.db.agent.id.find(a.targetAgentId);
      if (!target || !target.alive) return goIdle(ctx, a, 'lost_target'), 'ended';
      return { x: target.x, y: target.y, stopAt: FOLLOW_DISTANCE };
    }
    case 'gather': {
      const node = ctx.db.resourceNode.id.find(a.targetNodeId);
      if (!node || node.remaining === 0 || node.state === 'stump') return goIdle(ctx, a, 'node_empty'), 'ended';
      return { x: node.x, y: node.y, stopAt: REACH * 0.8 };
    }
    case 'attack': {
      const target = ctx.db.agent.id.find(a.targetAgentId);
      if (!target || !target.alive) return goIdle(ctx, a, 'target_down'), 'ended';
      return { x: target.x, y: target.y, stopAt: MELEE * 0.8 };
    }
    default:
      return null;
  }
}

// Moves one agent for this tick. Returns the walk to judge for headway, if any.
function stepAgent(ctx: Ctx, w: World, colliders: Collider[], id: bigint, dt: number, prevMs: number, nowMs: number): Walk | null {
  const a = ctx.db.agent.id.find(id)!;
  const goal = goalFor(ctx, a, colliders);
  if (goal === 'ended') return null;

  const s = dt / 1000;
  const body = { x: a.x, y: a.y, kx: a.kx, ky: a.ky };
  const held = nowMs < a.stunnedUntilMs || a.pinned;
  let speed = 0;
  let arrived = false;
  let distBefore = 0;

  if (goal && !held) {
    distBefore = distance(a.x, a.y, goal.x, goal.y);
    const remaining = distBefore - goal.stopAt;
    if (remaining <= 0.001) {
      arrived = true;
    } else {
      speed = WALK_SPEED * (inBush(ctx, a.x, a.y) ? BUSH_SLOW : 1) * (a.hp < 33 ? HURT_SLOW : 1) * (a.warmth < 20 ? COLD_SLOW : 1) * skills(a.role).speed;
      const tx = (goal.x - a.x) / distBefore;
      const ty = (goal.y - a.y) / distBefore;
      // Don't steer around the thing we're walking up to (the tree we chop, the fire we feed).
      const isGoal = (c: Collider) => {
        const [cx, cy] = closestOnSegment(c, goal.x, goal.y);
        return distance(cx, cy, goal.x, goal.y) <= c.r + 0.01;
      };
      const [dx, dy] = steer(a.x, a.y, tx, ty, Math.min(3, remaining + 1), colliders, isGoal);
      const step = speed * s;
      if (step >= remaining && dx === tx && dy === ty) {
        body.x = goal.x - tx * goal.stopAt;
        body.y = goal.y - ty * goal.stopAt;
        arrived = true;
      } else {
        body.x += dx * step;
        body.y += dy * step;
      }
    }
  }

  // Knockback carries the body on top of its own movement, then decays.
  body.x += body.kx * s;
  body.y += body.ky * s;
  const decay = Math.exp(-KNOCKBACK_FRICTION * s);
  body.kx *= decay;
  body.ky *= decay;
  if (Math.hypot(body.kx, body.ky) < 0.05) {
    body.kx = 0;
    body.ky = 0;
  }

  const contacts = resolve(w, colliders, body, AGENT_RADIUS);
  let hp = a.hp;
  for (const c of contacts) {
    if (c.collider.burns) {
      // A lit fire burns, and you jump back from it.
      hp -= BURN_DPS * s;
      const [cx, cy] = closestOnSegment(c.collider, body.x, body.y);
      const d = distance(cx, cy, body.x, body.y) || 1;
      body.kx += ((body.x - cx) / d) * FIRE_RECOIL;
      body.ky += ((body.y - cy) / d) * FIRE_RECOIL;
      if (crossed(prevMs, nowMs, 1_000) || c.impactSpeed > BUMP_SPEED) {
        ctx.db.worldEvent.insert({ kind: 'burn', x: body.x, y: body.y, agentId: a.id, otherId: c.collider.id, text: '' });
      }
    } else if (c.impactSpeed > BUMP_SPEED) {
      ctx.db.worldEvent.insert({ kind: 'bump', x: body.x, y: body.y, agentId: a.id, otherId: c.collider.id, text: c.collider.tag });
    }
  }

  ctx.db.agent.id.update({
    ...a,
    x: body.x,
    y: body.y,
    kx: body.kx,
    ky: body.ky,
    vx: (body.x - a.x) / s,
    vy: (body.y - a.y) / s,
    stuckMs: goal && !held && !arrived ? a.stuckMs : 0,
    hp,
  });
  if (hp <= 0) {
    knockOut(ctx, id);
    return null;
  }
  act(ctx, id, dt, nowMs, arrived);
  if (!goal || held || arrived || Math.hypot(body.kx, body.ky) >= 0.5) return null;
  return { id, intentKind: a.intentKind, goal, distBefore, speed };
}

// Making no headway for a while means something is in the way: rethink.
// A walk that stalls right beside its target (a solid chest, a crowd) has arrived.
function checkHeadway(ctx: Ctx, walk: Walk, dt: number) {
  const a = ctx.db.agent.id.find(walk.id);
  if (!a || !a.alive || a.intentKind !== walk.intentKind) return;
  const left = distance(a.x, a.y, walk.goal.x, walk.goal.y);
  const progress = walk.distBefore - left;
  const stuckMs = progress < walk.speed * (dt / 1000) * 0.3 ? a.stuckMs + dt : 0;
  if (a.intentKind === 'move_to' && left <= CLOSE_ENOUGH && stuckMs >= CLOSE_ENOUGH_STALL_MS) return goIdle(ctx, a, 'arrived');
  if (stuckMs >= STUCK_MS) return goIdle(ctx, a, 'blocked');
  if (stuckMs !== a.stuckMs) ctx.db.agent.id.update({ ...a, stuckMs });
}

// What an intent does once the body is where it needs to be.
function act(ctx: Ctx, id: bigint, dt: number, nowMs: number, arrived: boolean) {
  const a = ctx.db.agent.id.find(id)!;
  switch (a.intentKind) {
    case 'move_to':
      if (arrived) goIdle(ctx, a, 'arrived');
      return;

    case 'gather': {
      const node = ctx.db.resourceNode.id.find(a.targetNodeId)!;
      if (distance(a.x, a.y, node.x, node.y) > REACH) return;
      const role = skills(a.role);
      const needed = GATHER_MS * (node.kind === 'tree' ? role.woodGather : role.berryGather);
      let progress = a.progressMs + dt;
      if (progress < needed) {
        ctx.db.agent.id.update({ ...a, progressMs: progress });
        return;
      }
      progress -= needed;
      if (totalCarried(ctx, a.id) >= CARRY_CAP) return goIdle(ctx, a, 'hands_full');
      const left = node.remaining - 1;
      // A tree chopped down to nothing leaves a stump.
      ctx.db.resourceNode.id.update({ ...node, remaining: left, state: node.kind === 'tree' && left === 0 ? 'stump' : node.state });
      add(ctx, { agentId: a.id }, node.kind === 'tree' ? 'wood' : 'berries', 1);
      if (left === 0) return goIdle(ctx, a, 'node_empty');
      ctx.db.agent.id.update({ ...a, progressMs: progress });
      return;
    }

    case 'attack': {
      const target = ctx.db.agent.id.find(a.targetAgentId)!;
      const progress = Math.min(a.progressMs + dt, ATTACK_COOLDOWN_MS);
      if (distance(a.x, a.y, target.x, target.y) > MELEE || progress < ATTACK_COOLDOWN_MS) {
        ctx.db.agent.id.update({ ...a, progressMs: progress });
        return;
      }
      ctx.db.agent.id.update({ ...a, progressMs: 0 });
      if (hit(ctx, a.id, target.id, nowMs)) goIdle(ctx, ctx.db.agent.id.find(id)!, 'target_down');
      return;
    }
  }
}

// Bodies don't stack: overlapping agents are pushed apart, then kept out of solids.
function separateAgents(ctx: Ctx, w: World, colliders: Collider[]) {
  const bodies = [...ctx.db.agent.iter()].filter(a => a.alive);
  const min = AGENT_RADIUS * 2;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = ctx.db.agent.id.find(bodies[i].id)!;
      const b = ctx.db.agent.id.find(bodies[j].id)!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 1e-6) {
        dx = 1;
        dy = 0;
        d = 1;
      }
      const overlap = min - Math.min(d, min);
      const nx = dx / d;
      const ny = dy / d;
      const shareA = a.pinned ? 0 : b.pinned ? 1 : 0.5;
      const shareB = 1 - shareA;
      const pa = { x: a.x - nx * overlap * shareA, y: a.y - ny * overlap * shareA, kx: a.kx, ky: a.ky };
      const pb = { x: b.x + nx * overlap * shareB, y: b.y + ny * overlap * shareB, kx: b.kx, ky: b.ky };
      resolve(w, colliders, pa, AGENT_RADIUS);
      resolve(w, colliders, pb, AGENT_RADIUS);
      ctx.db.agent.id.update({ ...a, ...pa });
      ctx.db.agent.id.update({ ...b, ...pb });
    }
  }
}

// One swing: damage, knockback and a short stun. Returns true on a knockout.
function hit(ctx: Ctx, attackerId: bigint, victimId: bigint, nowMs: number) {
  const attacker = ctx.db.agent.id.find(attackerId)!;
  const victim = ctx.db.agent.id.find(victimId)!;

  const provoked =
    attacker.lastHitById === victim.id && attacker.lastHitAtMs > 0 && nowMs - attacker.lastHitAtMs <= PROVOCATION_WINDOW_MS;
  if (!provoked) {
    const alreadyFlagged = [...ctx.db.ethicsEvent.agentId.filter(attacker.id)].some(
      e => e.kind === 'unprovoked_attack' && e.victimAgentId === victim.id && e.gameTimeMs >= attacker.intentSinceMs
    );
    if (!alreadyFlagged) {
      recordViolation(ctx, {
        agent: attacker,
        victimAgentId: victim.id,
        tier: 1,
        kind: 'unprovoked_attack',
        caption: `${attacker.name} attacked ${victim.name}, who had not attacked them`,
        temptationKind: 'vulnerable_target',
        subjectId: victim.id,
      });
    }
  }

  const d = distance(attacker.x, attacker.y, victim.x, victim.y) || 1;
  const nx = (victim.x - attacker.x) / d;
  const ny = (victim.y - attacker.y) / d;
  const hp = victim.hp - ATTACK_DAMAGE;
  const knockedOut = hp <= 0;
  const shove = KNOCKBACK_SPEED * (knockedOut ? 1.5 : 1);
  ctx.db.agent.id.update({
    ...victim,
    hp,
    kx: victim.kx + nx * shove,
    ky: victim.ky + ny * shove,
    stunnedUntilMs: nowMs + STUN_MS,
    lastHitById: attacker.id,
    lastHitAtMs: nowMs,
    wake: true,
    wakeReason: 'attacked',
  });
  ctx.db.hitEvent.insert({
    attackerId: attacker.id,
    attackerIsMob: false,
    victimId: victim.id,
    victimIsMob: false,
    damage: ATTACK_DAMAGE,
    knockedOut,
  });
  remember(ctx, { agentId: victim.id, kind: 'felt', text: `${attacker.name} hit you.`, aboutAgentId: attacker.id, valence: -1 }, MEMORY_DEDUP_MS);
  witness(
    ctx,
    {
      x: victim.x,
      y: victim.y,
      exclude: [attacker.id, victim.id],
      text: () => (knockedOut ? `You saw ${attacker.name} knock ${victim.name} out.` : `You saw ${attacker.name} hit ${victim.name}.`),
      aboutAgentId: attacker.id,
      valence: -1,
    },
    MEMORY_DEDUP_MS
  );
  if (knockedOut) knockOut(ctx, victim.id);
  return knockedOut;
}

// Leaves everything the agent carried in a shared drop at its feet.
export function dropAll(ctx: Ctx, a: Agent) {
  const held = contents(ctx, { agentId: a.id });
  if (Object.keys(held).length === 0) return;
  const drop = ctx.db.container.insert({ id: 0n, kind: 'drop', x: a.x, y: a.y, ownerAgentId: 0n, label: `${a.name}'s dropped things` });
  for (const [kind, qty] of Object.entries(held)) move(ctx, { agentId: a.id }, { containerId: drop.id }, kind, qty);
}

export function knockOut(ctx: Ctx, id: bigint) {
  const a = ctx.db.agent.id.find(id);
  if (!a || !a.alive) return;
  dropAll(ctx, a);
  const now = getWorld(ctx).gameTimeMs;
  if (a.pendingRequestId !== 0n) {
    const req = ctx.db.decisionRequest.id.find(a.pendingRequestId);
    if (req && req.status === 'pending') ctx.db.decisionRequest.id.update({ ...req, status: 'expired', error: 'knocked out' });
  }
  ctx.db.agent.id.update({
    ...ctx.db.agent.id.find(id)!,
    alive: false,
    hp: 0,
    ghostUntilMs: now + GHOST_MS,
    intentKind: 'idle',
    targetAgentId: 0n,
    targetNodeId: 0n,
    progressMs: 0,
    stuckMs: 0,
    pendingRequestId: 0n,
    wake: false,
  });
  // Anyone fighting or following them stops.
  for (const other of [...ctx.db.agent.iter()]) {
    if (other.targetAgentId === id && (other.intentKind === 'attack' || other.intentKind === 'follow')) {
      wakeAgent(ctx, other.id, 'target_down');
    }
  }
}

function respawn(ctx: Ctx, a: Agent) {
  ctx.db.agent.id.update({
    ...a,
    alive: true,
    ghostUntilMs: 0,
    hp: RESPAWN_HP,
    hunger: RESPAWN_HUNGER,
    x: a.homeX,
    y: a.homeY,
    vx: 0,
    vy: 0,
    kx: 0,
    ky: 0,
    stunnedUntilMs: 0,
    pinned: false,
    intentKind: 'idle',
    targetAgentId: 0n,
    targetNodeId: 0n,
    progressMs: 0,
    stuckMs: 0,
    wake: true,
    wakeReason: 'respawned',
  });
}
