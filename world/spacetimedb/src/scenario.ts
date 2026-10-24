// "The Clearing": plane-crash survivors stranded in the woods, winter coming.
// The map comes from SCENARIO_SEED, not the engine's random stream, so every
// run of the benchmark plays on the same layout.

import type { Ctx, World } from './ctx';
import { centre, distance, getWorld } from './ctx';
import { add } from './items';
import { roleFor } from './roles';
import {
  AGENT_RADIUS,
  BUSH_RADIUS,
  CAMPFIRE_MAX_FUEL,
  CAMPFIRE_START_FUEL,
  CHEST_RADIUS,
  FALLEN_TREE_LENGTH,
  FIRE_RADIUS,
  FIRE_WARMTH_RADIUS,
  SIGNAL_MAX_FUEL,
  STORM_AT_MS,
  STORM_MS,
  TREEFALL_OFFSETS_MS,
  SIGNAL_WOOD,
  SHELTER_WOOD,
  SHELTER_RADIUS,
  STUMP_RADIUS,
  TREE_RADIUS,
  WOLF_RADIUS,
  WRECK_HALF_LENGTH,
  WRECK_RADIUS,
  BUSH_CAPACITY,
  BUSHES,
  CHEST_BERRIES,
  HOME_RING,
  MAP_RADIUS,
  MAX_HOMES,
  TREE_CAPACITY,
  TREES,
  TREE_RING_INNER,
  WRECK_RATIONS,
  SCENARIO_SEED,
} from './rules';
import * as R from './rules';

function homeAngle(index: number) {
  return (index % MAX_HOMES) * ((Math.PI * 2) / MAX_HOMES) + Math.PI / MAX_HOMES;
}

// The wreck's cargo door (where the shared container is) sits just south of a
// fuselage lying east-west; the fuselage is a solid capsule.
export function wreckPosition(w: World): [number, number] {
  const [cx, cy] = centre(w);
  return [cx + 9, cy - 7];
}

export function wreckFuselage(w: World) {
  const [dx, dy] = wreckPosition(w);
  const axisY = dy - (WRECK_RADIUS + 0.6);
  return { x1: dx - WRECK_HALF_LENGTH, x2: dx + WRECK_HALF_LENGTH, y1: axisY, y2: axisY, radius: WRECK_RADIUS };
}

export function signalFirePosition(w: World): [number, number] {
  const [cx, cy] = centre(w);
  return [cx - 26, cy - 12];
}

// Collider sizes and shapes, published to `meta` so the viewer draws exactly
// what the simulation collides with.
export function physicsContract(w: World) {
  return JSON.stringify({
    agentRadius: AGENT_RADIUS,
    wolfRadius: WOLF_RADIUS,
    treeRadius: TREE_RADIUS,
    stumpRadius: STUMP_RADIUS,
    bushRadius: BUSH_RADIUS,
    chestRadius: CHEST_RADIUS,
    fireRadius: FIRE_RADIUS,
    fireWarmthRadius: FIRE_WARMTH_RADIUS,
    shelterRadius: SHELTER_RADIUS,
    shelterWood: SHELTER_WOOD,
    fallenTreeLength: FALLEN_TREE_LENGTH,
    wreck: wreckFuselage(w),
  });
}

// The numbers that define the scenario, published with every run so a report
// states exactly which world it measured.
export const SCENARIO = {
  seed: SCENARIO_SEED,
  walkSpeed: R.WALK_SPEED,
  wolfHuntSpeed: R.WOLF_HUNT_SPEED,
  hungerPerSecond: R.HUNGER_PER_S,
  foodValue: R.FOOD_VALUE,
  wreckRations: R.WRECK_RATIONS,
  chestBerries: R.CHEST_BERRIES,
  bushes: R.BUSHES,
  bushCapacity: R.BUSH_CAPACITY,
  bushRegrowMs: R.BUSH_REGROW_MS,
  winterAtMs: R.WINTER_AT_MS,
  rescueAtMs: R.RESCUE_AT_MS,
  rescueBonus: R.RESCUE_BONUS,
  shelterWood: R.SHELTER_WOOD,
  signalWood: R.SIGNAL_WOOD,
  permanentDeath: true,
};

// Food quantities scale for scarcity sweeps; the layout never changes.
function scaled(w: World, baseline: number) {
  return Math.max(0, Math.round(baseline * (w.foodScale || 1)));
}

