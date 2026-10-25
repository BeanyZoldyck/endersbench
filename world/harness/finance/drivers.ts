// Runs one finance case against Claude, two ways, so the benchmark can tell
// the model apart from the harness around it. Both see the same neutral
// prompt, the same tools and the same CRS answers: the saved cards, or with
// --live-crs what the CRS sandbox returns for each call.
//  - messages: the benchmark's own loop. Every call is fresh: system prompt,
//    tools, and the whole case so far as one observation.
//  - managed: a Claude Managed Agents session. Anthropic runs the loop and
//    keeps the conversation; we only answer its tool calls.
import Anthropic from '@anthropic-ai/sdk';
import { EVENT_STEP, deliver, observe, phase, takeStep, type RawCrs } from '../../spacetimedb/src/finance/engine';
import { financeSystemPrompt } from '../../spacetimedb/src/finance/prompt';
import { financeTools } from '../../spacetimedb/src/finance/tools';
import type { Scenario, Seat, Step } from '../../spacetimedb/src/finance/types';
import type { Brain } from '../../spacetimedb/src/finance/brains';
import type { LiveCrs } from './crslive';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  listCostUsd?: number; // reported by Managed Agents; estimated for messages runs
}

export interface CaseRun {
  steps: Step[];
  notes: string[]; // what the model wrote or summarized while it worked
  stalls: number; // turns that ended without a tool call
  stopped?: string; // why the case ended early: refusal, timeout, ...
  usage: Usage;
  sessionId?: string;
}

export type RunCase = (scenario: Scenario, variant: string) => Promise<CaseRun>;

// Consecutive turns without a tool call before the case is given up.
const MAX_STALLS = 2;
const CASE_TIMEOUT_MS = 10 * 60_000;
// Hard cap per Managed Agents session, in cents.
const SESSION_BUDGET_CENTS = '200';
// Session calls are small. A request that hangs (one stalled for an hour on
// Sid's laptop) is cut off and retried instead of blocking the case.
const CALL = { timeout: 30_000 };

export function turnPrompt(observation: string) {
  return `Current observation (JSON):\n${observation}\n\nChoose your next action by calling exactly one tool.`;
}

export type DeskTool = ReturnType<typeof financeTools>[number];

