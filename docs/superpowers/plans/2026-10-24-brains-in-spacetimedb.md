# Brains in SpacetimeDB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every model call for a Clearing run happens inside the SpacetimeDB module, so a run needs no Node harness.

**Architecture:** `brainTick` already opens a `decision_request` per survivor. In a database-brained run it also schedules a `think` procedure for that request. The procedure builds the same HTTP request the harness builds (shared code), calls the provider with `ctx.http.fetch`, and settles the request through the same code path `submitDecision` uses. API keys live in SpacetimeDB database environment variables. A new admin reducer `beginRun` starts a database-brained run without the harness.

**Tech Stack:** SpacetimeDB 2.13 TypeScript module (`spacetimedb/server`: scheduled tables, procedures, `ctx.http.fetch`, `ctx.env`), vitest, the existing Node harness (esbuild), React viewer.

**Spec:** No separate spec; the requirements were settled in conversation on 2026-10-24 and are restated under Global Constraints. Out of scope: history/leaderboard in the database (part 3), Apify deployment (part 5), per-player visibility (dropped: humans seeing everything is intended).

**Already proven (throwaway spike, deleted):** scheduled procedures ran four 2-second HTTP calls in parallel; the 20 Hz tick never stalled (worst gap 50.8 ms local, 51.3 ms Maincloud); Maincloud reaches Bitdeer, Anthropic and OpenAI. Spike source: `spacetimedb.procedure({ onSchedule: job }, { job: job.rowType }, t.unit(), (ctx, { job }) => { … ctx.http.fetch(url, { timeout: TimeDuration.fromMillis(…) }) … ctx.withTx(tx => …); return {}; })`.

## Global Constraints

