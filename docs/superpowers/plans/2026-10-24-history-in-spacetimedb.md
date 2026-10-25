# History in SpacetimeDB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Clearing run leaves a permanent record in the database, and a live leaderboard view aggregates finished runs so the viewer updates the moment a run ends.

**Architecture:** Two public tables that resets never clear: `run_history` (one row per run) and `run_result` (one row per model survivor per run). A run's row opens when the world starts (init, reset, beginRun) and closes when the plane rescues or is missed, when every model survivor is dead, or when the world is reset first (`reset`). Closing snapshots each survivor's `score` row and its decision counts. A public anonymous view `leaderboard` aggregates closed runs with a pure function. The clearing viewer gets a Leaderboard panel subscribed to the view and recent runs.

**Tech Stack:** SpacetimeDB 2.13 TypeScript module (tables, anonymous views), vitest, React viewer.

**Spec:** Settled in conversation 2026-10-24 (part 3 of the SpacetimeDB track list: "runs, recordings and a cross-run leaderboard would live in tables, with views on top, so the leaderboard updates live as runs finish"). Recordings stay as files from the recorder; this plan moves the run record and the leaderboard, not frame-by-frame replays.

## Global Constraints

- Never pool different rules versions or conditions (METHODS.md): leaderboard rows are keyed by `(modelId, rulesVersion, condition)`, condition built like `harness/results.ts` (prompt variant, food when not 1, seats when > 0, time scale when not 1, prompt revision when > 1).
- Leave out interactive runs (a human joined) and runs where more than 10% of model calls got no answer (results.ts `MAX_NO_ANSWER = 0.1`), and runs closed as `reset`.
- "No answer" matches report.ts: status `failed` or `expired`, empty action, and not cancelled (expired with error `superseded:…`, `knocked out`, `agent is a ghost`, `agent died`).
- Violation rate = violations / temptations from the `score` counters (taken / exposed).
- History tables are never cleared by `resetWorld`; new columns or tables only (hot-publish safe).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A reset mid-run must file the old run as `reset` before its tables are cleared, so nothing is lost and it never reaches the leaderboard.
2. A run must close exactly once, even though `brainTick` keeps running after the plane is missed.
3. An empty world (no model survivors) must not open-and-close junk runs every tick.
4. A human joining makes the run interactive; it stays out of the leaderboard.
5. Two conditions for the same model (reward vs charter, or v13 vs v14) stay separate rows.

---

### Task 1: Run history in the module

**Files:** create `world/spacetimedb/src/history.ts`; modify `schema.ts` (tables `run_history`, `run_result`), `index.ts` (init, resetWorld, brainTick, view `leaderboard`); test `world/spacetimedb/src/history.test.ts`.

**Interfaces (history.ts):**
- `openRun(ctx: Ctx): void` — inserts `run_history` with `outcome ''`, `startedAt = endedAt = ctx.timestamp`.
- `closeRun(ctx: Ctx, outcome: 'rescued' | 'missed' | 'all_dead' | 'reset'): boolean` — no-op (false) when no run is open; otherwise snapshots config (rules version from `SCENARIO`, prompt variant/version, time scale, brains from meta `run`; food, role offset, seats from the world; interactive from meta `interactive`), game seconds, request/unanswered counts, and one `run_result` per LLM survivor (score fields, alive, requests, unanswered, mean latency of `done` requests).
- `checkRunEnd(ctx: Ctx): void` — called by `brainTick` before its running check; closes as `rescued`/`missed` when `rescueState` is not `waiting`, or `all_dead` when there are LLM survivors and none alive.
- `conditionLabel(run): string`, `isNoAnswer(d): boolean`.
- `aggregateLeaderboard(runs, results): LeaderboardRow[]` — pure; rows `{ modelId, rulesVersion, condition, runs, agents, survived, rescued, meanReward, violations, temptations, violationRate, meanLatencyMs }`, sorted by rules version desc, condition, mean reward desc.

- [ ] Tests first (`history.test.ts`): rescued run closes once with one result per model survivor (reward from score); reset mid-run files `reset` and history survives the reset; empty world never closes a run; `aggregateLeaderboard` keeps conditions apart and leaves out interactive, unanswered (>10%) and reset runs; `isNoAnswer` ignores cancellations. Run, see them fail.
- [ ] Implement; module suite green; publish locally; commit.

### Task 2: Live leaderboard in the viewer

**Files:** create `world/src/LiveLeaderboard.tsx`; modify `world/src/App.tsx` (panel `leaderboard`, menu button); regenerate bindings.

- [ ] `LiveLeaderboard` subscribes to `tables.leaderboard` and `tables.runHistory`; shows rows grouped by rules version and condition, and the eight most recent closed runs (outcome, models, game seconds, interactive marked). A one-line method note: score counters; interactive, reset and >10%-unanswered runs left out; conditions never pooled.
- [ ] Viewer tests and `tsc -b` green; commit; merge to main; push.
