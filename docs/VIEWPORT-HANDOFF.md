# Viewport and scrolling handoff

Outcome: preserve the existing Ender Bench content and visual layout while keeping information needed together in view and allowing supporting information to scroll.

Implementation files:
- `world/src/frontend/studio-viewport.css`: viewport-height rules, desktop inspector scrolling, sticky evidence, comparison spacing, landing sizing, short-window snap fallback.
- `world/src/frontend/ui-ux/Studio.tsx`: stylesheet import, agent selection immediately below the scene, accessible names and keyboard focus for scroll panels. Event handlers and content are preserved.

## Screen policy

| Screen | Behavior |
| --- | --- |
| Landing | Hero and illustrated scenario fit together on tested desktop viewports. Results/evidence follow their content. Short windows have no snap stops. |
| Models | Paired charts remain side by side on desktop with tighter spacing. The page and extra comparison conditions scroll normally. |
| Setup and single-agent preview | Natural page scroll; keep all choices and actions reachable. |
| Briefing | Natural page scroll for scene, goals and rules. |
| Monitor | Scene, replay, agent choices and reset fit together at 1366×768 and 1440×900. Desktop decision/conversation inspector scrolls independently. Supporting disclosures remain below. |
| Follow | Same focused desktop policy, accounting for the agent-switch row above the scene. |
| Outcome | Summary, individual scores and conversation retain natural document scrolling. |
| Lending | Illustration followed by normally scrolling explanations/disclosures. |
| Run history (`compare`) | Natural archive scrolling, existing filters retained. |
| Context | Graph/details and related events scroll normally; selected evidence stays visible in a desktop sidebar. |
| Methods | Natural reading-page scroll. |

Narrow layouts retain the existing responsive stack. No content is hidden or removed to force fit. Desktop bounds apply at widths above 1100px and heights of at least 700px; shorter/narrower windows retain natural flow. The focused-fit guarantee was checked at 1366×768 and 1440×900, not every possible window size.

## Verification

- `npm test -- --maxWorkers=2`: 416 tests across 40 files passed. Initial unconstrained run had one 5-second performance-threshold failure under concurrent browser load; the unchanged test passed with lower concurrency (2.2 seconds).
- `npm run build`: passed (TypeScript and Vite); existing large-chunk advisory remains.
- First viewport round: 84 checks, no horizontal overflow/clipped-control failures; Follow height failed at two desktop sizes and was corrected.
- Focused second-pass checks: 14 passed, covering landing chapters, monitor/follow reset visibility and sticky context evidence.
- Mechanical CSS detector: no findings.
- Final matrix: 84 checks passed, zero failures including desktop focused-fit assertions. Interaction verifier: 9 checks passed, including keyboard scrolling, mobile reachability and selection across resize.
- Integrated preview wheel check passed: inspector scroll 55px while page scroll stayed 0; scene, agents and reset stayed inside 768px viewport height.
- Detailed results are recorded in `viewport-final/matrix.json`, `viewport-interactions.json` and `viewport-integrated.json` beside this handoff.

Fixed verifier scripts were kept outside the worker-owned source. Two implementation rounds; no verifier assertions or existing tests were weakened. The incomplete baseline run hit a navigation abort and is not counted as a passing matrix. Account usage is shared; no exact task-cost attribution is claimed.

Limits: Chromium headless viewport emulation and keyboard interaction, not physical-device or Safari verification. No backend behavior, fresh benchmark execution, installation, secret access, commit, push or deployment was part of this change.
