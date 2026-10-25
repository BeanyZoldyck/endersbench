import { createServer, type Server } from 'node:http';
import { FINANCE_PROMPT_VARIANTS, HEADLINE_VARIANT } from '../../spacetimedb/src/finance/prompt';
import { FINANCE_BENCHMARK_VERSION } from '../../spacetimedb/src/finance/scenarios';

type CaseRow = { id: bigint; modelId: string; scenarioId: string; variant: string; status: string };
export type ControlOptions = {
  host: string; database: string; models: string[]; cases: string[];
  repeat?: number;
  rows: () => Iterable<CaseRow>; ready: () => boolean;
  queue: (args: { modelId: string; variant: string; repeat: number; cases: string }) => Promise<unknown>;
};

// Local operator controls only. Credentials stay with the worker; case state
// still travels directly from SpacetimeDB subscriptions to the viewer.
export function financeControl(options: ControlOptions): Server {
  let submitting = false;
  let awaiting: (() => boolean) | undefined;
  const busy = () => submitting || !!awaiting?.() || [...options.rows()].some(r => options.models.includes(r.modelId) && r.status !== 'closed');
  return createServer(async (req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // A custom header requires a browser preflight for cross-origin requests.
    // No CORS headers are granted, and Vite proxies same-origin requests here.
    if (req.headers['x-finance-control'] !== '1') return reply(403, { error: 'Use the local finance viewer.' });
    if (req.url !== '/api/finance-control') return reply(404, { error: 'Not found' });
    if (req.method === 'GET') return reply(200, { host: options.host, database: options.database, models: options.models, cases: options.cases, repeat: options.repeat ?? 1, ready: options.ready(), busy: busy(), version: FINANCE_BENCHMARK_VERSION, variants: FINANCE_PROMPT_VARIANTS, defaultVariant: HEADLINE_VARIANT });
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    if (!options.ready()) return reply(503, { error: 'Worker is reconnecting. Try again once connected.' });
    if (busy()) return reply(409, { error: 'A run is already in progress. Wait for it to finish.' });
    submitting = true;
    try {
      let body = '';
      for await (const part of req) { body += part; if (body.length > 4096) throw new Error('Request too large'); }
      const input = JSON.parse(body);
      if (input.database !== options.database || input.host !== options.host) return reply(409, { error: 'Viewer and worker must use the same database.' });
      if (input.version !== FINANCE_BENCHMARK_VERSION) return reply(409, { error: 'Refresh the viewer before starting a run; benchmark versions differ.' });
      if (!options.cases.includes(input.scenarioId) || !FINANCE_PROMPT_VARIANTS.includes(input.variant)) return reply(400, { error: 'Choose a case and prompt condition configured for this worker.' });
      const before = new Set([...options.rows()].map(r => r.id));
      const queued: string[] = [];
      // Hold the guard until subscription rows arrive, including on partial failure.
      awaiting = () => queued.some(model => [...options.rows()].filter(r => !before.has(r.id) && r.modelId === model && r.scenarioId === input.scenarioId).length < (options.repeat ?? 1));
      for (const modelId of options.models) {
        await options.queue({ modelId, variant: input.variant, repeat: options.repeat ?? 1, cases: input.scenarioId });
        queued.push(modelId);
      }
      reply(200, { scenarioId: input.scenarioId, variant: input.variant });
    } catch (error) { reply(500, { error: error instanceof Error ? error.message : String(error) }); }
    finally { submitting = false; }
  });
}
