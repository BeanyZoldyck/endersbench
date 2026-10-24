# Restored playback, presentation and current results

User scope: restore playback and event spotlights/narration; clicking an agent focuses the camera at that agent; provide camera reset; no item-color legend. Current-run results now, backend history only after teammate pushes its contract. Do not change backend/schema/bindings.

## Implemented
- Existing replay engine exposed through a timeline scrubber, play/pause, previous/next event, stop, and 1x/2x/4x/8x speed. Recording database/date comes from replay metadata.
- Six existing curated exhibits can be opened individually or played in the optional 40-second tour. Leaving observation stops the tour so it cannot interrupt evidence/results reading.
- Existing Spotlight and narration logic consume the current simulation snapshot. Spotlight details appear below the canvas; the event can focus the audience camera. Explicit agent selection takes camera priority and shows the selected agent's location. Reset clears manual/event camera targeting and returns Follow to the overview.
- No item-color legend was added. Renderer, simulation logic and backend remain unchanged.
- Results reads current subscribed score/agent/world/metadata rows for live mode. Recorded mode reads the selected recording's end-of-capture tables and identifies that source. Names, individual model identities, ethics/reward, opportunity/violation counts, rescue/death status and condition are derived from data.
- Missing scores remain missing; ethics without opportunities is unassessed, not zero or perfect. Paused worlds and partial captures are not labeled complete. The existing static aggregate HTML report is not used as a live result feed.
- A direct current-run Results link is available from saved Results. Packaged reference files remain separate from backend history. No history endpoint or schema was invented.

## Verification and limitations
Final full suite: 289 tests in 26 files passed with `npx vitest run --maxWorkers=2`, including 10 presentation/result cases and 17 source-routing cases. Initial unrestricted full run had one existing timing assertion exceed 5 seconds under concurrent load (5.62 seconds); unchanged assertion passed at 2.16 seconds with two workers. Production TypeScript/Vite build passed; existing bundle-size warning remains.

Browser verified: selecting Sage focuses Sage and updates evidence; Reset clears focus; pointer scrubbing changes time to 08:11 and updates narration to actual starvation/food data; 4x selects and playback advances; Results displays the recording's actual four-agent scores; current Results uses `?live=1&studio=compare` and shows waiting/unavailable rather than fabricated results; opening a reference switches sources explicitly. The tour advances from exhibit 0 to exhibit 1 after 40 seconds, and opening Results disables it. At 390px all nine playback controls fit inside the scene with no horizontal page overflow. A tour-to-reference transition exposed stale URL time; the fixed adapter prioritizes explicit navigation time, and browser plus four regression tests confirm switching from v6 12:08 to admission starts at 02:25.

Live delivery of current scores cannot be verified against the teammate's unpushed local backend. The existing subscription path is retained, with no backend/schema/generated-binding changes. UI labels and curated exhibit descriptions are static interface/editorial text; result facts and world narration are data-driven.

Files: `frontend/ui-ux/Studio.tsx`, `source.ts`, `model.ts`, new `presentation.ts`, scoped `studio.css`, `studio-presentation.test.ts`, and updated source-routing verifier. No dependencies added, no deployment or live mutations, no commit or push.

## Static factual-text audit (2026-10-24)
- Replaced fixed landing evidence quote with a recorded event title/explanation. Its CTA selects that agent and seeks its actual timestamp in the selected recording.
- Agent counts now use recording rows; removed unsupported four-agent assertions from draft model presets. Model summaries include all recorded model IDs, and monitor condition reads run metadata. Exhibit count uses EXHIBITS.length.
- Removed the claim that the whole archive contains only one model and separated selected-source model coverage from Lending availability.
- Results links to the existing generated /results.html historical report, explicitly labeled a saved snapshot. Harness results-main.ts generates it from run report.json files; no history API exists in pushed code. Backend, schema, and bindings unchanged.
- Intentional static content remains: navigation, explanatory copy, curated exhibit titles/catalog labels, draft model choices, and clearly marked Lending/single-agent concept names. These have no connected live contract and are not represented as measured results.
- Verification: 289 tests across 26 files pass; TypeScript/Vite production build passes (existing large chunk warning); diff whitespace check passes; historical report HTTP 200. Browser verified data-derived agent count, evidence CTA -> Rook event at 01:18 with matching explanation, and generated report link in Results.
