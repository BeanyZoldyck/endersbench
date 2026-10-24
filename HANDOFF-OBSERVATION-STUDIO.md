# Observation Studio handoff

Latest selected restoration: playback scrubber/speeds/provenance and exhibit tour, event spotlight/narration, click-to-focus and camera reset, and table-derived current-run Results. No item-color legend. Final 289 tests and production build pass; live runtime remains pending teammate's unpushed backend. See PLAYBACK-RESULTS-HANDOFF.md for implementation and verification evidence.

## Latest clarification and follow-up audit
Tim clarified that his teammate's current schema runs locally and has not been pushed. Leave backend/schema/bindings unchanged; live integration remains pending that code. The subsequent button audit corrected frontend-only routing, replay timestamps, agent-specific evidence and unavailable controls. Final checks now pass 275 tests and the production build. See BUTTON-AUDIT.md for all control destinations and limits.

## Outcome
Implemented the final Figma Observation Studio in an isolated worktree on `codex/observation-studio`, based on the fast-forward pull of teammate changes at `eb6ac2b`. The main checkout remains separate. No commit, push, deployment, or live database mutation was performed.

The landing, setup, briefing, monitor, agent follow, outcome, comparison/history, context, method, single-agent and Lending preview screens use the final design's typography, palette, spacing and navigation. Every simulation viewport uses the repository's existing `WorldScene` and recorded/live world data. Concept scene images and animal avatars are not used. Model marks are centralized placeholders until Tim supplies logos.

## Organization
- `world/src/frontend/ui-ux/Studio.tsx`: presentation and screen composition.
- `world/src/frontend/studio.css`: scoped responsive presentation styles.
- `world/src/frontend/model.ts`: pure navigation, draft and replay state transitions.
- `world/src/frontend/data.ts`: packaged recording catalog, evidence and scoring adapters.
- `world/src/frontend/source.ts`: recorded replay and current-world subscription adapters.
- `world/src/frontend/studio-navigation.test.ts`, `studio-data.test.ts`: independent regression verifiers.
- `world/public/studio/`: small Figma control SVG assets and provenance manifest.
- `world/src/main.tsx`, `world/index.html`: entry wiring and page metadata.

Existing renderer, backend, harness, generated bindings, legacy viewer and recording files retain their organization. `?legacy=1` opens the original viewer. No new dependency was added; approved `npm ci` used the existing lockfile.

## Run locally
From WSL:

```sh
cd /home/tim/projects/endersbench-observation-studio/world
npm run dev -- --host 0.0.0.0 --port 5180
```

Open `http://localhost:5180/`. The default experience uses seven real packaged Clearing recordings. The setup screen links to `/?live=1&studio=monitor` for read-only current-world observation. Existing `VITE_SPACETIMEDB_HOST` and `VITE_SPACETIMEDB_DB_NAME` configuration overrides remain supported. No real .env file or credential was inspected.

## Backend deployment mismatch
Tim explicitly chose to keep the documented Maincloud endpoint (`wss://maincloud.spacetimedb.com`, database `endersbench`) and flag its mismatch. Its public schema is older than the pulled repository bindings: deployed world has 12 fields versus 20 locally, agent 28 versus 41, and score 7 versus 12; current structure/mob/hazard/memory tables are missing. The SDK subscription fails deserialization (`BinaryReader.readF64`, DataView bounds). Local port 3000 was unavailable.

The UI reports connecting/unavailable state and offers saved-reference fallback. Successful live observation against a compatible deployment is **not verified**. The backend owner needs to align the deployed module and bindings before that check can pass. Do not downgrade current bindings or deploy without authorization.

The browser has no model-harness launch API, and the backend has no subscribed Lending records. Model choices are drafts, cross-model comparisons explicitly show missing records, and Lending/single-agent flows are labeled planned. Saved runs retain actual GPT-6-Luna identity and policy condition; selecting a draft never relabels their evidence. Missing ethics exposure stays unassessed instead of becoming a zero score.

## Verification
- Baseline: 204 frontend/harness tests passed; 323 backend module tests passed; production build passed.
- Integrated implementation: 261 frontend/harness tests passed across 24 files, including 41 navigation and 16 recording-contract cases. Production TypeScript/Vite build passed. Existing large-bundle warning remains; no performance improvement is claimed.
- The backend/module code is unchanged, so the passing 323 module checks were reused rather than repeated.
- Browser: real WebGL simulation rendered; replay Stop moved to 00:04, Next to 00:22, Play advanced to 00:24 and Pause stopped it. Switching to the rescue recording selected 15:20. Agent switching and nested Context → Method → Back preserve selection and time; tests cover exact 135123 ms restoration. Qwen single-agent draft survives preview return. Lending filter shows no records. Desktop 1440 px and mobile 390 px layouts have no horizontal overflow.
- Independent integration review examined route/state boundaries, recording evidence, scoring, subscription readiness and failure paths. Review findings were corrected, including future-event leakage, incorrect event context, stale run time and live historical selection. Final Back-to-models correction and final build evidence are appended to LOOP.md.

## Loop and remaining review
Four acceptance units were defined before implementation in LOOP.md. The supervised loop used baseline, state/contract, browser/integration and final regression passes, with focused corrections and independent verifiers owned outside the implementation worker. Live service success is excluded from verified acceptance because of the confirmed external schema mismatch, which Tim accepted as a flagged limitation.

The measured orchestration interval began at 22:11:56 UTC and reached final browser review at 22:28:14 UTC (16m18s); setup before the baseline and final closeout are excluded. Account-wide weekly usage moved from 40% to 46%; this cannot be attributed exactly to this task and does not establish an efficiency improvement.

Future supplied logos can replace the centralized model marks. No additional package or secret approval is needed for the completed local work.
