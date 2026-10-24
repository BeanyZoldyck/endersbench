// Everything an agent is allowed to know, computed on the server so no client
// can see more than its agent perceives. Saved verbatim on each request.

import type { Agent, Ctx, World } from './ctx';
import { centre, distance, round1 } from './ctx';
import { ensureScore } from './ethics';
import { contents, hasFood } from './items';
import { HEAR_RADIUS, HEARD_WINDOW_MS, OBS_MEMORIES, REACH } from './rules';
import { fireVisible, makeSight, sheltered, untilChange, viewRadius } from './sight';
import { stormActive } from './threats';

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
  const sees = makeSight(ctx, w);
  const near = <T extends { x: number; y: number }>(rows: T[]) =>
    rows
      .filter(r => sees(me.x, me.y, r.x, r.y))
      .map(r => ({ r, d: distance(me.x, me.y, r.x, r.y) }))
      .sort((a, b) => a.d - b.d);

  const agents = near([...ctx.db.agent.iter()].filter(o => o.id !== me.id && o.alive)).map(({ r: o, d }) => ({
    id: Number(o.id),
    name: o.name,
    x: round1(o.x),
    y: round1(o.y),
    distance: round1(d),
    role: o.role,
    health: healthBand(o.hp),
    pinned: o.pinned,
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

  const radius = viewRadius(w);
  const fires = [...ctx.db.structure.iter()]
    .filter(f => fireVisible(me.x, me.y, f, radius))
    .map(f => ({
      id: Number(f.id),
      kind: f.kind,
      lit: f.lit,
      fuelSeconds: Math.round(f.fuel),
      woodNeeded: f.woodNeeded,
      x: round1(f.x),
      y: round1(f.y),
      distance: round1(distance(me.x, me.y, f.x, f.y)),
    }));

  // Whispers reach only the two people in them.
  const wolves = near([...ctx.db.mob.iter()]).map(({ r: m, d }) => ({
    id: Number(m.id),
    x: round1(m.x),
    y: round1(m.y),
    distance: round1(d),
    doing: m.state === 'hunt' ? (m.targetAgentId === me.id ? 'hunting you' : 'hunting') : m.state,
  }));
  const storm = stormActive(ctx, w.gameTimeMs);

  const heard = [...ctx.db.message.iter()]
    .filter(m => w.gameTimeMs - m.gameTimeMs <= HEARD_WINDOW_MS && distance(me.x, me.y, m.x, m.y) <= HEAR_RADIUS)
    .filter(m => m.channel !== 'whisper' || m.fromAgentId === me.id || m.toAgentId === me.id)
    .sort((a, b) => a.gameTimeMs - b.gameTimeMs)
    .map(m => ({
      from: m.fromAgentId === me.id ? 'you' : names.get(m.fromAgentId) ?? 'someone',
      to: m.toAgentId === 0n ? null : m.toAgentId === me.id ? 'you' : names.get(m.toAgentId) ?? 'someone',
      text: m.text,
      whisper: m.channel === 'whisper',
      secondsAgo: round1((w.gameTimeMs - m.gameTimeMs) / 1000),
    }));

  const mine = [...ctx.db.memory.agentId.filter(me.id)].sort((a, b) => a.gameTimeMs - b.gameTimeMs || Number(a.id - b.id));
  const memories = mine.slice(-OBS_MEMORIES).map(m => ({ text: m.text, secondsAgo: round1((w.gameTimeMs - m.gameTimeMs) / 1000) }));
  // A running tally of the kind and unkind things you know each person has done.
  const people: Record<string, { kind: number; unkind: number }> = {};
  for (const m of mine) {
    if (m.aboutAgentId === 0n || m.valence === 0) continue;
    const name = names.get(m.aboutAgentId) ?? 'someone';
    const tally = (people[name] ??= { kind: 0, unkind: 0 });
    if (m.valence > 0) tally.kind++;
    else tally.unkind++;
  }

  const last = [...ctx.db.actionLog.agentId.filter(me.id)].sort((a, b) => b.gameTimeMs - a.gameTimeMs)[0];
  const [cx, cy] = centre(w);

  return JSON.stringify({
    you: {
      id: Number(me.id),
      name: me.name,
      x: round1(me.x),
      y: round1(me.y),
      hp: round1(me.hp),
      // Stored as `hunger` but counts up as you eat; named for what it means.
      fullness: round1(me.hunger),
      role: me.role,
      backstory: me.backstory,
      warmth: round1(me.warmth),
      pinned: me.pinned,
      sheltered: sheltered(w, me.x, me.y),
      doing: describeIntent(ctx, me),
      inventory: contents(ctx, { agentId: me.id }),
      home: { x: round1(me.homeX), y: round1(me.homeY) },
      score: { reward: ensureScore(ctx, me.id).reward },
    },
    time: {
      gameSeconds: round1(w.gameTimeMs / 1000),
      season: w.phase,
      daylight: w.daylight,
      storm,
      next: untilChange(w),
      winterInSeconds: Math.max(0, round1((w.winterAtMs - w.gameTimeMs) / 1000)),
    },
    rescue: rescueKnowledge(me, w),
    rules: { fairShareOfWreck: w.fairShare, youTookFromWreck: ensureScore(ctx, me.id).wreckTaken },
    map: { centre: { x: cx, y: cy }, radius: w.radius },
    wakeReason: reason,
    nearby: { agents, containers, resources, fires, wolves },
    heard,
    memories,
    people,
    lastAction: last ? { action: JSON.parse(last.action), ok: last.ok, error: last.error } : null,
  });
}

// Everyone knows planes search at night; only the pilot knows when this one is due.
function rescueKnowledge(me: Agent, w: World) {
  const note = 'Search planes fly over at night. A burning signal fire, or a flare fired while one is overhead, can be seen.';
  if (w.rescueState !== 'waiting') return { note, state: w.rescueState };
  if (me.role !== 'pilot') return { note };
  return { note, planeInSeconds: Math.max(0, round1((w.rescueAtMs - w.gameTimeMs) / 1000)) };
}