- Providers in database runs: `bitdeer`, `openai`, `anthropic`, `openrouter`, `ender`. `codex` and `fake` stay harness-only; `beginRun` rejects them.
- Parity with `world/harness/brains.ts`: same system prompt text, same tools with the appended required `thought` ("Why, in 12 words or fewer."), same user message, `MAX_OUTPUT_TOKENS = 200`, same reply parsing. Achieved by moving that code into the module and having the harness import it, not by copying.
- `bitdeer` sends `reasoning_effort: "none"`; `ender` sends `chat_template_kwargs: { enable_thinking: false }` (Runpod vLLM, URL from `ENDER_BASE_URL`).
- Keys only in database environment variables: `BITDEER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `ENDER_BASE_URL`, `ENDER_API_KEY`, all optional strings. Never in tables, reducer arguments, logs or code.
- Procedure HTTP timeout 25 s, under `REQUEST_TIMEOUT_MS` (30 s) so the procedure fails a request before `brainTick` expires it.
- Error text matches the harness: `${url} answered ${status}: ${body.slice(0, 300)}`, `model answered without calling a tool (finish_reason: …)`, `${provider} models need ${ENV_NAME}`.
- Schema changes are append-only columns with `.default(...)` plus one new table, so existing local worlds hot-publish without a reset.
- Rules stay v13. A database run records `brains: "database"` in meta `run`; each request records `brain`.
- Finance desk requests (`agentId 0`) are untouched and stay with the harness.
- Commits follow the repo's style (plain subject line, explanatory body) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A database run whose provider key is missing: the request must fail at once with `bitdeer models need BITDEER_API_KEY` in `model_health`, not hang for 30 s. (Task 1 test on `buildModelCall`; Task 2 procedure path.)
2. A model answer arriving after its request expired or its survivor died: settling must be a no-op, never a throw inside `withTx`. (Task 2 test on `settleThought`.)
3. An HTML or non-JSON error page (Runpod cold start 502): recorded as `… answered 502: …`, no crash. (Task 1 test on `decisionFromResponse`.)
4. A harness left connected to a database-brained world must not answer the same requests and spend tokens twice. (Task 4: harness skips `brain === 'database'`; verified in the Task 5 smoke run.)
5. Re-running `beginRun` on a world that has a human player or an old roster: the new roster replaces every survivor; no stale agents keep thinking. (Task 3 test.)

---

### Task 1: Shared decision protocol and prompt, used by the harness

**Files:**
- Create: `world/spacetimedb/src/brain/prompt.ts` (move the whole body of `world/harness/prompt.ts` here unchanged)
- Modify: `world/harness/prompt.ts` (becomes `export * from '../spacetimedb/src/brain/prompt';`)
- Create: `world/spacetimedb/src/brain/protocol.ts`
- Modify: `world/harness/brains.ts` (types, `withThought`, `toDecision`, `userMessage`, `MAX_OUTPUT_TOKENS`, request bodies, reply parsing and the OpenAI-compatible table now come from `protocol.ts`; the working tree's uncommitted Runpod `ender` change moves into `PROVIDERS`)
- Test: `world/spacetimedb/src/brain/protocol.test.ts`; existing `world/harness/brains.test.ts` and `world/harness/prompt.test.ts` must still pass unchanged

**Interfaces:**
- Produces (all exported from `protocol.ts`, no imports from `spacetimedb/server`, no Node APIs):
  - types `JsonSchema`, `Tool`, `Decision` (moved verbatim from brains.ts)
  - `MAX_OUTPUT_TOKENS = 200`
  - `withThought(tools: Tool[]): Tool[]`, `toDecision(name: string, rawArgs: Record<string, unknown>): Decision`, `userMessage(agentName: string, observation: unknown): string` (same text as today)
  - `type ProviderSpec = { api: 'openai-chat' | 'anthropic'; baseUrl?: string; baseUrlEnv?: string; keyEnv?: string; keyOptional?: boolean; extraBody?: Record<string, unknown> }`
  - `PROVIDERS: Record<string, ProviderSpec>` with keys `openai`, `openrouter`, `bitdeer`, `ender`, `ollama` (`baseUrlEnv: 'OLLAMA_BASE_URL'`, default `http://localhost:11434/v1`, no key), `anthropic` (`baseUrl: 'https://api.anthropic.com/v1'`)
  - `DATABASE_PROVIDERS = ['bitdeer', 'openai', 'anthropic', 'openrouter', 'ender']`
  - `splitModelId(modelId: string): { provider: string; model: string }`
  - `type ModelCall = { api: ProviderSpec['api']; url: string; headers: Record<string, string>; body: unknown }`
  - `buildModelCall(modelId: string, input: { agentName: string; observation: unknown; tools: Tool[]; system: string }, env: (name: string) => string | undefined): ModelCall` (throws `${provider} models need ${ENV}` or `unknown provider '…' in modelId '…'`)
  - `decisionFromResponse(api: ModelCall['api'], url: string, status: number, text: string): Decision` (throws on non-2xx, invalid JSON, or no tool call)

- [ ] **Step 1: Write failing tests in `protocol.test.ts`**
  - `bitdeer request matches the harness`: `buildModelCall('bitdeer:deepseek-ai/DeepSeek-V4.1-Flash', input, env)` has `url` `https://api-inference.bitdeer.ai/v1/chat/completions`, header `authorization: Bearer k`, body `max_tokens` 200, `tool_choice` `'required'`, `reasoning_effort` `'none'`, last tool property `thought` required, messages `[{ role: 'system', content: 'SYS' }, { role: 'user', content: userMessage('Ada', obs) }]`.
  - `anthropic request`: url `https://api.anthropic.com/v1/messages`, headers `x-api-key` and `anthropic-version: 2023-06-01`, body `tool_choice: { type: 'any' }`, tools use `input_schema`, `system: 'SYS'`.
  - `ender reads its URL from ENDER_BASE_URL and sends enable_thinking false`; key optional (no authorization header when `ENDER_API_KEY` unset).
  - `a missing key names the variable`: env without `BITDEER_API_KEY` throws `bitdeer models need BITDEER_API_KEY`.
  - `decisionFromResponse` cases: OpenAI tool call `{"x":3,"thought":"go"}` gives `{ action: { name: 'move_to', args: { x: 3 } }, thought: 'go' }`; Anthropic `tool_use` block likewise; `finish_reason: 'length'` with no tool call throws `/finish_reason: length/`; status 502 with `<html>bad gateway` throws `https://x/v1/chat/completions answered 502: <html>bad gateway`; status 200 with `not json` throws.

