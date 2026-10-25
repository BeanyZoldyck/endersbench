# Run history

Replaced the previous Benchmark results screen with a model-filterable archive while preserving Choose a model. Internal `studio=compare` route remains compatible with existing links. Header and results-navigation labels now point to Run history. Opening a recording uses the existing recorded-source navigation at replay time zero. History filtering is independent of the model setup selection and survives replay navigation.

Files: `world/src/frontend/ui-ux/RunHistory.tsx`, `run-history.css`, `run-history.ts`, `recording-metadata.json`; integration changes in `ui-ux/Studio.tsx` and `model.ts`; coverage in `run-history.test.ts` and `studio-catalog.test.ts`. Other existing modifications are unrelated concurrent work and were preserved.

Seven packaged Clearing recordings are available, all ChatGPT / codex:gpt-6-luna. Dates and durations were extracted from those recordings and are checked against the replay files by the catalog tests. Sort is newest first; dates display in the browser timezone. Other models show truthful empty states. This archive does not automatically persist or import new runner sessions; the page makes that limitation clear. No outcome is inferred from a recording title or from its duration.

Verification: production build passed (existing large-chunk warning); all 386 tests across 37 files passed. Chromium verified all model filters, empty-state recovery, opening two distinct recordings, retained filter, unchanged model overview, mobile layout without horizontal overflow, and zero page errors. Desktop and mobile screenshots visually reviewed. No package installations, secret access, deployment, or commit performed.

## Automatic-save update
The earlier packaged-only limitation is superseded by `AUTOMATIC-RECORDING-HANDOFF.md`: new benchmark sessions now record automatically and persist on disk. The local runner was restarted with user authorization, and the real history endpoint verified.
