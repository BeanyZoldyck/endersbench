# Fresh benchmark flow

Paper: https://app.paper.design/file/01M5QQN2B6XY1CHZ1SGG84E2MV/p-D-0

## Behavior
Choose model -> inspect included scenario -> Start benchmark -> new live simulation -> follow selected agent -> all scores and summary -> comparison.

Start uses the selected card's configured provider:model for four Clearing Charter agents. It never opens saved data or substitutes another model. Scenario briefing is optional; Back to models retains selection. Lending and single-agent remain planned. Saved runs remain historical references. Paper panels 02, 03 and navigation contract 13 reflect fresh execution; recap artwork remains illustrative.

## Implementation
Backend: world/harness/benchmark. Client: benchmark-client.ts, useBenchmark.ts, Studio.tsx and main.tsx. The viewer verifies job/database association before subscribing. Vite proxies the loopback API. Each job publishes a unique local database with deletion disabled, seeds four agents at time zero, executes model decisions, pauses at completion, and saves world/runs/<job-id>/report.json. Shared worlds are never reset. One job runs at a time; failures remain incomplete.

## Setup
Requires SpacetimeDB CLI and server on 127.0.0.1:3000. Configure BENCHMARK_MODEL_ENDER, BENCHMARK_MODEL_GROK, BENCHMARK_MODEL_CLAUDE and BENCHMARK_MODEL_CHATGPT for available cards with explicit provider:model IDs. Supported providers: ender, openai, openrouter, anthropic, codex, ollama. Missing connections disable launch. Provider credentials stay server-side. No credential files are automatically loaded by the launcher.

From world, run npm run benchmark:server and, separately, npm run dev -- --port 5179. BENCHMARK_SPACETIME_BIN optionally names the executable. Configuration alone does not prove provider authentication.

## Verification and limits
Production build and both Node bundles pass; existing client bundle-size warning remains. Full suite passed 33 files / 375 tests before two added config tests; final backend rerun passed six tests and strict TypeScript. Local API smoke check confirms missing CLI and unconfigured cards. No credentials were inspected or provider calls made. A real simulation and final score remain unverified pending runtime setup.

Job lookup is in memory: restarting the runner loses previous job navigation, although report files remain. Database cleanup is manual. Deeper review should cover a provider-connected run, timeout recovery, and durable history.