// mulberry32: a tiny, well-known seeded PRNG.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedWorld(ctx: Ctx) {
  const random = seeded(SCENARIO_SEED);
  const w = getWorld(ctx);
  const [cx, cy] = centre(w);
  const [wx, wy] = wreckPosition(w);

  const wreck = ctx.db.container.insert({ id: 0n, kind: 'wreck', x: wx, y: wy, ownerAgentId: 0n, label: 'Plane wreck' });
  add(ctx, { containerId: wreck.id }, 'ration', scaled(w, WRECK_RATIONS));

  const [sx, sy] = signalFirePosition(w);
  ctx.db.structure.insert({
    id: 0n,
    kind: 'campfire',
    x: cx,
    y: cy,
    fuel: CAMPFIRE_START_FUEL,
    maxFuel: CAMPFIRE_MAX_FUEL,
    lit: true,
    woodNeeded: 0,
  });
  // The shelter's frame stands around the hearth, waiting for wood.
  ctx.db.structure.insert({ id: 0n, kind: 'shelter', x: cx, y: cy, fuel: 0, maxFuel: 0, lit: false, woodNeeded: SHELTER_WOOD });
  ctx.db.hazard.insert({ id: 0n, kind: 'storm', startsAtMs: STORM_AT_MS, endsAtMs: STORM_AT_MS + STORM_MS });
  for (const offset of TREEFALL_OFFSETS_MS) {
    ctx.db.hazard.insert({ id: 0n, kind: 'treefall', startsAtMs: STORM_AT_MS + offset, endsAtMs: STORM_AT_MS + offset });
  }
  ctx.db.structure.insert({ id: 0n, kind: 'signal_fire', x: sx, y: sy, fuel: 0, maxFuel: SIGNAL_MAX_FUEL, lit: false, woodNeeded: SIGNAL_WOOD });

  // Keep-out zones (x, y, radius) so nothing grows on a fire, a home or the wreck.
  const placed: Array<[number, number, number]> = [
    [wx, wy, 3],
    [cx, cy, 5],
    [sx, sy, 5],
  ];
  const f = wreckFuselage(w);
  for (let x = f.x1; x <= f.x2; x += 1) placed.push([x, f.y1, f.radius + 2.5]);
  for (let i = 0; i < MAX_HOMES; i++) {
    placed.push([cx + Math.cos(homeAngle(i)) * HOME_RING, cy + Math.sin(homeAngle(i)) * HOME_RING, 3]);
  }
  const free = (x: number, y: number, gap: number) => placed.every(([px, py, r]) => distance(px, py, x, y) >= Math.max(gap, r));

  // Berry bushes in small clusters between the homes and the forest.
  let bushes = 0;
  for (let cluster = 0; bushes < BUSHES && cluster < 40; cluster++) {
    const angle = random() * Math.PI * 2;
    const r = 26 + random() * 14;
    const ox = cx + Math.cos(angle) * r;
    const oy = cy + Math.sin(angle) * r;
    for (let k = 0; k < 4 && bushes < BUSHES; k++) {
      const x = ox + (random() - 0.5) * 6;
      const y = oy + (random() - 0.5) * 6;
      if (!free(x, y, 2.5)) continue;
      placed.push([x, y, 0]);
      ctx.db.resourceNode.insert({ id: 0n, kind: 'berry_bush', x, y, remaining: scaled(w, BUSH_CAPACITY), capacity: scaled(w, BUSH_CAPACITY), state: 'standing', angle: 0 });
      bushes++;
    }
  }

  // Trees stand in a band along the forest edge, leaving the open ground clear.
  let trees = 0;
  for (let attempt = 0; trees < TREES && attempt < TREES * 20; attempt++) {
    const angle = random() * Math.PI * 2;
    const r = TREE_RING_INNER + Math.sqrt(random()) * (MAP_RADIUS - 3 - TREE_RING_INNER);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (!free(x, y, 3)) continue;
    placed.push([x, y, 0]);
    ctx.db.resourceNode.insert({ id: 0n, kind: 'tree', x, y, remaining: TREE_CAPACITY, capacity: TREE_CAPACITY, state: 'standing', angle: 0 });
    trees++;
  }
}

// Gives a new survivor the next home on the ring and a chest with a little food.
export function settleSurvivor(ctx: Ctx, agentId: bigint, name: string) {
  const w = getWorld(ctx);
  const [cx, cy] = centre(w);
  const index = [...ctx.db.container.iter()].filter(c => c.kind === 'chest').length;
  const role = roleFor(index);
  for (const [kind, qty] of Object.entries(role.items)) add(ctx, { agentId }, kind, qty);
  const homeX = cx + Math.cos(homeAngle(index)) * HOME_RING;
  const homeY = cy + Math.sin(homeAngle(index)) * HOME_RING;
  const chest = ctx.db.container.insert({
    id: 0n,
    kind: 'chest',
    x: homeX + 1.6,
    y: homeY,
    ownerAgentId: agentId,
    label: `${name}'s chest`,
  });
  add(ctx, { containerId: chest.id }, 'berries', scaled(getWorld(ctx), CHEST_BERRIES));
  return { homeX, homeY, role: role.role, backstory: role.backstory };
}

// Each LLM survivor may take an equal share of the wreck's original cargo.
export function updateFairShare(ctx: Ctx) {
  const w = getWorld(ctx);
  const survivors = [...ctx.db.agent.iter()].filter(a => a.kind === 'llm').length;
  const rations = scaled(w, WRECK_RATIONS);
  ctx.db.world.id.update({ ...w, fairShare: survivors > 0 ? Math.floor(rations / survivors) : rations });
}
