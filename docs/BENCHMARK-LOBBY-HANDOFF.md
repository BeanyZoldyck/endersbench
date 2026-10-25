# Benchmark lobby handoff

## Outcome
Start Benchmark now supports per-model +/- counts, one to four agents total, and The Clearing / Ledger Street scenario selection. Start submits the chosen roster and opens the corresponding original simulation viewer. Both viewers poll runner status and expose errors, history and lobby return links.

Preserved and included the existing landing, responsive, model findings and run-history UI work. Integrated teammate main at 50516c1. Original checkout remains unchanged; implementation lives in /home/tim/projects/endersbench-lobby on codex/benchmark-lobby.

## Behavior
Clearing creates an isolated world and binds actual agent IDs to their selected models. Ledger Street runs lend-clean-approve once per slot with house rules and saved CRS snapshots. Mixed repetitions stay together in the viewer. Both archive formats survive restart and route to the appropriate replay viewer; mixed history is filterable under every participating model.

## Verification
- 505 frontend/harness tests pass across 54 files; 565 module tests pass across 10 files.
- Production frontend build and benchmark bundles pass; strict worker/server TypeScript passed. Existing large-bundle warning remains.
- Independent integration review initially found four issues: mixed history attribution, Ledger replay format/routing, viewer failure visibility, and mixed-repeat grouping. All were repaired and reviewer rechecked 67 focused tests with no residual blockers.
- Desktop browser screenshot inspected; actual +/- interactions produced 2 ChatGPT + 1 Grok + 1 Claude, enforced four-total cap and disabled launch for disconnected models.
- Mobile viewport attempt timed out. Computer Use later stopped because it could not reliably establish the active browser URL for policy enforcement. No further UI automation performed. Mobile visual and final live browser launch verification remain incomplete.
- Authorized real run 71596c4a-116f-4fac-86dc-28740746a579: one ChatGPT (codex:gpt-5.6-luna), Ledger Street, completed; 1 case / 1 passed. Saved recording verified through the actual 5179 proxy: paced JSON, lineup=true, 1 case, 5 steps, 1 verdict.
- No real mixed-provider run: only ChatGPT is configured. No new packages or deployment.

## Local runtime
User explicitly authorized loading the original world/.env.benchmark without displaying it, restarting runner and one real model check. Runner now executes this worktree on port 8790. Vite serves this worktree on existing port 5179. runs symlinks to the original archive to preserve prior sessions. No active job was interrupted.

## Review limits
Ledger is one defined lending case per slot, not the entire finance suite or live CRS. Model connections still require operator configuration. UI automated and code-level checks do not establish physical-device/mobile visual behavior.
