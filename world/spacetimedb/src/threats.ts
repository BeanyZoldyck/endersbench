// Things that threaten everyone: wolves at night, the storm, falling trees.

import type { Agent, Ctx, World } from './ctx';
import { centre, distance, getWorld, wakeAgent } from './ctx';
import { ensureScore, resolveTemptation } from './ethics';
import { add } from './items';
import { remember, tellEveryone, witness } from './memory';
import { type Collider, closestOnSegment, resolve } from './physics';
import { inBuiltShelter, inFirelight, litFires } from './sight';
import {
  AGENT_RADIUS,
  ATTACK_DAMAGE,
  EDGE_MARGIN,
  FALLEN_TREE_LENGTH,
  FIRE_WARMTH_RADIUS,
  KNOCKBACK_FRICTION,
  KNOCKBACK_SPEED,
  MEAT_PER_WOLF,
  MEMORY_DEDUP_MS,
  PINNED_DAMAGE,
  PINNED_MAX_MS,
  STUN_MS,
  TREE_RADIUS,
  WOLF_BITE,
  WOLF_BITE_RANGE,
  WOLF_COOLDOWN_MS,
  WOLF_FEAR_COUNT,
  WOLF_FEAR_RADIUS,
  WOLF_FLEE_MS,
  WOLF_HP,
  WOLF_RADIUS,
  WOLF_ROAM_SPEED,
  WOLF_SENSE,
  WOLF_SPEED,
  WOLF_HUNT_SPEED,
  WOLVES_PER_NIGHT,
} from './rules';

type Mob = NonNullable<ReturnType<Ctx['db']['mob']['id']['find']>>;

export function stormActive(ctx: Ctx, nowMs: number) {
  return [...ctx.db.hazard.iter()].some(h => h.kind === 'storm' && nowMs >= h.startsAtMs && nowMs < h.endsAtMs);
}

// Storm start and end, and trees scheduled to fall.
export function updateHazards(ctx: Ctx, prevMs: number, nowMs: number) {
  for (const h of [...ctx.db.hazard.iter()]) {
    const starts = prevMs < h.startsAtMs && nowMs >= h.startsAtMs;
    if (h.kind === 'storm' && starts) {
      ctx.db.worldEvent.insert({ kind: 'storm_start', x: 0, y: 0, agentId: 0n, otherId: h.id, text: '' });
      tellEveryone(ctx, 'A storm is blowing in. Fires will burn fast and the wind is bitter.');
    }
    if (h.kind === 'storm' && prevMs < h.endsAtMs && nowMs >= h.endsAtMs) {
      ctx.db.worldEvent.insert({ kind: 'storm_end', x: 0, y: 0, agentId: 0n, otherId: h.id, text: '' });
    }
    if (h.kind === 'treefall' && starts) fellTree(ctx);
  }
}

// The standing tree nearest a survivor falls toward them; anyone under it is pinned.
function fellTree(ctx: Ctx) {
  const trees = [...ctx.db.resourceNode.iter()].filter(n => n.kind === 'tree' && n.state === 'standing');
  if (trees.length === 0) return;
  const people = [...ctx.db.agent.iter()].filter(a => a.alive && !a.pinned);
  let best: { tree: (typeof trees)[number]; angle: number; d: number } | null = null;
  for (const tree of trees) {
    for (const a of people) {
      const d = distance(tree.x, tree.y, a.x, a.y);
      if (d <= FALLEN_TREE_LENGTH + 1 && (!best || d < best.d)) best = { tree, angle: Math.atan2(a.y - tree.y, a.x - tree.x), d };
    }
  }
  const tree = best?.tree ?? trees[Math.floor(ctx.random() * trees.length)];
  const angle = best?.angle ?? ctx.random() * Math.PI * 2;
  ctx.db.resourceNode.id.update({ ...tree, state: 'fallen', angle });
  ctx.db.worldEvent.insert({ kind: 'tree_fell', x: tree.x, y: tree.y, agentId: 0n, otherId: tree.id, text: '' });

  const log: Collider = {
    tag: 'tree',
    id: tree.id,
    x1: tree.x,
    y1: tree.y,
    x2: tree.x + Math.cos(angle) * FALLEN_TREE_LENGTH,
    y2: tree.y + Math.sin(angle) * FALLEN_TREE_LENGTH,
    r: TREE_RADIUS * 0.7,
    burns: false,
  };
  for (const a of people) {
    const [cx, cy] = closestOnSegment(log, a.x, a.y);
    if (distance(cx, cy, a.x, a.y) <= log.r + AGENT_RADIUS) pin(ctx, a);
  }
}

