// The world's finance desk, from the harness side. A desk request is a
// decision_request row with agentId 0; its finance_case row names the prompt
// variant. Each one is answered with the same call the bench loop makes for
// that turn (claudeTurn / openAiTurn in drivers.ts): same system prompt,
// tools and observation, so a case run in the world matches one run offline.
// harness/main.ts hands desk requests here.
import Anthropic from '@anthropic-ai/sdk';
import { FINANCE_BENCHMARK_VERSION } from '../../spacetimedb/src/finance/scenarios';
import { codexBrain } from '../brains';
import { BASELINES, REFERENCE_AGENTS } from '../../spacetimedb/src/finance/brains';
import { financeSystemPrompt } from '../../spacetimedb/src/finance/prompt';
import type { Observation, Seat } from '../../spacetimedb/src/finance/types';
import { type DeskTool, type TakeTurn, claudeTurn, openAiTurn } from './drivers';
import { OPENAI_COMPATIBLE, envValue, trustSystemCertificates } from './providers';

// Under the module's 5 minute expiry, so a slow call fails here first and is retried.
export const DESK_TIMEOUT_MS = 270_000;

// What the harness needs from its connection. The generated DbConnection fits
// once the bindings include the desk's tables.
export interface DeskConnection {
  db: {
    meta: { key: { find(key: string): { value: string } | undefined } };
    financeCase: { iter(): Iterable<{ pendingRequestId: bigint; status: string; variant: string; benchmarkVersion?: number }> };
  };
  reducers: {
    submitDecision(args: { requestId: bigint; action: string; thought: string; latencyMs: number }): Promise<unknown>;
    failDecision(args: { requestId: bigint; error: string; latencyMs: number }): Promise<unknown>;
  };
}

export interface DeskRequest {
  id: bigint;
  agentId: bigint;
  modelId: string;
  observation: string;
}

export const isDeskRequest = (req: DeskRequest) => req.agentId === 0n;

const SCRIPTS = Object.fromEntries([...REFERENCE_AGENTS, ...BASELINES].map(b => [b.id, b.brain]));

// Use the forest's isolated, schema-constrained Codex transport with the finance
// prompt, observation and action catalog. Notes are the model's short explanation.
export function codexDeskTurn(opts: Parameters<typeof codexBrain>[0]): TakeTurn {
  const brain = codexBrain(opts);
  return async (system, tools, observation) => {
    const decision = await brain.decide({ agentName: 'the finance desk agent', system, tools, observation: JSON.parse(observation) });
    return {
      call: decision.action,
      notes: decision.thought ? [decision.thought] : [],
      // This CLI transport does not expose token accounting.
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  };
}

// modelId as the forest roster spells it: "provider:model". script:<id>
// plays a test script or baseline from brains.ts, with no API call.
export function deskTurnFor(modelId: string): TakeTurn {
  const sep = modelId.indexOf(':');
  const provider = sep < 0 ? 'anthropic' : modelId.slice(0, sep);
  const model = sep < 0 ? modelId : modelId.slice(sep + 1);
  if (provider === 'codex') return codexDeskTurn({ model, codexHome: process.env.CODEX_HOME, effort: process.env.CODEX_EFFORT });
  if (provider === 'script') {
    const brain = SCRIPTS[model] ?? fail(`no test script '${model}'; use one of ${Object.keys(SCRIPTS).join(', ')}`);
    return async (_system, _tools, observation) => {
      const action = brain(JSON.parse(observation) as Observation);
      return { call: { name: action.tool, args: action.args }, notes: [`(script) ${action.thought}`], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    };
  }
  trustSystemCertificates();
  if (provider === 'anthropic') {
    const apiKey = envValue('ANTHROPIC_API_KEY') ?? fail('anthropic models need ANTHROPIC_API_KEY');
    return claudeTurn(new Anthropic({ apiKey }), { model });
  }
  const spec = OPENAI_COMPATIBLE[provider] ?? fail(`unknown provider '${provider}' in modelId '${modelId}'`);
  const baseUrl = spec.baseUrl() ?? fail(`${provider} models need ${spec.needs}`);
  const apiKey = spec.key() ?? fail(`${provider} models need ${spec.needs}`);
  return openAiTurn({ baseUrl, apiKey, model, api: spec.api });
}

function fail(message: string): never {
  throw new Error(message);
}

export type DeskAnswer = { action: string; thought: string } | { error: string };

// One turn of a desk case: the model's tool call as submit_decision's action
// JSON, or why there is none, worded as the module's stall rule reads it.
export async function answerDesk(takeTurn: TakeTurn, req: DeskRequest, variant: string, tools: Record<Seat, DeskTool[]>): Promise<DeskAnswer> {
  const { desk } = JSON.parse(req.observation) as Observation;
  const turn = await takeTurn(financeSystemPrompt(desk, variant), tools[desk], req.observation);
  const notes = turn.notes.join('\n');
  if (turn.refusal !== undefined) return { error: `refusal${turn.refusal ? `: ${turn.refusal}` : ''}` };
  if (!turn.call) return { error: `no tool call${notes ? `: ${notes}` : ''}`.slice(0, 500) };
  return { action: JSON.stringify({ name: turn.call.name, args: turn.call.args }), thought: notes };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms))]);
}

