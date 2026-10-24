# Observation Studio button and backend audit

Audited 2026-10-24 after the implementation handoff. Source review covers all Studio button handlers; browser checks cover the user-visible flows and corrected regressions. This is an observer UI, not a backend run launcher.

| Control group | Destination / behavior |
| --- | --- |
| Brand, Environments, Runs, Compare, Methods | Landing, model setup, run history, comparison, method details |
| Landing section links | Scroll to Scenarios, Results or Evidence |
| Landing scenario tabs / Explore | Switch preview; open setup or explicitly planned Lending |
| Model and mode choices | Edit draft; switch swarm/single preview without changing recorded model identity |
| Review scenario / demo / reference | Briefing and actual saved simulation monitor |
| Observe current simulation | Read-only documented Maincloud connection |
| Saved runs and exhibit links | Explicitly select recorded source and intended recording/time, including from live mode |
| Agent buttons / Follow / Back | Select agent, follow its camera, return to overview; inspector evidence follows selection |
| Replay previous/play/pause/stop/next | Seek recorded chronology; unavailable and boundary actions are disabled |
| Outcome and supporting events | Recorded final state and evidence; live route shows current availability/status |
| Lending agent/details controls | Clearly labeled concept details and missing-evidence state |
| Comparison filters | Clearing/all history or explicit no-Lending-records state; Clear filter restores history |
| Comparison model picker | Apply valid distinct pair or Cancel draft; duplicate pair is explained and Apply disabled |
| Context graph/details, agent and event controls | Switch evidence representation, scope agent, seek selected recorded event |
| Method example / Back | Open actual recorded exhibit; restore caller on Back |

Informational graph nodes and Lending stage labels are not buttons. World tile clicks intentionally do not issue actions in this observer UI. No Studio handler invokes a backend reducer.

## Backend verification
The public Maincloud schema was re-read and still lacks the structure, mob, hazard and memory tables expected by the current bindings. A fresh browser connection reproduces SDK row-deserialization bounds errors. Therefore the backend endpoint is configured and attempted, but compatible live data is not successfully connected. Saved simulations are real repository recordings, rendered by the existing simulation renderer.

Tim clarified that the current schema is running locally on his teammate's machine and has not been pushed. Live integration is intentionally pending that code; do not adapt the frontend bindings to the old public deployment or make backend changes to work around it. No deployment, schema change, secret access or live mutation was performed.

## Corrections and evidence
Fixed live-to-recorded routing, same-recording seek targets, selected-agent evidence alignment, duplicate comparison feedback, unloaded controls, early-replay event stepping, misleading live status/outcome labels, and the exhibit timestamp. The latter uses the first frame containing the ethics-event ID, preserving fractional timing; the exhibit target is 145597 ms. Added 13 pure route cases and one exact-evidence regression case. Full suite: 275 tests across 25 files passed. Existing backend module verification remains applicable because backend code is unchanged. Final browser and build outcomes are recorded in LOOP.md.