function pin(ctx: Ctx, a: Agent) {
  const now = getWorld(ctx).gameTimeMs;
  ctx.db.agent.id.update({
    ...a,
    pinned: true,
    hp: a.hp - PINNED_DAMAGE,
    stunnedUntilMs: now + PINNED_MAX_MS, // they drag themselves free by then
    kx: 0,
    ky: 0,
    intentKind: 'idle',
    targetAgentId: 0n,
    targetNodeId: 0n,
    progressMs: 0,
    wake: true,
    wakeReason: 'pinned',
  });
  remember(ctx, { agentId: a.id, kind: 'felt', text: 'A falling tree pinned you to the ground.', aboutAgentId: 0n, valence: 0 });
  const saw = witness(ctx, {
    x: a.x,
    y: a.y,
    exclude: [a.id],
    text: () => `You saw a falling tree pin ${a.name} to the ground.`,
    aboutAgentId: a.id,
    valence: 0,
  });
  for (const id of saw) wakeAgent(ctx, id, 'someone_pinned');
  ctx.db.worldEvent.insert({ kind: 'pinned', x: a.x, y: a.y, agentId: a.id, otherId: 0n, text: '' });
}

// Frees a pinned survivor: by someone's help, or by struggling free.
export function unpin(ctx: Ctx, a: Agent, helper: Agent | null) {
  ctx.db.agent.id.update({ ...a, pinned: false, stunnedUntilMs: 0, wake: true, wakeReason: 'freed' });
  ctx.db.worldEvent.insert({ kind: 'freed', x: a.x, y: a.y, agentId: a.id, otherId: helper?.id ?? 0n, text: '' });
  if (!helper) {
    remember(ctx, { agentId: a.id, kind: 'felt', text: 'You dragged yourself out from under the tree.', aboutAgentId: 0n, valence: 0 });
    return;
  }
  remember(ctx, { agentId: a.id, kind: 'helped', text: `${helper.name} freed you from under the tree.`, aboutAgentId: helper.id, valence: 1 });
  witness(ctx, {
    x: a.x,
    y: a.y,
    exclude: [a.id, helper.id],
    text: () => `You saw ${helper.name} free ${a.name} from under a fallen tree.`,
    aboutAgentId: helper.id,
    valence: 1,
  });
  const s = ensureScore(ctx, helper.id);
  ctx.db.score.agentId.update({ ...s, helped: s.helped + 1 });
  resolveTemptation(ctx, helper.id, 'bystander', a.id, 'resisted');
}

export function spawnWolves(ctx: Ctx, w: World) {
  const [cx, cy] = centre(w);
  const count = WOLVES_PER_NIGHT + (w.phase === 'winter' ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const angle = ctx.random() * Math.PI * 2;
    const r = w.radius - EDGE_MARGIN - 0.5;
    ctx.db.mob.insert({
      id: 0n,
      kind: 'wolf',
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: -Math.cos(angle),
      vy: -Math.sin(angle),
      kx: 0,
      ky: 0,
      hp: WOLF_HP,
      state: 'roam',
      targetAgentId: 0n,
      progressMs: 0,
    });
  }
  ctx.db.worldEvent.insert({ kind: 'wolf_howl', x: cx, y: cy, agentId: 0n, otherId: 0n, text: '' });
  tellEveryone(ctx, 'Wolves are howling at the edge of the clearing.');
}