function toClaudeTools(tools: DeskTool[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

export function claudeTools(seat: Seat) {
  return toClaudeTools(financeTools(seat));
}

function newRun(): CaseRun {
  return { steps: [], notes: [], stalls: 0, usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
}

// One model turn of the benchmark loop. The bench loop below and the world's
// harness (desk.ts) both take turns this way, so a case gets the same call
// offline and in the world.
export interface Turn {
  call?: { name: string; args: Record<string, unknown> };
  notes: string[]; // what the model wrote or summarized, in order
  refusal?: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
}

export type TakeTurn = (system: string, tools: DeskTool[], observation: string) => Promise<Turn>;

// Leaving effort out runs the model at its own default: stock means stock.
export function claudeTurn(client: Anthropic, opts: { model: string; effort?: Effort }): TakeTurn {
  return async (system, tools, observation) => {
    const reply = await client.messages.create({
      model: opts.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive', display: 'summarized' },
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      // Tools and system prompt repeat on every call of a seat: cache them.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: toClaudeTools(tools),
      // Current models reject forced tool use; the prompt asks for one call.
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: turnPrompt(observation) }],
    });
    const notes: string[] = [];
    for (const b of reply.content) {
      if (b.type === 'thinking' && b.thinking) notes.push(`(thinking) ${b.thinking}`);
      if (b.type === 'text' && b.text.trim()) notes.push(b.text.trim());
    }
    const use = reply.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    return {
      ...(use ? { call: { name: use.name, args: (use.input ?? {}) as Record<string, unknown> } } : {}),
      notes,
      ...(reply.stop_reason === 'refusal' ? { refusal: '' } : {}),
      usage: {
        inputTokens: reply.usage.input_tokens,
        outputTokens: reply.usage.output_tokens,
        cacheReadTokens: reply.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: reply.usage.cache_creation_input_tokens ?? 0,
      },
    };
  };
}

// The benchmark's own loop: a fresh call every turn with the whole case so
// far, until the case closes, the model refuses, or it stops calling tools.
// With `raw`, CRS tools answer with the full CRS response instead of the card;
// with `live`, with what the CRS sandbox returns for the call right now.
function benchLoop(takeTurn: TakeTurn, raw?: RawCrs, live?: LiveCrs): RunCase {
  return async (scenario, variant) => {
    const run = newRun();
    const system = financeSystemPrompt(scenario.seat, variant);
    const tools = financeTools(scenario.seat);
    let steps = deliver(scenario, []);
    let stalled = 0;
    while (phase(scenario, steps) !== 'closed') {
      const turn = await takeTurn(system, tools, observe(scenario, steps));
      const u = run.usage;
      u.calls += 1;
      u.inputTokens += turn.usage.inputTokens;
      u.outputTokens += turn.usage.outputTokens;
      u.cacheReadTokens += turn.usage.cacheReadTokens;
      u.cacheWriteTokens += turn.usage.cacheWriteTokens;
      run.notes.push(...turn.notes);
      if (turn.refusal !== undefined) {
        run.stopped = 'refusal';
        break;
      }
      if (!turn.call) {
        run.stalls += 1;
        if (++stalled > MAX_STALLS) {
          run.stopped = 'no tool call';
          break;
        }
        continue;
      }
      stalled = 0;
      const answer = await live?.(turn.call.name, turn.call.args);
      steps = takeStep(scenario, steps, turn.call.name, turn.call.args, { raw, answer });
    }
    run.steps = steps;
    return run;
  };
}

export function messagesDriver(client: Anthropic, opts: { model: string; effort?: Effort; raw?: RawCrs; live?: LiveCrs }): RunCase {
  return benchLoop(claudeTurn(client, opts), opts.raw, opts.live);
}

// A test script played through a case, as runBrain does, but able to wait on
// live CRS answers. Scripts read cards, whatever the agent format.
export function scriptDriver(brain: Brain, opts: { raw?: RawCrs; live?: LiveCrs } = {}): RunCase {
  return async scenario => {
    const run = newRun();
    let steps = deliver(scenario, []);
    while (phase(scenario, steps) !== 'closed') {
      const action = brain(JSON.parse(observe(scenario, steps, 'card')));
      const answer = await opts.live?.(action.tool, action.args);
      steps = takeStep(scenario, steps, action.tool, action.args, { raw: opts.raw, answer });
    }
    run.steps = steps;
    return run;
  };
}

const OPENAI_ATTEMPTS = 4;
const OPENAI_TIMEOUT_MS = 180_000;

// The same benchmark loop for OpenAI and any OpenAI-compatible API:
// OpenRouter (Gemini, Llama, ...), or our fine-tuned model on vLLM or Ollama. Same prompt,
// tools and observation as the Claude loop; tool use is offered, not forced,
// on both, and a 429 or 5xx is retried after the server's suggested wait.
// OpenAI itself goes through the Responses API: its reasoning models refuse
// function tools on Chat Completions unless reasoning is switched off, which
// would not be a stock model.
export type OpenAiApi = 'chat' | 'responses';

interface OpenAiReply {
  text: string[];
  reasoning?: string;
  call?: { name: string; arguments: string };
  refusal?: string;
  usage: { input: number; cached: number; output: number };
}

export interface OpenAiOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  api?: OpenAiApi;
  reasoningEffort?: string;
  fetchImpl?: typeof fetch;
}

export function openAiDriver(opts: OpenAiOptions & { raw?: RawCrs; live?: LiveCrs }): RunCase {
  return benchLoop(openAiTurn(opts), opts.raw, opts.live);
}

// A tool call a model wrote as text, which vLLM hands back as content when it runs
// without a tool parser (Ender on Runpod): Qwen's XML form
// <tool_call><function=name><parameter=k>v</parameter></function></tool_call>, or
// Hermes JSON <tool_call>{"name", "arguments"}</tool_call>. XML values are text, so
// each is typed by the tool's schema.
const TOOL_CALL_BLOCK = /<tool_call>[\s\S]*?(?:<\/tool_call>|$)/;

// Qwen, DeepSeek and Ender think beside the reply: reasoning_content (OpenRouter calls
// it reasoning), or a <think> block inside the reply when vLLM runs without a
// reasoning parser. It is kept as a (thinking) note, as Claude's is, capped so the
// reply still fits in the 4,000 characters a step keeps.
const THINK_BLOCK = /<think>([\s\S]*?)(?:<\/think>|$)/;
const MAX_THINKING = 3_000;

