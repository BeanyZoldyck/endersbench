// The finance desk inside the world. The finance core (finance/) stays pure;
// this file keeps its cases in tables and moves them along. A desk request is
// an ordinary decision_request row with agentId 0, so the world keeps one
// queue, one audit trail and one door for model output: submit_decision hands
// desk requests to routeDeskDecision, and the desk tick opens queued cases and
// asks again when a request failed or went unanswered, as the offline bench
// loop does. Scores come from the same gate and verifier as the bench. CRS
// tools answer from the cards, or with what the CRS sandbox returned when the
// worker fetched it live and sent it with the action.
//
// The world mounts this in three places (schema.ts, index.ts, harness/main.ts);
// nothing here imports schema.ts at runtime, so there is no import cycle.
import { ScheduleAt } from 'spacetimedb';
import { SenderError, t, table, type InferSchema, type ReducerCtx, type schema, type Schema } from 'spacetimedb/server';
import type { admin, decisionRequest, harnessWorker, meta } from './schema';
import { EVENT_STEP, type CrsAnswer, deliver, isCrsTool, observe, phase, takeStep } from './finance/engine';
import { gateCase } from './finance/gate';
import { FINANCE_PROMPT_VARIANTS } from './finance/prompt';
import { FINANCE_BENCHMARK_VERSION, SCENARIOS, SCENARIO_BY_ID, forVariant } from './finance/scenarios';
import { financeTools } from './finance/tools';
import type { CrsCall, Seat, Step } from './finance/types';
import { verify } from './finance/verifier';

// One row per case run: one model working one case once.
export const financeCase = table(
  { name: 'finance_case', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    scenarioId: t.string(),
    seat: t.string(), // 'lending' | 'collections' | 'vendor_payments'
    modelId: t.string(), // "provider:model", as in the forest roster
    variant: t.string(), // prompt variant, one of FINANCE_PROMPT_VARIANTS
    sample: t.u32(), // which run of this case, from 0
    benchmarkVersion: t.u32(),
    status: t.string().index('btree'), // 'queued' | 'open' | 'closed'
    pendingRequestId: t.u64().index('btree'), // 0 = none in flight
    stalls: t.u32(), // turns in a row without a usable action
    stopped: t.string(), // why the case ended early ('no tool call', 'refusal', ...); '' otherwise
    queuedAt: t.timestamp(),
  }
);

// Everything that happened on a case, in order: the agent's actions with
// their results, and the director's messages (tool '__event').
export const financeStep = table(
  { name: 'finance_step', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    caseId: t.u64().index('btree'),
    seq: t.u32(),
    tool: t.string(),
    args: t.string(), // JSON
    result: t.string(), // JSON; '' for director messages
    requestId: t.u64(), // the decision request that chose it; 0 for director messages
    thought: t.string(), // the model's notes for the turn: thinking summary and text
    // JSON CrsCall when the worker answered a CRS tool from the live sandbox
    // (harness/finance/crslive.ts): RequestID, latency, any drift. '' otherwise.
    crs: t.string().default(''),
  }
);

// A closed case's score: compliant completion and its three parts.
export const financeVerdict = table(
  { name: 'finance_verdict', public: true },
  {
    caseId: t.u64().primaryKey(),
    pass: t.bool(),
    outcome: t.bool(),
    process: t.bool(),
    output: t.bool(),
    harm: t.bool(), // any Tier 1 violation
    abstained: t.bool(),
    actionNeeded: t.bool(),
    decision: t.string(), // the final decision tool; '' for none
    failures: t.string(), // JSON string[], as gate.ts names them
    verdict: t.string(), // JSON Verdict from verifier.ts
  }
);

// Runs only while a case is queued or open, so an idle desk costs nothing.
export const financeTimer = table(
  { name: 'finance_timer' },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() }
);

type DeskSchema = ReturnType<
  typeof schema<{
    decisionRequest: typeof decisionRequest;
    harnessWorker: typeof harnessWorker;
    admin: typeof admin;
    meta: typeof meta;
    financeCase: typeof financeCase;
    financeStep: typeof financeStep;
    financeVerdict: typeof financeVerdict;
    financeTimer: typeof financeTimer;
  }>
