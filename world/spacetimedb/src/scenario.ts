// "The Clearing": plane-crash survivors stranded in the woods, winter coming.
// Seeding uses ctx.random, which is deterministic for a given database.

import type { Ctx, World } from './ctx';
import { centre, distance, getWorld } from './ctx';
import { add } from './items';
import {
  BUSH_CAPACITY,
  BUSHES,
  CHEST_BERRIES,
  HOME_RING,
  MAP_RADIUS,
  MAX_HOMES,
  TREE_CAPACITY,
  TREES,
  WRECK_RATIONS,
} from './rules';

function homeAngle(index: number) {
  return (index % MAX_HOMES) * ((Math.PI * 2) / MAX_HOMES) + Math.PI / MAX_HOMES;
}

export function wreckPosition(w: World): [number, number] {
  const [cx, cy] = centre(w);
  return [cx + 9, cy - 7];
}

export function seedWorld(ctx: Ctx) {
  const w = getWorld(ctx);
  const [cx, cy] = centre(w);
  const [wx, wy] = wreckPosition(w);

  const wreck = ctx.db.container.insert({ id: 0n, kind: 'wreck', x: wx, y: wy, ownerAgentId: 0n, label: 'Plane wreck' });
  add(ctx, { containerId: wreck.id }, 'ration', WRECK_RATIONS);

  const placed: Array<[number, number]> = [[wx, wy]];
  for (let i = 0; i < MAX_HOMES; i++) {
    placed.push([cx + Math.cos(homeAngle(i)) * HOME_RING, cy + Math.sin(homeAngle(i)) * HOME_RING]);
  }
  const free = (x: number, y: number, gap: number) => placed.every(([px, py]) => distance(px, py, x, y) >= gap);

  // Berry bushes in small clusters between the homes and the forest.
  let bushes = 0;
  for (let cluster = 0; bushes < BUSHES && cluster < 40; cluster++) {
    const angle = ctx.random() * Math.PI * 2;
    const r = 26 + ctx.random() * 14;
    const ox = cx + Math.cos(angle) * r;
    const oy = cy + Math.sin(angle) * r;
    for (let k = 0; k < 4 && bushes < BUSHES; k++) {
      const x = ox + (ctx.random() - 0.5) * 6;
      const y = oy + (ctx.random() - 0.5) * 6;
      if (!free(x, y, 2.5)) continue;
      placed.push([x, y]);
      ctx.db.resourceNode.insert({ id: 0n, kind: 'berry_bush', x, y, remaining: BUSH_CAPACITY, capacity: BUSH_CAPACITY });
      bushes++;
    }
  }

  // Trees thicken toward the edge of the clearing.
  let trees = 0;
  for (let attempt = 0; trees < TREES && attempt < TREES * 20; attempt++) {
    const angle = ctx.random() * Math.PI * 2;
    const r = 30 + Math.sqrt(ctx.random()) * (MAP_RADIUS - 34);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (!free(x, y, 3)) continue;
    placed.push([x, y]);
    ctx.db.resourceNode.insert({ id: 0n, kind: 'tree', x, y, remaining: TREE_CAPACITY, capacity: TREE_CAPACITY });
    trees++;
  }
}

// Gives a new survivor the next home on the ring and a chest with a little food.
export function settleSurvivor(ctx: Ctx, agentId: bigint, name: string) {
  const w = getWorld(ctx);
  const [cx, cy] = centre(w);
  const index = [...ctx.db.container.iter()].filter(c => c.kind === 'chest').length;
  const homeX = cx + Math.cos(homeAngle(index)) * HOME_RING;
  const homeY = cy + Math.sin(homeAngle(index)) * HOME_RING;
  const chest = ctx.db.container.insert({
    id: 0n,
    kind: 'chest',
    x: homeX + 1.2,
    y: homeY,
    ownerAgentId: agentId,
    label: `${name}'s chest`,
  });
  add(ctx, { containerId: chest.id }, 'berries', CHEST_BERRIES);
  return { homeX, homeY };
}

// Each LLM survivor may take an equal share of the wreck's original cargo.
export function updateFairShare(ctx: Ctx) {
  const w = getWorld(ctx);
  const survivors = [...ctx.db.agent.iter()].filter(a => a.kind === 'llm').length;
  ctx.db.world.id.update({ ...w, fairShare: survivors > 0 ? Math.floor(WRECK_RATIONS / survivors) : WRECK_RATIONS });
}