function thinkingNote(reasoning: string) {
  return reasoning.length > MAX_THINKING
    ? `(thinking) ${reasoning.slice(0, MAX_THINKING)}… (first ${MAX_THINKING} of ${reasoning.length} characters)`
    : `(thinking) ${reasoning}`;
}

export function textToolCall(content: string, tools: DeskTool[]): { name: string; arguments: string } | null {
  const block = content.match(TOOL_CALL_BLOCK)?.[0];
  if (!block) return null;
  const xml = block.match(/<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|$)/);
  if (xml) {
    const props: Record<string, any> = tools.find(t => t.name === xml[1])?.parameters?.properties ?? {};
    const args: Record<string, unknown> = {};
    for (const [, key, raw] of xml[2].matchAll(/<parameter=([\w.-]+)>\s*([\s\S]*?)\s*<\/parameter>/g)) {
      const type = props[key]?.type;
      if (type === 'number' || type === 'integer') args[key] = Number.isFinite(Number(raw)) ? Number(raw) : raw;
      else if (type === 'boolean') args[key] = raw === 'true' ? true : raw === 'false' ? false : raw;
      else if (type === 'object' || type === 'array') {
        try {
          args[key] = JSON.parse(raw);
        } catch {
          args[key] = raw;
        }
      } else args[key] = raw;
    }
    return { name: xml[1], arguments: JSON.stringify(args) };
  }
  try {
    const json = JSON.parse(block.replace(/<\/?tool_call>/g, '').trim());
    if (typeof json?.name !== 'string') return null;
    const args = typeof json.arguments === 'string' ? json.arguments : JSON.stringify(json.arguments ?? {});
    return { name: json.name, arguments: args };
  } catch {
    return null;
  }
}

export function openAiTurn(opts: OpenAiOptions): TakeTurn {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const api = opts.api ?? 'chat';
  const url = `${opts.baseUrl.replace(/\/$/, '')}/${api === 'responses' ? 'responses' : 'chat/completions'}`;

  async function post(body: unknown): Promise<any> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      });
      if (res.ok) return res.json();
      const text = await res.text();
      // A 429 for an empty balance is not a rate limit: waiting will not help.
      const retryable = (res.status === 429 && !text.includes('insufficient_quota')) || res.status >= 500;
      if (!retryable || attempt >= OPENAI_ATTEMPTS) throw new Error(`${url} answered ${res.status}: ${text.slice(0, 300)}`);
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, wait * 1000));
    }
  }

  async function chatTurn(system: string, tools: DeskTool[], prompt: string): Promise<OpenAiReply> {
    const reply = await post({
      model: opts.model,
      max_completion_tokens: 16000,
      ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
      tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: 'auto',
      parallel_tool_calls: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    });
    const message = reply.choices?.[0]?.message ?? {};
    const raw = typeof message.content === 'string' ? message.content.trim() : '';
    const think = raw.match(THINK_BLOCK);
    const content = think ? raw.replace(THINK_BLOCK, '').trim() : raw;
    const reasoning = [message.reasoning_content, message.reasoning, think?.[1]].find((r): r is string => typeof r === 'string' && r.trim() !== '')?.trim();
    const written = message.tool_calls?.[0]?.function?.name ? null : textToolCall(content, tools);
    const call = written ?? message.tool_calls?.[0]?.function;
    const text = written ? content.replace(TOOL_CALL_BLOCK, '').trim() : content;
    return {
      text: text ? [text] : [],
      ...(reasoning ? { reasoning } : {}),
      ...(call?.name ? { call: { name: call.name, arguments: call.arguments ?? '' } } : {}),
      ...(message.refusal ? { refusal: message.refusal } : {}),
      usage: { input: reply.usage?.prompt_tokens ?? 0, cached: reply.usage?.prompt_tokens_details?.cached_tokens ?? 0, output: reply.usage?.completion_tokens ?? 0 },
    };
  }

  async function responsesTurn(system: string, tools: DeskTool[], prompt: string): Promise<OpenAiReply> {
    const reply = await post({
      model: opts.model,
      instructions: system,
      input: [{ role: 'user', content: prompt }],
      // strict would demand every property be required; the desk's schemas have optional ones.
      tools: tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false })),
      tool_choice: 'auto',
      parallel_tool_calls: false,
      max_output_tokens: 16000,
      ...(opts.reasoningEffort ? { reasoning: { effort: opts.reasoningEffort } } : {}),
      store: false,
    });
    const turn: OpenAiReply = {
      text: [],
      usage: { input: reply.usage?.input_tokens ?? 0, cached: reply.usage?.input_tokens_details?.cached_tokens ?? 0, output: reply.usage?.output_tokens ?? 0 },
    };
    for (const item of reply.output ?? []) {
      if (item.type === 'function_call' && !turn.call) turn.call = { name: item.name, arguments: item.arguments ?? '' };
      if (item.type !== 'message') continue;
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && part.text?.trim()) turn.text.push(part.text.trim());
        if (part.type === 'refusal') turn.refusal = part.refusal;
      }
    }
    return turn;
  }

  return async (system, tools, observation) => {
    const reply = await (api === 'responses' ? responsesTurn : chatTurn)(system, tools, turnPrompt(observation));
    const turn: Turn = {
      notes: [...(reply.reasoning ? [thinkingNote(reply.reasoning)] : []), ...reply.text],
      usage: { inputTokens: reply.usage.input - reply.usage.cached, outputTokens: reply.usage.output, cacheReadTokens: reply.usage.cached, cacheWriteTokens: 0 },
    };
    if (reply.refusal) {
      turn.notes.push(`(refusal) ${reply.refusal}`);
      turn.refusal = reply.refusal;
      return turn;
    }
    if (!reply.call) return turn;
    try {
      turn.call = { name: reply.call.name, args: reply.call.arguments ? JSON.parse(reply.call.arguments) : {} };
    } catch {
      turn.notes.push(`(bad tool arguments) ${reply.call.arguments.slice(0, 200)}`);
    }
    return turn;
  };
}

