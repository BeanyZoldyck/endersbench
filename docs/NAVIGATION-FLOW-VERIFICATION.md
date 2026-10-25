# Navigation and continuation verification

## Outcome
Start/Continue is integrated into the existing dashboard action. Active runs do not produce a separate history panel. Leaving a preparing run does not force the user back into its viewer. Existing viewer headers contain compact run status and one Back to dashboard link; old Studio menu links explicitly target `?studio=landing`.

## Checks
- `npm run build`: passed (existing chunk-size advisory).
- `npx vitest run --maxWorkers=2`: 59 files, 540 tests passed.
- Added 16 regression cases covering disabled launch while checking, mixed lineup/back preservation, actual launch request payload, viewer identity, terminal status, and Continue despite draft blockers.
- Browser: isolated Vite 5185 + fixture runner 8795; no paid model launches. Two simulated POSTs total: one preparing run abandoned to history, one automatic setup-to-viewer transition. Each retained the same job and database identity through Continue.
- Verified preparing -> running while away stays on history, Continue -> viewer -> dashboard, completed/failed -> Start, offline -> setup -> Retry -> recovered Start.
- Verified chart tabs, Methods/Back, mixed lineup/details/Back, Clearing/Ledger selection images, recorded run -> scores -> evidence -> Back, Ledger Offices/Reports/Results and dashboard return.
- Existing completed database was referenced only for viewer routing; fixture lifecycle is UI verification, not evidence of a fresh end-to-end model run. Ledger reports/results used a packaged replay.

## Implementation
Continuation and polling: `ActiveBenchmarks.tsx`, `useBenchmark.ts`, `Studio.tsx`, `BenchmarkLobby.tsx`. Header status: `BenchmarkRunStatus.tsx`, viewer components and entrypoints, viewer CSS. Tests: `active-benchmarks.test.ts`, `benchmark-lobby-render.test.ts`, `navigation-flow.test.ts`.

## Orchestration
Two bounded Sol workers: independent read-only flow review and test implementation. Coordinator integrated findings and performed browser acceptance. Both assignments accepted; one review correction addressed offline setup navigation. No timing or account-usage attribution measured, and no orchestration performance claim is made. Module code was unchanged; prior module verification was not rerun. No publishing in this task.