>;
// The part of the world's database the desk uses.
export type DeskCtx = ReducerCtx<InferSchema<DeskSchema>>;
type Case = NonNullable<ReturnType<DeskCtx['db']['financeCase']['id']['find']>>;
type Request = NonNullable<ReturnType<DeskCtx['db']['decisionRequest']['id']['find']>>;

const TICK_MICROS = 1_000_000n;
// A reasoning model's turn can take minutes; the bench allows 3 for one call.
export const DESK_REQUEST_TIMEOUT_MS = 5 * 60_000;
// Turns in a row without a usable action before the case is given up, as in the bench loop.
export const DESK_MAX_STALLS = 2;
// Cases open at once per model and prompt, like the bench's --concurrency.
export const DESK_CONCURRENCY = 4;

// The desk's entries for the world's meta table: the action catalog per seat.
export function deskMeta(): Record<string, string> {
  const seats: Seat[] = ['lending', 'collections', 'vendor_payments'];
  return { finance_benchmark_version: String(FINANCE_BENCHMARK_VERSION), finance_tools: JSON.stringify(Object.fromEntries(seats.map(s => [s, financeTools(s)]))) };
}

function authorised(ctx: DeskCtx) {
  return ctx.db.harnessWorker.identity.find(ctx.sender) != null || ctx.db.admin.identity.find(ctx.sender) != null;
}

// The worker's action, and for a CRS tool it answered from the live sandbox,
// that answer: {"name", "args", "crs": {"result": card, "call": CrsCall}}.
function parseAction(raw: string): { name: string; args: Record<string, unknown>; answer?: CrsAnswer } | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.name !== 'string' || !parsed.name) return null;
    const crs = parsed.crs;
    const answer =
      isCrsTool(parsed.name) && crs && typeof crs.result === 'object' && crs.result && typeof crs.call?.source === 'string'
        ? { result: crs.result, crs: crs.call as CrsCall }
        : undefined;
    return { name: parsed.name, args: parsed.args && typeof parsed.args === 'object' ? parsed.args : {}, ...(answer ? { answer } : {}) };
  } catch {
    return null;
  }
}

export function deskSteps(ctx: DeskCtx, caseId: bigint): Step[] {
  return [...ctx.db.financeStep.caseId.filter(caseId)]
    .sort((a, b) => a.seq - b.seq)
    .map(s => ({
      tool: s.tool,
      args: JSON.parse(s.args),
      ...(s.result ? { result: JSON.parse(s.result) } : {}),
      ...(s.crs ? { crs: JSON.parse(s.crs) } : {}),
    }));
}

// Stores steps[from..]: the agent's action first, then any messages it unlocked.
function writeSteps(ctx: DeskCtx, caseId: bigint, steps: Step[], from: number, requestId: bigint, thought: string) {
  steps.slice(from).forEach((s, i) => {
    const event = s.tool === EVENT_STEP;
    ctx.db.financeStep.insert({
      id: 0n,
      caseId,
      seq: from + i,
      tool: s.tool,
      args: JSON.stringify(s.args),
      result: s.result === undefined ? '' : JSON.stringify(s.result),
      requestId: event ? 0n : requestId,
      thought: event ? '' : thought,
      crs: s.crs ? JSON.stringify(s.crs) : '',
    });
  });
}

function updateCase(ctx: DeskCtx, id: bigint, fields: Partial<Case>) {
  const c = ctx.db.financeCase.id.find(id)!;
  return ctx.db.financeCase.id.update({ ...c, ...fields });
}

function ask(ctx: DeskCtx, c: Case, steps: Step[]) {
  const req = ctx.db.decisionRequest.insert({
    id: 0n,
    agentId: 0n, // not a survivor: the desk's case row points at this request
    modelId: c.modelId,
    status: 'pending',
    observation: observe(SCENARIO_BY_ID[c.scenarioId], steps),
    gameTimeMs: 0,
    createdAt: ctx.timestamp,
    action: '',
    thought: '',
    error: '',
    latencyMs: 0,
    brain: 'harness',
    reasoning: '',
  });
  updateCase(ctx, c.id, { pendingRequestId: req.id });
}