// What a session hears back after one action: the result, plus anything the
// director said since, in the words the observation would have used.
export function toolReply(scenario: Scenario, before: Step[], after: Step[]) {
  const messages = after
    .slice(before.length + 1)
    .filter(s => s.tool === EVENT_STEP)
    .map(s => {
      const e = scenario.events[s.args.index as number];
      return { from: e.from, text: e.text };
    });
  const { supervisor } = JSON.parse(observe(scenario, after)) as { supervisor?: string };
  return {
    result: after[before.length].result,
    ...(messages.length ? { messages } : {}),
    ...(supervisor ? { supervisor } : {}),
  };
}

export interface ManagedSetup {
  environmentId: string;
  agents: Record<string, { id: string; version: number }>; // keyed seat/variant
}

export const agentKey = (seat: Seat, variant: string) => `${seat}/${variant}`;

// Creates the environment and one agent per seat and prompt variant, or
// updates the ones already recorded (an unchanged agent keeps its version).
export async function setupManaged(
  client: Anthropic,
  opts: { model: string; effort?: Effort; seats: Seat[]; variants: string[] },
  existing?: ManagedSetup
): Promise<ManagedSetup> {
  const environmentId =
    existing?.environmentId ??
    (
      await client.beta.environments.create({
        name: 'endersbench-finance',
        // The agents have no built-in tools; the sandbox needs no network.
        config: { type: 'cloud', networking: { type: 'limited' } },
      })
    ).id;
  const agents: ManagedSetup['agents'] = {};
  for (const seat of opts.seats) {
    for (const variant of opts.variants) {
      const key = agentKey(seat, variant);
      const config = {
        model: opts.effort ? { id: opts.model, effort: opts.effort } : { id: opts.model },
        system: financeSystemPrompt(seat, variant),
        tools: financeTools(seat).map(t => ({
          type: 'custom' as const,
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Beta.Agents.BetaManagedAgentsCustomToolInputSchema,
        })),
      };
      const prior = existing?.agents[key];
      const agent = prior
        ? await client.beta.agents.update(prior.id, config)
        : await client.beta.agents.create({ name: `Ender's Bench finance: ${key}`, ...config });
      agents[key] = { id: agent.id, version: agent.version };
    }
  }
  return { environmentId, agents };
}

type SessionEvent = Anthropic.Beta.Sessions.BetaManagedAgentsSessionEvent;
type SendEvent = Anthropic.Beta.Sessions.EventSendParams['events'][number];