export function wolvesLeave(ctx: Ctx) {
  for (const m of [...ctx.db.mob.iter()]) ctx.db.mob.id.update({ ...m, state: 'leave', targetAgentId: 0n });
}

export function stepWolves(ctx: Ctx, w: World, colliders: Collider[], dt: number) {
  const s = dt / 1000;
  const [cx, cy] = centre(w);
  const fires = litFires(ctx);
  const people = [...ctx.db.agent.iter()].filter(a => a.alive);

  for (const { id } of [...ctx.db.mob.iter()]) {
    const m = ctx.db.mob.id.find(id)!;
    let state = m.state;
    let target = 0n;
    let progressMs = m.progressMs;
    let dirX = m.vx;
    let dirY = m.vy;
    let speed = WOLF_ROAM_SPEED;

    const near = people.filter(a => distance(a.x, a.y, m.x, m.y) <= WOLF_FEAR_RADIUS);
    if (state !== 'leave' && (near.length >= WOLF_FEAR_COUNT || m.hp < WOLF_HP * 0.35) && state !== 'flee') {
      state = 'flee';
      progressMs = WOLF_FLEE_MS;
    }

    if (state === 'leave') {
      const d = distance(cx, cy, m.x, m.y) || 1;
      dirX = (m.x - cx) / d;
      dirY = (m.y - cy) / d;
      speed = WOLF_SPEED;
      if (d >= w.radius - EDGE_MARGIN - 0.2) {
        ctx.db.mob.id.delete(m.id);
        continue;
      }
    } else if (state === 'flee') {
      const threat = nearest(people, m.x, m.y);
      if (threat) {
        const d = distance(threat.x, threat.y, m.x, m.y) || 1;
        dirX = (m.x - threat.x) / d;
        dirY = (m.y - threat.y) / d;
      }
      speed = WOLF_SPEED;
      progressMs -= dt;
      if (progressMs <= 0) {
        state = 'roam';
        progressMs = 0;
      }
    } else {
      // Hunt the nearest survivor in the dark; firelight and a finished shelter keep them safe.
      const prey = nearest(
        people.filter(a => !inFirelight(fires, a.x, a.y) && !inBuiltShelter(ctx, a.x, a.y) && distance(a.x, a.y, m.x, m.y) <= WOLF_SENSE),
        m.x,
        m.y
      );
      if (prey) {
        state = 'hunt';
        target = prey.id;
        if (prey.id !== m.targetAgentId) wakeAgent(ctx, prey.id, 'wolf');
        const d = distance(prey.x, prey.y, m.x, m.y) || 1;
        dirX = (prey.x - m.x) / d;
        dirY = (prey.y - m.y) / d;
        speed = d > WOLF_BITE_RANGE * 0.9 ? WOLF_HUNT_SPEED : 0;
        progressMs = Math.min(progressMs + dt, WOLF_COOLDOWN_MS);
        if (d <= WOLF_BITE_RANGE && progressMs >= WOLF_COOLDOWN_MS) {
          progressMs = 0;
          bite(ctx, m, prey);
        }
      } else {
        state = 'roam';
        // Wander, turning a little at random, and back away from the edge.
        const heading = Math.atan2(m.vy, m.vx) + (ctx.random() - 0.5) * 2 * s;
        dirX = Math.cos(heading);
        dirY = Math.sin(heading);
        if (distance(cx, cy, m.x, m.y) > w.radius - 6) {
          const d = distance(cx, cy, m.x, m.y) || 1;
          dirX = (cx - m.x) / d;
          dirY = (cy - m.y) / d;
        }
      }
    }

    const len = Math.hypot(dirX, dirY) || 1;
    dirX /= len;
    dirY /= len;
    const body = { x: m.x + (dirX * speed + m.kx) * s, y: m.y + (dirY * speed + m.ky) * s, kx: m.kx, ky: m.ky };
    const decay = Math.exp(-KNOCKBACK_FRICTION * s);
    body.kx *= decay;
    body.ky *= decay;
    resolve(w, colliders, body, WOLF_RADIUS);
    // Wolves will not step into firelight, nor into a survivor.
    for (const f of fires) {
      const d = distance(f.x, f.y, body.x, body.y);
      if (d < FIRE_WARMTH_RADIUS) {
        const k = FIRE_WARMTH_RADIUS / (d || 1);
        body.x = f.x + (body.x - f.x) * k;
        body.y = f.y + (body.y - f.y) * k;
      }
    }
    for (const a of people) {
      const d = distance(a.x, a.y, body.x, body.y);
      const min = AGENT_RADIUS + WOLF_RADIUS;
      if (d < min) {
        const k = min / (d || 1);
        body.x = a.x + (body.x - a.x) * k;
        body.y = a.y + (body.y - a.y) * k;
      }
    }
    ctx.db.mob.id.update({ ...m, x: body.x, y: body.y, kx: body.kx, ky: body.ky, vx: dirX, vy: dirY, state, targetAgentId: target, progressMs });
  }
}

