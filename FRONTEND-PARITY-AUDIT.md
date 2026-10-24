# Old viewer versus Observation Studio

Subsequent user-selected restoration: playback scrubber/speeds/provenance, curated exhibits and optional tour; event Spotlight/narration, click-to-focus and camera reset; current-run Results derived from existing tables. Item-color legend intentionally excluded. Backend history remains deferred. See PLAYBACK-RESULTS-HANDOFF.md. The table below records the original audit, not the updated implementation status.

Read-only source audit, 2026-10-24. No feature implementation or backend changes made in this audit. Comparison baseline is the pulled repository's `world/src/App.tsx`, not the teammate's unpushed local schema.

## Verdict
The actual 3D simulation renderer is reused unchanged, but the Studio is not yet a complete feature-for-feature reskin of the old viewer. Presentation and some workflows changed, and several existing observer features were omitted. Earlier button testing verified implemented actions; it did not establish legacy feature parity.

`git diff --name-only` is empty for `world/src/scene`, `useReplay.ts`, `App.tsx`, `world/spacetimedb`, and generated bindings. Studio uses the existing WorldScene, physics parser, replay engine and state reconstruction. Terrain, critters, resources, containers, item glows, fires, shelters, wolves, storms, daylight, speech bubbles and recorded transient scene effects still use the original renderer. Camera drag/zoom and following remain, with different UI entry points. Shared renderer capability does not imply every optional effect or input is wired: see below.

## Features awaiting a decision

| ID | Old viewer capability | Studio difference | Suggested treatment |
| --- | --- | --- | --- |
| A | Agent inventory, backstory, memory list and relationship summaries | Follow shows model, role, needs, thought and a short conversation, but not inventory, backstory or MemoryPanel | Restore in an expandable agent details panel using existing recorded data |
| B | Detailed agent ethics record: detector tier, applicable policy, pressure, violations/opportunities | Basic scores and event details exist; these interpretation fields are omitted | Restore inside Context details; preserve unassessed-score handling |
| C | Winter/daylight HUD, winter and rescue countdowns, total food, named rescue/left-behind banner | World still visually changes and individual final outcomes exist; explanatory HUD is mostly absent | Restore a compact status strip |
| D | Cast-card needs meters, survival-pressure percentage, wreck allocation, hunted/pinned/dazed states | Needs numbers appear in Follow, but overview cards lose these indicators and simplified status omits several hazards | Restore concise health/pressure/allocation/status indicators |
| E | Journal of recent 40 ethics events, 60 conversations, explicit whisper labels, live world-event log | Conversation capped at 4 or 7 messages; Context shows first 30 related ethics/transfer events, without a full journal or whisper marker | Restore a filterable journal and channel labels; current limits can hide later evidence |
| F | Moments of choice: taken/resisted windows, deaths, pressure bands and replay jumps | Context includes ethics and transfers but not the opportunity/death timeline or pressure summary | Restore an evidence timeline and pressure summary from existing recordings |
| G | Replay scrubber; 1x/2x/4x/8x speed; recording database/date; arbitrary replay URL | New dock has previous/next event, play/pause and stop; accepts only its packaged recording catalog | Restore scrubber, speeds and provenance; decide whether arbitrary local recording paths are needed |
| H | Six curated exhibit links and automatic 40-second booth tour | Seven runs available and one featured exhibit; the complete exhibit sequence and tour are absent. “Plane flies past” timestamp is not separately surfaced | Restore exhibit gallery; make auto-tour optional |
| I | Spotlight overlays for violations/deaths/rescue, policy/explanation comparisons, automatic focus, narrated captions | Shared renderer remains, but Spotlight, narrator and spotlitId are not wired into Studio | Optional presentation mode; keep quieter analyst mode available |
| J | Live transfer/hit/world transient effects and provider/model-health alerts | Recorded effects are passed through; live adapter supplies `sceneMoments: []` and does not subscribe to modelHealth | Defer live wiring until teammate's current schema is pushed; do not guess contracts |
| K | Existing `/results.html` aggregate analysis | Studio Compare is a packaged-run catalog with draft model selection, not the existing aggregate report. The report includes methods, policy comparisons, uncertainty and additional model/condition records | At minimum link the existing report; restyling its contents is a separate choice. Do not treat seven replay files as all repository results |
| L | World inspector: game clock, tick, map/physics/resource counts, coordinates, reducer-action log, full condition/rules metadata | Method screen retains only a subset of run configuration; technical inspector absent | Keep an optional diagnostics drawer or leave in legacy |
| M | Human Join, speak and click-to-move; Reset experiment | Studio is observer-only, with no reducers invoked | Leave out unless explicitly wanted; defer integration until teammate's backend is available |
| N | Development art staging toggles and staged event effects | Not present in Studio | Keep legacy/developer-only; not needed for ordinary observation |
| O | Explicit Audience/Explore camera controls, glow legend, first-visit explanation | Drag/zoom and Follow exist; explicit overview camera reset, item-color legend and old onboarding text are missing or replaced by simplified briefing | Restore camera reset/legend; decide whether briefing is sufficient onboarding |

## Important distinctions
- Live observation of the teammate's current local backend remains unverified and intentionally pending their unpushed code. Do not change schema, bindings or backend integration to match the older public deployment.
- Existing legacy viewer code is retained with `?legacy=1`. However its exhibit/tour URL helpers do not preserve that parameter, so following those links can return to Studio. Retaining the file is not a substitute for integrating the missing features.
- `/results.html` and `/finance.html` still exist; the aggregate results report is part of the old viewer's navigation. Finance is a separate scripted preview, not evidence of a live Lending API.
- Draft model selection, single-agent and Lending preview are new design surfaces, not equivalent to previously working backend launch functionality. The original viewer also relies on an external harness for model runs.

## Evidence inspected
`world/src/App.tsx`, `MemoryPanel.tsx`, `MomentsRail.tsx`, `Intro.tsx`, `exhibits.ts`, `scene/WorldScene.tsx`, `public/results.html`, and Studio `frontend/ui-ux/Studio.tsx`, `source.ts`, `data.ts`, `model.ts`. This pass inspected source wiring rather than executing live mutations or repeating previously passing tests. Pending decisions are above; no missing capability has been silently added.
