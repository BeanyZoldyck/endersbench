import type { Ctx } from './ctx';

// Item stacks live in one table; a stack is held by an agent or a container.
type Holder = { agentId: bigint } | { containerId: bigint };

function stacks(ctx: Ctx, holder: Holder, kind?: string) {
  const rows = 'agentId' in holder
    ? [...ctx.db.item.agentId.filter(holder.agentId)].filter(i => i.containerId === 0n)
    : [...ctx.db.item.containerId.filter(holder.containerId)].filter(i => i.agentId === 0n);
  return kind ? rows.filter(i => i.kind === kind) : rows;
}

export function countOf(ctx: Ctx, holder: Holder, kind: string) {
  return stacks(ctx, holder, kind).reduce((n, i) => n + i.qty, 0);
}

export function totalCarried(ctx: Ctx, agentId: bigint) {
  return stacks(ctx, { agentId }).reduce((n, i) => n + i.qty, 0);
}

export function contents(ctx: Ctx, holder: Holder): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of stacks(ctx, holder)) if (i.qty > 0) out[i.kind] = (out[i.kind] ?? 0) + i.qty;
  return out;
}

export function add(ctx: Ctx, holder: Holder, kind: string, qty: number) {
  if (qty <= 0) return;
  const existing = stacks(ctx, holder, kind)[0];
  if (existing) {
    ctx.db.item.id.update({ ...existing, qty: existing.qty + qty });
    return;
  }
  ctx.db.item.insert({
    id: 0n,
    agentId: 'agentId' in holder ? holder.agentId : 0n,
    containerId: 'containerId' in holder ? holder.containerId : 0n,
    kind,
    qty,
  });
}

// Removes up to `qty`; returns how many were removed.
export function remove(ctx: Ctx, holder: Holder, kind: string, qty: number) {
  let left = qty;
  for (const s of stacks(ctx, holder, kind)) {
    if (left <= 0) break;
    const take = Math.min(s.qty, left);
    left -= take;
    if (take === s.qty) ctx.db.item.id.delete(s.id);
    else ctx.db.item.id.update({ ...s, qty: s.qty - take });
  }
  return qty - left;
}

// Moves items and announces it so the viewer can animate the hand-off.
export function move(ctx: Ctx, from: Holder, to: Holder, kind: string, qty: number) {
  const moved = remove(ctx, from, kind, qty);
  add(ctx, to, kind, moved);
  if (moved > 0) {
    ctx.db.transferEvent.insert({
      fromAgentId: 'agentId' in from ? from.agentId : 0n,
      fromContainerId: 'containerId' in from ? from.containerId : 0n,
      toAgentId: 'agentId' in to ? to.agentId : 0n,
      toContainerId: 'containerId' in to ? to.containerId : 0n,
      kind,
      qty: moved,
    });
  }
  return moved;
}

export function noun(kind: string, qty: number) {
  if (kind === 'berries') return qty === 1 ? 'berry' : 'berries';
  if (kind === 'ration') return qty === 1 ? 'ration' : 'rations';
  return kind;
}