function close(ctx: DeskCtx, c: Case, steps: Step[], stopped = '') {
  // Scored as the case's prompt variant saw it (v6).
  const scenario = forVariant(SCENARIO_BY_ID[c.scenarioId], c.variant);
  const verdict = verify(scenario, steps);
  const gate = gateCase(scenario, steps);
  ctx.db.financeVerdict.insert({
    caseId: c.id,
    pass: gate.pass,
    outcome: gate.outcome,
    process: gate.process,
    output: gate.output,
    harm: gate.harm,
    abstained: gate.abstained,
    actionNeeded: gate.actionNeeded,
    decision: verdict.decision ?? '',
    failures: JSON.stringify(gate.failures),
    verdict: JSON.stringify(verdict),
  });
  updateCase(ctx, c.id, { status: 'closed', pendingRequestId: 0n, stopped });
}

// A turn with no usable action: ask again, or give the case up. A refusal
// ends the case at once, as in the bench: it is a result about the model.
function stall(ctx: DeskCtx, c: Case, error: string) {
  const steps = deskSteps(ctx, c.id);
  if (error.startsWith('refusal')) return close(ctx, c, steps, 'refusal');
  if (c.stalls >= DESK_MAX_STALLS) return close(ctx, c, steps, error.startsWith('no tool call') ? 'no tool call' : `error: ${error.slice(0, 200)}`);
  ask(ctx, updateCase(ctx, c.id, { stalls: c.stalls + 1 }), steps);
}

function open(ctx: DeskCtx, c: Case) {
  const steps = deliver(SCENARIO_BY_ID[c.scenarioId], []);
  writeSteps(ctx, c.id, steps, 0, 0n, '');
  ask(ctx, updateCase(ctx, c.id, { status: 'open' }), steps);
}

function startTimer(ctx: DeskCtx) {
  if (ctx.db.financeTimer.count() === 0n) ctx.db.financeTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_MICROS) });
}

// Queues `repeat` runs of each case for one model and prompt; the tick opens them.
export function queueDeskRun(ctx: DeskCtx, opts: { modelId: string; variant: string; repeat: number; cases: string }) {
  if (!authorised(ctx)) throw new SenderError('not authorised');
  if (!opts.modelId.trim()) throw new SenderError('modelId required');
  if (!FINANCE_PROMPT_VARIANTS.includes(opts.variant)) throw new SenderError(`variant must be one of ${FINANCE_PROMPT_VARIANTS.join(', ')}`);
  const ids = opts.cases.trim() ? opts.cases.split(',').map(s => s.trim()) : SCENARIOS.map(s => s.id);
  const unknown = ids.filter(id => !SCENARIO_BY_ID[id]);
  if (unknown.length) throw new SenderError(`unknown case ${unknown.join(', ')}`);
  const repeat = Math.min(Math.max(Math.floor(opts.repeat), 1), 10);
  for (let sample = 0; sample < repeat; sample++) {
    for (const id of ids) {
      ctx.db.financeCase.insert({
        id: 0n,
        scenarioId: id,
        seat: SCENARIO_BY_ID[id].seat,
        modelId: opts.modelId,
        variant: opts.variant,
        sample,
        benchmarkVersion: FINANCE_BENCHMARK_VERSION,
        status: 'queued',
        pendingRequestId: 0n,
        stalls: 0,
        stopped: '',
        queuedAt: ctx.timestamp,
      });
    }
  }
  startTimer(ctx);
}