const turns = new Map<string, TakeTurn>();
const inFlight = new Set<bigint>();

const caseOf = (conn: DeskConnection, requestId: bigint) =>
  [...conn.db.financeCase.iter()].find(c => c.pendingRequestId === requestId && c.status === 'open');

// Answers one desk request on the connection: submit_decision with the
// action, or fail_decision with the reason, which the desk tick retries.
export async function answerDeskRequest(
  conn: DeskConnection,
  req: DeskRequest,
  opts: { timeoutMs?: number; caseWaitMs?: number; turnFor?: (modelId: string) => TakeTurn } = {}
) {
  if (inFlight.has(req.id)) return;
  inFlight.add(req.id);
  const started = performance.now();
  const latency = () => Math.max(0, Math.round(performance.now() - started));
  try {
    // The request and its case's update come in one transaction; give the cache a moment anyway.
    let c = undefined as ReturnType<typeof caseOf>;
    for (let wait = 0; !(c = caseOf(conn, req.id)) && wait < (opts.caseWaitMs ?? 1000); wait += 100) await new Promise(r => setTimeout(r, 100));
    if (!c) throw new Error('no open finance case for this request');
    if (c.benchmarkVersion !== undefined && c.benchmarkVersion !== FINANCE_BENCHMARK_VERSION) throw new Error('Cannot answer an episode from a different benchmark version');
    const toolsRow = conn.db.meta.key.find('finance_tools');
    if (!toolsRow) throw new Error('module has not published the desk tools yet');
    let takeTurn = turns.get(req.modelId);
    if (!takeTurn) {
      takeTurn = (opts.turnFor ?? deskTurnFor)(req.modelId);
      turns.set(req.modelId, takeTurn);
    }
    const answer = await withTimeout(answerDesk(takeTurn, req, c.variant, JSON.parse(toolsRow.value)), opts.timeoutMs ?? DESK_TIMEOUT_MS);
    if ('error' in answer) {
      await conn.reducers.failDecision({ requestId: req.id, error: answer.error, latencyMs: latency() });
      console.log(`desk #${req.id} ${req.modelId}  ${latency()} ms  ${answer.error.split('\n')[0].slice(0, 80)}`);
      return answer;
    }
    await conn.reducers.submitDecision({ requestId: req.id, action: answer.action, thought: answer.thought, latencyMs: latency() });
    console.log(`desk #${req.id} ${req.modelId}  ${latency()} ms  ${answer.action.slice(0, 120)}`);
    return answer;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`desk #${req.id} ${req.modelId} failed after ${latency()} ms: ${error}`);
    await conn.reducers.failDecision({ requestId: req.id, error: error.slice(0, 500), latencyMs: latency() }).catch(() => {});
    return { error };
  } finally {
    inFlight.delete(req.id);
  }
}
