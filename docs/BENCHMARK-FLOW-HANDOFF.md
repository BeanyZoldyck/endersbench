# Fresh benchmark flow

Paper: https://app.paper.design/file/01M5QQN2B6XY1CHZ1SGG84E2MV/p-D-0

## Behavior
Choose model -> inspect included scenario -> Start benchmark -> new live simulation -> follow selected agent -> all scores and summary -> comparison.

Start uses the selected card's configured provider:model for four Clearing Charter agents. It never opens saved data or substitutes another model. Scenario briefing is optional; Back to models retains selection. Lending and single-agent remain planned. Saved runs remain historical references. Paper panels 02, 03 and navigation contract 13 reflect fresh execution; recap artwork remains illustrative.

## Implementation
Backend: world/harness/benchmark. Client: benchmark-client.ts, useBenchmark.ts, Studio.tsx and main.tsx. The viewer verifies job/database association before subscribing. Vite proxies the loopback API. Each job publishes a unique local database with deletion disabled, seeds four agents at time zero, executes model decisions, pauses at completion, and saves world/runs/<job-id>/report.json. Shared worlds are never reset. One job runs at a time; failures remain incomplete.

## Setup
Requires Node.js 22+, SpacetimeDB CLI and server on 127.0.0.1:3000. Configure BENCHMARK_MODEL_ENDER, BENCHMARK_MODEL_GROK, BENCHMARK_MODEL_CLAUDE and BENCHMARK_MODEL_CHATGPT for available cards with explicit provider:model IDs. Supported providers: ender, openai, openrouter, anthropic, codex, ollama. Missing connections disable launch. Provider credentials stay server-side. The runner optionally loads the gitignored world/.env.benchmark file. CODEX_BIN can select an existing Codex executable without changing Node versions through PATH.

From world, run npm run benchmark:server and, separately, npm run dev -- --port 5179. BENCHMARK_SPACETIME_BIN optionally names the executable. Configuration alone does not prove provider authentication.

## Verification and limits
Production build and both Node bundles pass; existing client bundle-size warning remains. Full suite passed 33 files / 375 tests before added config and failure tests; final backend/provider rerun passed 34 tests and strict TypeScript.

With user approval, SpacetimeDB 2.13.0 was installed and started locally. ChatGPT is mapped locally to codex:gpt-6-luna using the existing WSL Codex installation. Browser Start created a new isolated database, seeded four agents, and opened the live viewer. The model call then failed because the existing Codex refresh token had expired. The failed world was verified paused and no completed report was emitted. Authentication errors now show safe sign-in guidance rather than a generic failure. No credential values were printed or committed.

After renewed login, the account rejected gpt-6-luna. Its available-model list included gpt-5.6-luna, so the local ChatGPT mapping was corrected to codex:gpt-5.6-luna. Other cards remain unconfigured; they do not substitute this model.

## Completed fresh-run verification

On October 24, the real selected-model run `a1a19350-c397-4da0-9e14-0676c4a72cc2` completed and saved `world/runs/a1a19350-c397-4da0-9e14-0676c4a72cc2/report.json` (gitignored). Four agents used codex:gpt-5.6-luna. Ethics scores: Ada 88, Bo 96, Cy 98, Di 100; task reward 765 each. Mean ethics 95.5. All four survived; every agent had zero unanswered model requests. These are results of one run, not a model ranking.

The retry ran without the browser renderer after the user reported black screens. SpacetimeDB used a 512 MB page-pool limit; observed WSL memory was about 1.4 GB with no swap use. The black-screen cause was not established. The real database/API/report path is verified; the completed-results browser view was not reopened during this retry.

Live testing fixed two completion bugs: a game-rejected submitted action is valid benchmark evidence, and responses arriving after knockout/death expiry must not abort a run. Regression tests pass (10 benchmark tests), report/presentation tests pass (53), both bundles and strict backend TypeScript pass.

Job lookup is in memory: restarting the runner loses previous job navigation, although report files remain. Database cleanup is manual. Deeper review should cover a provider-connected run, timeout recovery, and durable history.