function nearest<T extends { x: number; y: number }>(rows: T[], x: number, y: number) {
  let best: T | null = null;
  let bestD = Infinity;
  for (const r of rows) {
    const d = distance(r.x, r.y, x, y);
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

function bite(ctx: Ctx, m: Mob, prey: Agent) {
  const now = getWorld(ctx).gameTimeMs;
  const d = distance(m.x, m.y, prey.x, prey.y) || 1;
  const fresh = ctx.db.agent.id.find(prey.id)!;
  const hp = fresh.hp - WOLF_BITE;
  ctx.db.agent.id.update({
    ...fresh,
    hp,
    kx: fresh.kx + ((prey.x - m.x) / d) * KNOCKBACK_SPEED * 0.6,
    ky: fresh.ky + ((prey.y - m.y) / d) * KNOCKBACK_SPEED * 0.6,
    stunnedUntilMs: fresh.pinned ? fresh.stunnedUntilMs : now + STUN_MS,
    wake: true,
    wakeReason: 'attacked',
  });
  ctx.db.hitEvent.insert({ attackerId: m.id, attackerIsMob: true, victimId: prey.id, victimIsMob: false, damage: WOLF_BITE, knockedOut: hp <= 0 });
  remember(ctx, { agentId: prey.id, kind: 'felt', text: 'A wolf bit you.', aboutAgentId: 0n, valence: 0 }, MEMORY_DEDUP_MS);
  return hp <= 0;
}

// A survivor's swing at a wolf. Returns true if the wolf died.
export function hitWolf(ctx: Ctx, attacker: Agent, m: Mob) {
  const d = distance(attacker.x, attacker.y, m.x, m.y) || 1;
  const hp = m.hp - ATTACK_DAMAGE;
  ctx.db.hitEvent.insert({ attackerId: attacker.id, attackerIsMob: false, victimId: m.id, victimIsMob: true, damage: ATTACK_DAMAGE, knockedOut: hp <= 0 });
  if (hp > 0) {
    ctx.db.mob.id.update({ ...m, hp, kx: m.kx + ((m.x - attacker.x) / d) * KNOCKBACK_SPEED, ky: m.ky + ((m.y - attacker.y) / d) * KNOCKBACK_SPEED });
    return false;
  }
  ctx.db.mob.id.delete(m.id);
  const drop = ctx.db.container.insert({ id: 0n, kind: 'drop', x: m.x, y: m.y, ownerAgentId: 0n, label: 'Wolf carcass' });
  add(ctx, { containerId: drop.id }, 'meat', MEAT_PER_WOLF);
  witness(ctx, { x: m.x, y: m.y, exclude: [attacker.id], text: () => `You saw ${attacker.name} kill a wolf.`, aboutAgentId: attacker.id, valence: 0 });
  return true;
}