- [ ] **Step 2: Run them and see them fail**
  Run: `cd world/spacetimedb && npx vitest run src/brain/protocol.test.ts`
  Expected: FAIL, cannot resolve `./protocol`.

- [ ] **Step 3: Implement `protocol.ts`, move `prompt.ts`, and rewire `brains.ts`**
  `openAiCompatibleBrain` and `anthropicBrain` keep their exported signatures (tests construct them directly) but build bodies and parse replies with the shared functions; `brainFor`'s OpenAI-compatible lookup reads `PROVIDERS`. Keep `postJson`'s non-2xx error text identical.

- [ ] **Step 4: Run module and harness tests**
  Run: `cd world/spacetimedb && npx vitest run` then `cd world && npx vitest run harness && npx esbuild harness/main.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-harness/main.js --log-level=warning`
  Expected: all pass; bundle builds.

- [ ] **Step 5: Commit** — subject `Brains share one decision protocol between the module and the harness`.

### Task 2: Database-brained requests and the `think` procedure

**Files:**
- Modify: `world/spacetimedb/src/schema.ts` (append `brain: t.string().default('harness')` to `decision_request`; append `lastLatencyMs: t.u32().default(0)` to `agent`; new private scheduled table `think_job { scheduledId: u64 pk autoInc, scheduledAt: scheduleAt, requestId: u64 }`; pass `{ env: { BITDEER_API_KEY: t.option(t.string()), OPENAI_API_KEY: …, ANTHROPIC_API_KEY: …, OPENROUTER_API_KEY: …, ENDER_BASE_URL: …, ENDER_API_KEY: … } }` as `schema()`'s second argument)
- Modify: `world/spacetimedb/src/index.ts` (extract the bodies of `submitDecision`/`failDecision` into `applyDecision` and `failRequest`; the reducers keep their worker checks and call them; `brainTick` sets `brain` and schedules `think_job`)
- Create: `world/spacetimedb/src/brain/think.ts` (`defineThink(spacetimedb, deps)` → `{ think }`, the pattern `defineDeskReducers` uses)
- Test: `world/spacetimedb/src/world.test.ts`

**Interfaces:**
- Consumes: Task 1's `buildModelCall`, `decisionFromResponse`, `DATABASE_PROVIDERS`, `splitModelId`.
- Produces:
  - `runBrains(ctx: Ctx): 'database' | 'harness'` (reads meta `run` JSON field `brains`; anything else is `'harness'`)
  - `applyDecision(ctx: Ctx, req: DecisionRequest, action: string, thought: string, latencyMs: number): void` (today's `submitDecision` body after the worker check; also writes `agent.lastLatencyMs = latencyMs`)
  - `failRequest(ctx: Ctx, req: DecisionRequest, error: string, latencyMs: number): void` (today's `failDecision` body)
  - `settleThought(ctx: Ctx, requestId: bigint, result: { decision: Decision } | { error: string }, latencyMs: number): boolean` (returns `false` and changes nothing when the request is missing or not `pending`; otherwise calls `applyDecision` with `JSON.stringify(decision.action)` or `failRequest`)
  - exported procedure `think` scheduled by `think_job`: in a transaction read the request (stop if not pending), the survivor's name, meta `tools`, meta `run.systemPrompt`; `buildModelCall(req.modelId, { agentName, observation: JSON.parse(req.observation), tools, system }, name => ctx.env.get(name) ?? undefined)`; outside any transaction `ctx.http.fetch(call.url, { method: 'POST', headers: { 'content-type': 'application/json', ...call.headers }, body: JSON.stringify(call.body), timeout: TimeDuration.fromMillis(25_000) })`; then `settleThought` in a transaction with latency = settle timestamp minus procedure start. Any thrown error (build, fetch, parse) settles as `{ error: message }`.

- [ ] **Step 1: Write failing tests in `world.test.ts`**
  - `a database run routes a supported survivor's request to the database brain`: with meta `run` `{"brains":"database",…}` and a survivor on `bitdeer:m`, after `brainTick` the new request has `brain === 'database'` and one `think_job` row carries its id.
  - `a harness run leaves requests to the harness`: same with meta `run` lacking `brains`: `brain === 'harness'`, no `think_job`.
  - `settleThought ignores a request that is no longer pending` (expired request → returns false, request and agent unchanged).
  - `settleThought applies a decision and records latency`: pending request + `{ decision: { action: { name: 'idle', args: {} }, thought: 'rest' } }`, latency 812 → request `done`, `agent.thought === 'rest'`, `agent.lastLatencyMs === 812`, `agent.pendingRequestId === 0n`.
  - `settleThought records a failure in model_health`: `{ error: 'bitdeer models need BITDEER_API_KEY' }` → request `failed`, `model_health.lastError` equals it.

- [ ] **Step 2: Run them and see them fail**
  Run: `cd world/spacetimedb && npx vitest run src/world.test.ts -t "database|settleThought"`
  Expected: FAIL (`brain` column / `settleThought` undefined).

- [ ] **Step 3: Implement schema additions, the extraction, routing in `brainTick`, and `think.ts`**

- [ ] **Step 4: Run all module tests and publish locally**
  Run: `cd world && npm run test:module && PATH="$HOME/.local/bin:$PATH" spacetime publish endersbench-deepseek --module-path spacetimedb --server local --yes`
  Expected: all pass; publish says `Updated database` (no reset needed).

- [ ] **Step 5: Commit** — subject `Brains in the database: a scheduled think procedure answers decision requests`.

### Task 3: `beginRun` starts a database-brained run

**Files:**
- Modify: `world/spacetimedb/src/index.ts` (extract `resetExperiment`'s body into `resetWorld(ctx: Ctx, roster: { name: string; modelId: string }[])`; `resetExperiment` passes the current LLM survivors; add reducer `beginRun`)
- Test: `world/spacetimedb/src/world.test.ts`

**Interfaces:**
- Consumes: Task 1 `systemPrompt`, `promptVersion`, `DATABASE_PROVIDERS`, `splitModelId`.
- Produces: reducer `beginRun({ roster: t.array(t.object('RosterEntry', { name: t.string(), modelId: t.string() })), promptVariant: t.string(), foodScale: t.f64(), roleOffset: t.u8(), rescueSeats: t.u8(), timeScale: t.f64() })`, admin or worker only. It validates every `modelId` provider is in `DATABASE_PROVIDERS` (`SenderError` naming the bad id and the allowed providers) and the prompt variant (`SenderError` with `systemPrompt`'s message), applies food/role/seats to the world, calls `resetWorld` with exactly the given roster, clamps and sets `timeScale` as `setTimeScale` does, ensures the clock is running, and writes meta `run` as `{ promptVariant, promptVersion, systemPrompt, roster, timeScale, foodScale, roleOffset, rescueSeats, startedAt, brains: 'database' }` (`startedAt` ISO from `ctx.timestamp`), the same shape the harness's `setRunInfo` writes plus `brains`.

- [ ] **Step 1: Write failing tests**
  - `beginRun replaces the roster and starts a database run at time zero`: a world with survivors Ada, Bo and human Mason; `beginRun` with Ivy/Rook on `bitdeer:m` → exactly two LLM survivors Ivy and Rook, no humans, `world.gameTimeMs === 0`, `world.timeScale === 0.5`, meta `run.brains === 'database'`, `run.systemPrompt === systemPrompt('reward')`.
  - `beginRun refuses harness-only models`: roster with `codex:gpt-6-sol` throws mentioning `codex:gpt-6-sol`.
  - `beginRun refuses a stranger`: a non-admin, non-worker sender throws.

- [ ] **Step 2: Run them and see them fail**
  Run: `cd world/spacetimedb && npx vitest run src/world.test.ts -t beginRun`
  Expected: FAIL (`beginRun` not exported).

- [ ] **Step 3: Implement `resetWorld` and `beginRun`**

- [ ] **Step 4: Run all module tests**
  Run: `cd world && npm run test:module`
  Expected: all pass.

- [ ] **Step 5: Commit** — subject `beginRun: start a database-brained run without the harness`.

### Task 4: Harness steps aside; the viewer shows each answer's time

**Files:**
- Modify: `world/harness/main.ts` (`route(req)` returns early when `req.brain === 'database'`)
- Regenerate: `world/src/module_bindings` (`npm run spacetime:generate`)
- Modify: `world/src/frontend/data.ts` (`agentStatus`)
- Test: `world/src/frontend/studio-data.test.ts`

**Interfaces:**
- Consumes: Task 2's `decision_request.brain` and `agent.lastLatencyMs` columns.
- Produces: `agentStatus(agent)` returns `'Died'`, `'Thinking'`, or the current status followed by ` · 1.1 s` when `lastLatencyMs > 0` (one decimal, seconds), e.g. `'gather · 1.1 s'`, `'Observing · 0.8 s'`.

- [ ] **Step 1: Write failing tests**: `agentStatus` gives `'gather · 1.1 s'` for `intentKind 'gather'`, `lastLatencyMs 1138`; `'Thinking'` while `pendingRequestId !== 0n` regardless of latency; `'Observing'` when `lastLatencyMs === 0`.
- [ ] **Step 2: Run and see them fail**: `cd world && npx vitest run src/frontend/studio-data.test.ts` → FAIL.
- [ ] **Step 3: Regenerate bindings, implement `agentStatus`, add the harness skip.**
- [ ] **Step 4: Run viewer and harness tests and type checks**: `cd world && npx vitest run && npx tsc -b` → pass (the two pre-existing errors in `harness/finance/desk.ts:48` and `harness/finance/live.ts:33` are not this task's).
- [ ] **Step 5: Commit** — subject `The harness leaves database-brained requests alone; the studio shows answer times`.

### Task 5: Keys, a run script, and a live smoke run on every provider

**Files:**
- Create: `world/scripts/load-model-keys.sh` (usage `scripts/load-model-keys.sh <db> [local|maincloud]`: reads only the six declared names from the repo's `.env`, exports them, runs `spacetime publish <db> --module-path spacetimedb --server <server> --env-only --yes`; prints which names were set, never values)
- Create: `world/scripts/db-run.sh` (usage `scripts/db-run.sh <db> <modelId>[,<modelId>…] [promptVariant] [food] [timeScale]`: builds the record and report bundles as `scripts/experiment.sh` does, calls `begin_run` with Ivy, Rook, Sage, Wren cycling over the given models, starts `dist-harness/record.js`, polls like `scripts/experiment.sh` until the rescue resolves or every LLM survivor is dead (count `kind = 'llm'` only, so a human player cannot hold a run open), writes the report with `dist-harness/report.js`, stops the recorder; logs under `runs/_logs/<stamp>/`)
- Modify: `world/spacetimedb/src/brain/protocol.ts` only if the smoke run shows a provider needs a different token field or reasoning setting (record why in a comment, as for `bitdeer`)
- Modify: `world/README.md` (a "Database brains" section: load keys, run `db-run.sh`, which providers work, Codex stays on the harness)

- [ ] **Step 1: The user runs `scripts/load-model-keys.sh endersbench-deepseek local`** (it reads `.env`). Expected: it lists the names it set.
- [ ] **Step 2: Mixed-provider smoke run.** Pick an OpenAI chat model from `GET /v1/models` and a current Claude model id. Run `scripts/db-run.sh endersbench-deepseek bitdeer:deepseek-ai/DeepSeek-V4.1-Flash,openai:<model>,anthropic:<model>,ender:ender 1 reward 0.5` with no harness process running. Expected after two game minutes: `SELECT * FROM model_health` shows `answered > 10` for each model and `failingInARow` 0; `ps` shows no `dist-harness/main.js`.
- [ ] **Step 3: Fix any provider that fails** by adjusting its `PROVIDERS` entry (for example `max_completion_tokens`, or a reasoning setting) with a test in `protocol.test.ts`, republish, rerun Step 2.
- [ ] **Step 4: A full DeepSeek run.** `scripts/db-run.sh endersbench-deepseek bitdeer:deepseek-ai/DeepSeek-V4.1-Flash` → a report whose meta shows `brains: database`, `noAnswerRate` under 5%.
- [ ] **Step 5: Commit** — subject `Database brains: key loading, a run script, and every provider smoke-tested`.
