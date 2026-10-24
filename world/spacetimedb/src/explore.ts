// Exploration and discovery. The map's walkable disc is cut into coarse cells
// (EXPLORE_CELL tiles square); a survivor "has seen" a cell once it was within
// view. The explore action sends a survivor to a cell it has not seen, and the
// supply crate and the finds are known to a survivor only from the first time
// they were in its sight (the same sight as the observation's).

import type { Agent, Ctx, World } from './ctx';
import { centre, distance, getWorld } from './ctx';
import { addRecord } from './record';
import { EDGE_MARGIN, EXPLORE_CELL, EXPLORE_MIN_DISTANCE } from './rules';
import { makeSight, viewRadius } from './sight';

export type FindKind = 'crate' | 'thicket' | 'wood_pile';

const columns = (w: World) => Math.ceil(w.width / EXPLORE_CELL);
const rows = (w: World) => Math.ceil(w.height / EXPLORE_CELL);
const cellCount = (w: World) => columns(w) * rows(w);

// Which cell a point falls in: row * cells-per-row + column, counted from the
// top-left corner. Points off the map count as the nearest edge cell.
export function cellOf(w: World, x: number, y: number): number {
  const col = Math.min(columns(w) - 1, Math.max(0, Math.floor(x / EXPLORE_CELL)));
  const row = Math.min(rows(w) - 1, Math.max(0, Math.floor(y / EXPLORE_CELL)));
  return row * columns(w) + col;
}

function centreOfCell(w: World, cell: number): { x: number; y: number } {
  const cols = columns(w);
  return { x: ((cell % cols) + 0.5) * EXPLORE_CELL, y: (Math.floor(cell / cols) + 0.5) * EXPLORE_CELL };
}

// Cells whose centre an agent can stand on: inside the playable circle.
function walkableCells(w: World): number[] {
  const [cx, cy] = centre(w);
  const limit = w.radius - EDGE_MARGIN;
  const out: number[] = [];
  for (let cell = 0; cell < cellCount(w); cell++) {
    const c = centreOfCell(w, cell);
    if (distance(cx, cy, c.x, c.y) <= limit) out.push(cell);
  }
  return out;
}

// The thing a resource node is a find of, or null for ordinary trees and bushes.
export function findKindOfNode(nodeKind: string): 'thicket' | 'wood_pile' | null {
  return nodeKind === 'berry_thicket' ? 'thicket' : nodeKind === 'wood_pile' ? 'wood_pile' : null;
}

const keyOf = (kind: FindKind, subjectId: bigint) => `${kind}:${subjectId}`;

// Everything this agent has discovered, as a lookup. For code that asks about many things.
export function discoveredBy(ctx: Ctx, agentId: bigint): (kind: FindKind, subjectId: bigint) => boolean {
  const keys = new Set([...ctx.db.discovery.agentId.filter(agentId)].map(d => keyOf(d.subjectKind as FindKind, d.subjectId)));
  return (kind, subjectId) => keys.has(keyOf(kind, subjectId));
}

export function hasDiscovered(ctx: Ctx, agentId: bigint, subjectKind: FindKind, subjectId: bigint): boolean {
  for (const d of ctx.db.discovery.agentId.filter(agentId)) {
    if (d.subjectKind === subjectKind && d.subjectId === subjectId) return true;
  }
  return false;
}

// Run on the brain's clock, before anyone decides. Marks the cells each living
// model-driven survivor has in view (and the one it stands in), and records the
// first sighting of the crate and each find.
export function updateExploration(ctx: Ctx): void {
  const w = getWorld(ctx);
  const sees = makeSight(ctx, w);
  const radius = viewRadius(w);
  const centres = Array.from({ length: cellCount(w) }, (_, cell) => centreOfCell(w, cell));
  const finds: Array<{ kind: FindKind; id: bigint; x: number; y: number }> = [
    ...[...ctx.db.container.iter()].filter(c => c.kind === 'crate').map(c => ({ kind: 'crate' as const, id: c.id, x: c.x, y: c.y })),
    ...[...ctx.db.resourceNode.iter()].flatMap(n => {
      const kind = findKindOfNode(n.kind);
      return kind ? [{ kind, id: n.id, x: n.x, y: n.y }] : [];
    }),
  ];

  for (const a of [...ctx.db.agent.iter()]) {
    if (a.kind !== 'llm' || !a.alive) continue;

    const visited = new Set([...ctx.db.explored.agentId.filter(a.id)].map(r => r.cell));
    const own = cellOf(w, a.x, a.y);
    centres.forEach((c, cell) => {
      if (visited.has(cell) || (cell !== own && distance(a.x, a.y, c.x, c.y) > radius)) return;
      ctx.db.explored.insert({ agentId: a.id, cell });
    });

    const discovered = discoveredBy(ctx, a.id);
    for (const f of finds) {
      if (discovered(f.kind, f.id) || !sees(a.x, a.y, f.x, f.y)) continue;
      ctx.db.discovery.insert({ id: 0n, agentId: a.id, subjectKind: f.kind, subjectId: f.id, gameTimeMs: w.gameTimeMs });
      addRecord(ctx, { agentId: a.id, kind: 'found', subjectId: f.id });
    }
  }
}

// Where the explore action sends someone: the centre of a random cell on the
// walkable map that they have not seen and that is at least EXPLORE_MIN_DISTANCE
// away. With nothing unseen left, any such cell.
export function exploreTarget(ctx: Ctx, me: Agent): { x: number; y: number } {
  const w = getWorld(ctx);
  const visited = new Set([...ctx.db.explored.agentId.filter(me.id)].map(r => r.cell));
  const far = walkableCells(w).filter(cell => {
    const c = centreOfCell(w, cell);
    return distance(me.x, me.y, c.x, c.y) >= EXPLORE_MIN_DISTANCE;
  });
  const unseen = far.filter(cell => !visited.has(cell));
  const pool = unseen.length > 0 ? unseen : far;
  if (pool.length === 0) {
    const [cx, cy] = centre(w);
    return { x: cx, y: cy };
  }
  return centreOfCell(w, pool[ctx.random.integerInRange(0, pool.length - 1)]);
}

// An explore is a walk that wakes the agent with "done: explore" when it ends.
// The marker rides in pendingAction, which a move_to otherwise never uses.
export const EXPLORING = JSON.stringify({ name: 'explore', args: {} });

export function isExploring(a: Pick<Agent, 'intentKind' | 'pendingAction'>): boolean {
  return a.intentKind === 'move_to' && a.pendingAction === EXPLORING;
}
