# Benchmark selection and playback flow

Updated October 24, 2026.

Paper source: https://app.paper.design/file/01M5QQN2B6XY1CHZ1SGG84E2MV/p-D-0

## Accepted flow

Landing -> Swarm setup -> Start benchmark -> Clearing overview -> Follow selected agent -> Scores and summary -> Next benchmark -> Compare results after the last recording.

Scenario details are optional: open them from the scenario link, then Back to models preserves the selected model. Play benchmark starts the first matching saved recording. The reference-monitor action is removed.

Setup lists every included recording and its exact model. The seven packaged Clearing recordings all use `codex:gpt-6-luna`; they appear under ChatGPT. Ender, Grok and Claude show no matching recording and cannot start. These selections never relabel another model's run. Single-agent and Lending remain planned previews. Start plays saved data, not fresh model execution.

Each recap includes all recorded agents, ethics, task reward, violations, opportunities, survival/rescue status, and a summary of outcome and assessment coverage. Partial captures and missing assessments remain explicit. Next benchmark resets agent selection and starts the next recording at time zero. Compare keeps the current run.

## Implementation

- `world/src/frontend/catalog.ts`: ordered recording catalog with verified model attribution.
- `model.ts`, `source.ts`, `data.ts`: guarded start transition and playback initialization.
- `ui-ux/Studio.tsx`, `studio.css`: setup list, optional briefing, Start/Play/Next actions, outcome summary and evidence routing.
- `presentation.ts`: summary derived from actual records without combining ethics and task reward.
- Navigation, catalog and presentation tests cover model mismatch, missing runs, mode changes, resetting playback, recording attribution and incomplete results.

Paper panels 02, 03 and 06 and navigation contract 13 were updated. Panel 06 retains explicitly illustrative artwork and sample content, while the running app uses the saved data. Paper is a design specification; the React app implements the interactions.

## Verification

- Full Vitest suite: 31 files / 370 tests passed before the final setup-return regression test; navigation rerun: 48 passed.
- Production TypeScript/Vite build passed. Existing large JavaScript chunk warning remains.
- Browser: unavailable model disables Start; scenario return preserves selection; supported Start begins playback at zero; agent 2 selection and Follow agree; recap includes all four scores and summary; Next opens The rescue at zero; last partial recording leads to comparison retaining that run.
- Browser recap evidence opens a concrete recorded event, including when playback has not reached it.
- Desktop and 390px mobile setup inspected; no horizontal overflow at mobile size.
- Paper setup, briefing, recap and route-contract screenshots inspected for fit and readable controls.
- Impeccable detector: one pre-existing sidebar accent warning at studio.css:269, outside this change.

## Limits

No fresh benchmark execution, deployment, model installation, backend mutation or new recordings. The existing model buddies and 3D renderer are preserved. The separate historical HTML concept at port 8765 is not the React app and is not updated by this branch. Local React preview runs at http://localhost:5179/?studio=setup.
