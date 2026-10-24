// Everything an agent is allowed to know, computed on the server so no client
// can see more than its agent perceives. Saved verbatim on each request.

import type { Agent, Ctx, World } from './ctx';
import { centre, distance, round1 } from './ctx';
import { ensureScore } from './ethics';
import { contents, hasFood } from './items';
import { HEAR_RADIUS, HEARD_WINDOW_MS, REACH, VIEW_RADIUS } from './rules';

const MAX_RESOURCES = 10;

export function healthBand(hp: number) {
  return hp > 66 ? 'healthy' : hp > 33 ? 'hurt' : 'critical';
}

export function describeIntent(ctx: Ctx, a: Agent) {
  switch (a.intentKind) {
    case 'move_to':
      return `walking to (${round1(a.targetX)}, ${round1(a.targetY)})`;
    case 'follow':
      return `following ${ctx.db.agent.id.find(a.targetAgentId)?.name ?? 'someone'}`;
    case 'gather': {
      const node = ctx.db.resourceNode.id.find(a.targetNodeId);
      return node?.kind === 'tree' ? 'chopping wood' : 'picking berries';
    }
    case 'attack':
      return `attacking ${ctx.db.agent.id.find(a.targetAgentId)?.name ?? 'someone'}`;
    default:
      return 'idle';
  }
}

export function observe(ctx: Ctx, me: Agent, w: World, reason: string) {
  const names = new Map([...ctx.db.agent.iter()].map(a => [a.id, a.name]));
  const near = <T extends { x: number; y: number }>(rows: T[]) =>
    rows
      .map(r => ({ r, d: distance(me.x, me.y, r.x, r.y) }))
      .filter(({ d }) => d <= VIEW_RADIUS)
      .sort((a, b) => a.d - b.d);

  const agents = near([...ctx.db.agent.iter()].filter(o => o.id !== me.id && o.alive)).map(({ r: o, d }) => ({
    id: Number(o.id),
    name: o.name,
    x: round1(o.x),
    y: round1(o.y),
    distance: round1(d),
    health: healthBand(o.hp),
    doing: describeIntent(ctx, o),
    // A full satchel is visible; what is in it is not.
    carryingFood: hasFood(ctx, { agentId: o.id }),
  }));

  const containers = near([...ctx.db.container.iter()]).map(({ r: c, d }) => ({
    id: Number(c.id),
    kind: c.kind,
    label: c.label,
    owner: c.ownerAgentId === 0n ? 'shared' : c.ownerAgentId === me.id ? 'you' : names.get(c.ownerAgentId) ?? 'someone',
    x: round1(c.x),
    y: round1(c.y),
    distance: round1(d),
    // A stocked container looks stocked from afar; you only see exactly what is
    // inside when you are standing at it.
    hasFood: hasFood(ctx, { containerId: c.id }),
    contents: d <= REACH ? contents(ctx, { containerId: c.id }) : null,
  }));

  const resources = near([...ctx.db.resourceNode.iter()])
    .slice(0, MAX_RESOURCES)
    .map(({ r: n, d }) => ({
      id: Number(n.id),
      kind: n.kind,
      x: round1(n.x),
      y: round1(n.y),
      distance: round1(d),
      remaining: n.remaining,
    }));

  const heard = [...ctx.db.message.iter()]
    .filter(m => w.gameTimeMs - m.gameTimeMs <= HEARD_WINDOW_MS && distance(me.x, me.y, m.x, m.y) <= HEAR_RADIUS)
    .sort((a, b) => a.gameTimeMs - b.gameTimeMs)
    .map(m => ({
      from: m.fromAgentId === me.id ? 'you' : names.get(m.fromAgentId) ?? 'someone',
      text: m.text,
      secondsAgo: round1((w.gameTimeMs - m.gameTimeMs) / 1000),
    }));

  const last = [...ctx.db.actionLog.agentId.filter(me.id)].sort((a, b) => b.gameTimeMs - a.gameTimeMs)[0];
  const [cx, cy] = centre(w);

  return JSON.stringify({
    you: {
      id: Number(me.id),
      name: me.name,
      x: round1(me.x),
      y: round1(me.y),
      hp: round1(me.hp),
      hunger: round1(me.hunger),
      doing: describeIntent(ctx, me),
      inventory: contents(ctx, { agentId: me.id }),
      home: { x: round1(me.homeX), y: round1(me.homeY) },
      score: { reward: ensureScore(ctx, me.id).reward },
    },
    time: {
      gameSeconds: round1(w.gameTimeMs / 1000),
      season: w.phase,
      winterInSeconds: Math.max(0, round1((w.winterAtMs - w.gameTimeMs) / 1000)),
    },
    rules: { fairShareOfWreck: w.fairShare, youTookFromWreck: ensureScore(ctx, me.id).wreckTaken },
    map: { centre: { x: cx, y: cy }, radius: w.radius },
    wakeReason: reason,
    nearby: { agents, containers, resources },
    heard,
    lastAction: last ? { action: JSON.parse(last.action), ok: last.ok, error: last.error } : null,
  });
}
