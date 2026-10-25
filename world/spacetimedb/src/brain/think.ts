// The database's own brain. brainTick schedules one think per request in a
// database-brained run; think asks the model over HTTP, outside any
// transaction, then settles the request through the same door the harness
// uses. Calls run in parallel and never hold up the world's tick.

import { t } from 'spacetimedb/server';
import { TimeDuration } from 'spacetimedb';
import { thinkJob } from '../schema';
import { settleThought } from '../decisions';
import { buildModelCall, decisionFromResponse, type ModelCall, type Tool } from './protocol';

// Under REQUEST_TIMEOUT_MS (30 s), so think fails a request before brainTick expires it.
const HTTP_TIMEOUT_MS = 25_000;

export function defineThink(spacetimedb: any) {
  const think = spacetimedb.procedure({ onSchedule: thinkJob }, { job: thinkJob.rowType }, t.unit(), (ctx: any, { job }: { job: { requestId: bigint } }) => {
    const startedUs: bigint = ctx.timestamp.microsSinceUnixEpoch;
    const latency = (tx: any) => Math.max(0, Number((tx.timestamp.microsSinceUnixEpoch - startedUs) / 1000n));
    const settle = (result: Parameters<typeof settleThought>[2]) => ctx.withTx((tx: any) => settleThought(tx, job.requestId, result, latency(tx)));

    let call: ModelCall | null = null;
    try {
      call = ctx.withTx((tx: any): ModelCall | null => {
        const req = tx.db.decisionRequest.id.find(job.requestId);
        if (!req || req.status !== 'pending') return null;
        const agentName = tx.db.agent.id.find(req.agentId)?.name ?? `agent ${req.agentId}`;
        const tools: Tool[] = JSON.parse(tx.db.meta.key.find('tools')?.value ?? '[]');
        const system: string = JSON.parse(tx.db.meta.key.find('run')?.value ?? '{}').systemPrompt ?? '';
        if (!system) throw new Error('no run is configured: call beginRun first');
        return buildModelCall(req.modelId, { agentName, observation: JSON.parse(req.observation), tools, system }, name => ctx.env.get(name) ?? undefined);
      });
    } catch (err) {
      settle({ error: err instanceof Error ? err.message : String(err) });
      return {};
    }
    if (!call) return {};

    try {
      const res = ctx.http.fetch(call.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...call.headers },
        body: JSON.stringify(call.body),
        timeout: TimeDuration.fromMillis(HTTP_TIMEOUT_MS),
      });
      settle({ decision: decisionFromResponse(call.api, call.url, res.status, res.text()) });
    } catch (err) {
      settle({ error: err instanceof Error ? err.message : String(err) });
    }
    return {};
  });
  return { think };
}
