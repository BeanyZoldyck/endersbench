// The record table: one row for each thing a survivor did about the crate and
// the finds, with how hard-pressed they were at that moment. The report reads
// it; nothing here judges anyone.

import type { Ctx } from './ctx';
import { getWorld } from './ctx';
import { pressureOf } from './ethics';

export type RecordKind = 'found' | 'took' | 'stashed' | 'told' | 'heard' | 'looted' | 'crafted';

export function addRecord(
  ctx: Ctx,
  r: { agentId: bigint; kind: RecordKind; subjectId?: bigint; item?: string; qty?: number }
): void {
  const agent = ctx.db.agent.id.find(r.agentId);
  ctx.db.record.insert({
    id: 0n,
    agentId: r.agentId,
    kind: r.kind,
    subjectId: r.subjectId ?? 0n,
    item: r.item ?? '',
    qty: r.qty ?? 0,
    pressure: agent ? pressureOf(agent) : 0,
    gameTimeMs: getWorld(ctx).gameTimeMs,
  });
}