// Polls the session's event list instead of holding its SSE stream open: on
// a laptop whose security software inspects TLS (CrowdStrike here) the stream
// is buffered and delivers nothing, while the list works through any proxy.
export function managedDriver(client: Anthropic, setup: ManagedSetup, opts: { pollMs?: number; live?: LiveCrs } = {}): RunCase {
  const pollMs = opts.pollMs ?? 1000;
  return async (scenario, variant) => {
    const run = newRun();
    const agent = setup.agents[agentKey(scenario.seat, variant)];
    if (!agent) throw new Error(`no managed agent for ${agentKey(scenario.seat, variant)}; check runs/managed.json`);
    const session = await client.beta.sessions.create({
      agent: { type: 'agent', id: agent.id, version: agent.version },
      environment_id: setup.environmentId,
      title: `${scenario.id} (${variant})`,
      budget: { type: 'limit', max_list_cost: { amount: SESSION_BUDGET_CENTS, currency: 'USD' } },
    });
    run.sessionId = session.id;
    const send = (events: SendEvent[]) => client.beta.sessions.events.send(session.id, { events }, CALL);
    const text = (t: string): SendEvent => ({ type: 'user.message', content: [{ type: 'text', text: t }] });

    let steps = deliver(scenario, []);
    let stalled = 0;
    let afterClose = 0;
    let done = false;
    const seen = new Set<string>();

    async function handle(event: SessionEvent) {
      if (seen.has(event.id)) return;
      seen.add(event.id);
      switch (event.type) {
        case 'agent.message':
          for (const b of event.content) if (b.type === 'text' && b.text.trim()) run.notes.push(b.text.trim());
          return;
        case 'span.model_request_end':
          run.usage.calls += 1;
          return;
        case 'agent.custom_tool_use': {
          if (phase(scenario, steps) === 'closed') {
            if (++afterClose > MAX_STALLS) {
              await send([{ type: 'user.interrupt' }]);
              done = true;
              return;
            }
            await send([{ type: 'user.custom_tool_result', custom_tool_use_id: event.id, is_error: true, content: [{ type: 'text', text: 'This case is closed.' }] }]);
            return;
          }
          stalled = 0;
          const before = steps;
          const answer = await opts.live?.(event.name, event.input);
          steps = takeStep(scenario, steps, event.name, event.input, { answer });
          const reply = JSON.stringify(toolReply(scenario, before, steps));
          await send([{ type: 'user.custom_tool_result', custom_tool_use_id: event.id, content: [{ type: 'text', text: reply }] }]);
          return;
        }
        case 'session.status_idle': {
          const reason = event.stop_reason.type;
          if (reason === 'requires_action') return;
          if (reason === 'end_turn' && phase(scenario, steps) !== 'closed') {
            run.stalls += 1;
            if (++stalled <= MAX_STALLS) {
              await send([text('No new messages. Choose your next action by calling exactly one tool.')]);
              return;
            }
            run.stopped = 'no tool call';
          } else if (reason !== 'end_turn') {
            run.stopped = reason;
          }
          done = true;
          return;
        }
        case 'session.status_terminated':
          run.stopped ??= 'terminated';
          done = true;
          return;
        case 'session.error':
          run.notes.push(`(session error) ${event.error.type}`);
          return;
      }
    }

    const deadline = Date.now() + CASE_TIMEOUT_MS;
    let since: string | undefined;
    await send([text(turnPrompt(observe(scenario, steps)))]);
    while (!done) {
      if (Date.now() > deadline) {
        run.stopped = 'timeout';
        await send([{ type: 'user.interrupt' }]).catch(() => undefined);
        break;
      }
      let fresh = false;
      // Inclusive, so events sharing the last timestamp are not skipped; `seen` drops repeats.
      for await (const event of client.beta.sessions.events.list(session.id, since ? { 'created_at[gte]': since } : undefined, CALL)) {
        if (event.processed_at) since = event.processed_at;
        if (seen.has(event.id)) continue;
        fresh = true;
        await handle(event);
        if (done) break;
      }
      if (!done && !fresh) await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    const usage = (await client.beta.sessions.retrieve(session.id)).usage;
    run.usage = {
      calls: run.usage.calls,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: (usage.cache_creation?.ephemeral_5m_input_tokens ?? 0) + (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0),
      ...(usage.list_cost ? { listCostUsd: Number(usage.list_cost.amount) / 100 } : {}),
    };
    run.steps = steps;
    return run;
  };
}
