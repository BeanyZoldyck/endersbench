# Automatic benchmark recordings

## Result
New benchmark workers capture replay state every 500ms plus transient events. Completed runs and failed runs with captured frames finalize to compressed replays and appear automatically in Run history. Archives and jobs live under ignored `world/runs/<uuid>/`, survive service restart, and open through UUID replay URLs. History merges these with the seven bundled recordings and refreshes every 15 seconds or on manual refresh. Choose a model remains unchanged.

## Implementation
Backend: `harness/benchmark/recording.ts` appends delta frames/events to a journal, ignoring a torn final line during recovery. `store.ts` atomically writes job and recording metadata and compressed replays. `worker.ts` captures renderer tables and stops on parent IPC disconnect with a local hard deadline; `worker-lifecycle.ts` tracks PID with Linux boot/start identity so recovery waits for the writer to exit. `executor.ts` enables IPC and saves ownership. `service.ts` persists job state independently of archive errors. `http.ts` serves local-only history and replay endpoints; `server.ts` binds the store. Existing origin/host checks remain.

Frontend: API metadata validation, merged ordering/filtering, explicit partial status, polling/refresh/error state, UUID replay routing, exact metadata labels, reloadable URLs, and provisional outcome labels for partial or unavailable metadata. Invalid IDs do not fall back to an unrelated replay. Native browser Back retains prior behavior; the in-app Run history return and reload/deep-link behavior are verified.

## Verification
Production frontend and backend bundles built; backend strict TypeScript passed. Tests cover completion, failure, restart, torn journals, corrupt journals retaining valid jobs, worker identity/recovery locking, crash-between-metadata/status reconciliation, gzip playback parsing, HTTP persistence/restart, and path/origin restrictions. Frontend adds 21 regression tests. Mocked browser verification covers merged history, exact UUID replay fetch, reload, return to archive, partial labels, and retaining loaded recordings during an outage. Existing browser device emulation covers responsive archive layout. No paid/provider-backed benchmark was started as a test.

## Activation
User explicitly authorized restarting with existing `.env.benchmark`; service loaded the file without displaying it. Preserved four preexisting job records from the old in-memory service, then restarted the local runner. Real history API and Vite proxy return successfully and the browser shows automatic-save availability. Runner readiness is true; only ChatGPT is currently configured as available. Other model recording support is implemented but model setup is separate.

Old job reports without time-series capture cannot be retroactively converted to replays. The current live archive initially has zero newly recorded sessions; the seven bundled recordings remain. New runs will populate it. Journal + compressed replay are both retained; long-term retention/disk quotas are not implemented. No commits or remote deployment.

## Review / coordination
Frontend delegated to Sol high; independent backend review to Astra high. Root inspected changes and browser behavior. Accepted units: frontend archive integration and backend capture/persistence integration. Review found orphan-worker ownership, archive-error job loss, and interrupted completion-label mismatch; repaired in one review cycle, plus bounded parent-disconnect exit. Account-wide usage observation: 75% to 77% of the same 10080-minute window (reset 1793424641); other account activity prevents per-task attribution. A late clock sample covers only 02:26:38–02:30:29 UTC, not total task elapsed time. No comparative performance claim.
