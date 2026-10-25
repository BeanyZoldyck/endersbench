# Model picker observations and full-width header

Outcome: the model picker now includes two accessible bar charts from the inspected published Clearing baseline; the header spans the viewport while retaining content gutters.

Files: world/src/frontend/ui-ux/ObservedComparison.tsx (new); world/src/frontend/ui-ux/Studio.tsx (integration and setup heading); world/src/frontend/studio-responsive.css (charts and header); world/public/studio/observed-baseline.md (source snapshot).

Evidence: results/latest/RESULTS.md, Primary comparison. Exact model codex:gpt-6-luna, rules v8, food 1x, unlimited seats, time 0.5x, seven runs in each prompt condition. Excess rations: reward-only 54, charter 42. Runs rescued: 4/7 each. These are same-model condition comparisons, not a cross-model leaderboard or general intelligence measurement. No matched Ender/Grok/Claude data was available in this checkout; absent data is explicitly marked. The source is a static historical snapshot, not a live results feed.

Checks: npm run build passed (bundle-size advisory only); git diff --check passed; Playwright tested landing Choose a model navigation, all four selection states, source report availability, viewport-wide header and no horizontal overflow at 390, 1440 and 2560 pixels. Desktop screenshot inspected. Impeccable detector returned no findings. React review: typed props, stable row keys, no new hooks or dependencies, semantic chart captions and readable numeric values, collapsible provenance table with scoped headings.

No new benchmark runs, credential access, dependency installation, deployment or Git commit. Existing unrelated edits preserved. Future review: connect matched, versioned multi-model results before enabling rankings; do not attribute historical GPT-6-Luna data to the configured model (currently may differ).

## Follow-up: separate model discovery from launch

Choose a model now routes to `?studio=models`, with all four models in two graphs, a prompt-condition toggle, and explicit missing-data rows. Start a benchmark routes to `?studio=setup`, with compact selection, the actual Clearing-only runner scope, and one launch action. Selection persists when moving between these screens. Header branding and labels are identical across screens: Ender’s Bench, Benchmark results, Choose a model, Start a benchmark.

Additional files: world/src/frontend/model.ts plus studio-navigation.test.ts and studio-source-routing.test.ts for the new route. Updated Studio.tsx, ObservedComparison.tsx and studio-responsive.css.

Validation: 67 navigation/source-routing/benchmark-client tests passed; final production build passed (bundle advisory remains). Playwright exercised both flows, eight graph rows, condition values 54/42, selection carryover, direct models route, stable header labels, and launch payload model=Claude/scenario=clearing-charter. Launch was intercepted with a test error; no live model run. No horizontal overflow at 390, 1366 or 1440. Desktop setup fits 768px height without scrolling; mobile uses a sticky Start button and scrollable content. Fixed mascot/name overlap after screenshot inspection. Final diff whitespace check and design detector passed.
