# Model catalog and artwork update

## Outcome
Eight exact model choices share one UI/runner/history catalog. Legacy records keep their original identity. The hero, Clearing, and Ledger scenes now show Ender, DeepSeek, Claude, and ChatGPT. DeepSeek has its whale emblem beside the eye on the outer side of its head, following the requested correction.

## Generated assets and prompt set
Built-in image generation was used, with the previous illustrations as edit references. Final project assets:
- `world/public/studio/benchmark-buddies-deepseek.png`: preserve the low-poly forest berry-sharing hero, all framing and other characters; replace only gray Grok with pale-blue DeepSeek, navy scarf, blue whale. Correction: move the small whale to the outer viewer-right temple, leaving the central face clear.
- `world/public/studio/clearing-deepseek.png`: preserve the wide forest/table scene, replace only the second mascot with pale-blue DeepSeek and navy scarf, blue whale on its side. Preserve Ender, Claude, ChatGPT, bowls and pose.
- `world/public/studio/ledger-deepseek.png`: preserve the wide office scene; replace second mascot on telephone with pale-blue DeepSeek, navy suit and blue tie, small whale on outer viewer-right temple. Preserve other three characters and office layout.
- `world/public/studio/avatars/deepseek.png`: isolated matching pale-blue mascot with navy scarf, small whale at outer right side of head, full body, no scenery; final edit removes background and floor shadow with transparent alpha.
- `world/public/studio/avatars/glm.png`: isolated ivory low-poly round mascot, violet scarf, small geometric Z at outer right temple, full body; final edit removes background and floor shadow with transparent alpha.

No version numbers are baked into the illustrations. Exact variants remain text labels in the application. Earlier assets remain available for historical references.

## Verification
- Worker: 564 tests across 60 files passed, frontend production build and benchmark server/worker build passed.
- Coordinator: reviewed shared catalog, exact history filtering, configuration and regression tests; diff whitespace checks passed.
- Browser: all eight setup choices and their avatar images loaded, updated hero/clearing art visible, exact history filters displayed. Selecting GPT-6 Sol correctly showed no recordings rather than the existing Luna runs.
- Local runner restarted with user-authorized existing configuration, without interrupting active jobs or starting model calls. Configuration reports eight entries. The existing environment has no mappings for these new variants, and local SpacetimeDB on port 3000 is offline. Real launches remain blocked honestly. See `world/harness/benchmark/MODELS.md` for connection setup.

## Orchestration
One Sol worker owned model selection, runner configuration, history and regression tests while the coordinator owned generated assets and browser acceptance. Two change units: catalog/flow and artwork integration. One coordinator correction covered custom Ender checkpoint IDs. Start measurement at 2026-10-25 05:26:45 UTC; allowance baseline 8% of the 10080-minute Codex window. Account-wide counters cannot establish task-specific cost or workflow superiority.

Measured interval ended 2026-10-25 05:33:46 UTC (7m 1s). Both code/artwork units accepted locally; real launch configuration remains an explicit external prerequisite. Observed account-wide usage increased 8% to 10% in the same window, a 2 percentage-point delta; concurrent activity unknown, not a task-specific cost.

## Avatar color revision
User requested colorful small avatars matching Qwen, Claude and GPT while leaving larger scenes muted. Replaced only avatars/deepseek.png and avatars/glm.png using built-in image generation with Qwen and Claude as references. Prompt: match compact egg body, small oval eyes, tiny brown feet, tan satchel, faceted low-poly material, golden rim light and three-quarter pose. DeepSeek: saturated sky/cobalt blue body, royal-blue scarf, cream whale on side scarf flap. GLM: saturated turquoise body, jade-teal scarf, cream geometric Z on side flap. Both genuinely transparent, no scenery, no white hands. Verified large-scene hashes unchanged.