// The desk's clock: asks again where a request failed or timed out, then
// opens queued cases up to the concurrency limit. Stops itself when idle.
export function deskTick(ctx: DeskCtx) {
  for (const c of [...ctx.db.financeCase.status.filter('open')]) {
    const req = ctx.db.decisionRequest.id.find(c.pendingRequestId);
    if (!req) {
      stall(ctx, c, 'request missing');
      continue;
    }
    if (req.status === 'pending') {
      const ageMs = Number(ctx.timestamp.microsSinceUnixEpoch - req.createdAt.microsSinceUnixEpoch) / 1000;
      if (ageMs < DESK_REQUEST_TIMEOUT_MS) continue;
      ctx.db.decisionRequest.id.update({ ...req, status: 'expired', error: 'no answer in time' });
      stall(ctx, c, 'no answer in time');
    } else if (req.status === 'failed' || req.status === 'expired') {
      stall(ctx, c, req.error);
    }
  }

  const key = (c: Case) => `${c.modelId}|${c.variant}`;
  const busy = new Map<string, number>();
  for (const c of ctx.db.financeCase.status.filter('open')) busy.set(key(c), (busy.get(key(c)) ?? 0) + 1);
  const queued = [...ctx.db.financeCase.status.filter('queued')].sort((a, b) => Number(a.id - b.id));
  for (const c of queued) {
    if ((busy.get(key(c)) ?? 0) >= DESK_CONCURRENCY) continue;
    open(ctx, c);
    busy.set(key(c), (busy.get(key(c)) ?? 0) + 1);
  }

  if (queued.length === 0 && busy.size === 0) {
    for (const timer of [...ctx.db.financeTimer.iter()]) ctx.db.financeTimer.scheduledId.delete(timer.scheduledId);
  }
}

// submit_decision's path for a desk request. Returns false when the request
// is not the desk's, so the world's own handling runs.
export function routeDeskDecision(ctx: DeskCtx, req: Request, answer: { action: string; thought: string; latencyMs: number }): boolean {
  const c = [...ctx.db.financeCase.pendingRequestId.filter(req.id)].find(c => c.status === 'open');
  if (!c) return false;
  // The request keeps a one-line thought, as the forest's do; the step keeps the model's notes.
  const thought = answer.thought.slice(0, 120);
  const notes = answer.thought.slice(0, 4000);
  const parsed = parseAction(answer.action);
  if (!parsed) {
    const error = 'action is not {"name": string, "args": object} JSON';
    ctx.db.decisionRequest.id.update({ ...req, status: 'failed', action: answer.action, thought, error, latencyMs: answer.latencyMs });
    stall(ctx, c, error);
    return true;
  }
  ctx.db.decisionRequest.id.update({ ...req, status: 'done', action: answer.action, thought, error: '', latencyMs: answer.latencyMs });
  const scenario = SCENARIO_BY_ID[c.scenarioId];
  const before = deskSteps(ctx, c.id);
  // A live CRS answer replaces the card lookup; the agent and the verifier both read it.
  const after = takeStep(scenario, before, parsed.name, parsed.args, { answer: parsed.answer });
  writeSteps(ctx, c.id, after, before.length, req.id, notes);
  const moved = updateCase(ctx, c.id, { stalls: 0, pendingRequestId: 0n });
  if (phase(scenario, after) === 'closed') close(ctx, moved, after);
  else ask(ctx, moved, after);
  return true;
}

// The desk's reducers, made on the world's schema so they can be exported
// from index.ts beside its own: queue_finance_run and the scheduled tick.
// The world's schema holds the desk's tables among its own; DeskCtx names
// only the desk's, hence the one cast.
export function defineDeskReducers<W extends Schema<any>>(world: W) {
  const spacetimedb = world as Schema<InferSchema<W>>;
  const desk = (ctx: unknown) => ctx as DeskCtx;
  return {
    queueFinanceRun: spacetimedb.reducer(
      { modelId: t.string(), variant: t.string(), repeat: t.u32(), cases: t.string() },
      (ctx, args) => queueDeskRun(desk(ctx), args)
    ),
    financeTick: spacetimedb.reducer({ onSchedule: financeTimer }, { timer: financeTimer.rowType }, ctx => deskTick(desk(ctx))),
  };
}
