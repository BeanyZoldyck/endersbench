# Ender's Bench: User Experience and Design Flow

Status: agreed UX direction, not implemented functionality.
Updated: October 24, 2026.

## Purpose and relationship to the technical spec

This document records the product-design decisions from the design discussion. It defines how users choose, observe, understand, and compare evaluations. [DESIGN_SPEC.md](DESIGN_SPEC.md) remains the reference for world mechanics, model integration, scoring, and the temptation catalog. [PRD-old.md](PRD-old.md) is superseded.

The newer UX decisions here intentionally change parts of the technical spec:
- Simulations are presented and run one at a time.
- Users observe and inspect; they do not control characters, speak to agents, or influence the world.
- No visual recording, playback timeline, or simulation replay is required for this experience.
- Scores, benchmark metadata, and structured agent context/action/outcome records are retained.
- Preset configurations replace manual model-lineup configuration for the demo.

These are design decisions, not claims that the technical spec or implementation has already been updated. The technical spec's separate recorded demo backstop remains a team delivery decision; it is not an in-app replay feature.

## Core flow

Choose a preset -> Review the scenario goal and rules -> Start simulation -> Observe and inspect agents -> Read a brief outcome -> Next simulation -> Review combined results -> Explore comparisons and agent context graphs.

There are three main destinations:
1. Selection and setup.
2. Simulation viewer, including introduction and outcome states.
3. Results and history, including comparison and context/action exploration.

A scenario may contain several agents acting simultaneously in the same world. This does not mean several different simulations run simultaneously.

## 1. Selection and setup

Use a visible, selectable card list rather than a swipe carousel. One preset is selected at a time. Selection updates the description; an explicit Start action begins the run.

Each preset should explain:
- Its name and model lineup.
- Which worlds or scenarios it includes and their order.
- Whether it is a same-model benchmark or mixed-model match.
- How many agents will participate, as defined by the scenario.
- The applicable rule/prompt variant.

The demo uses presets. Exact preset names, model versions, agent counts, and included test cases remain to be finalized. Do not invent availability or label one model the winner in advance.

Before each simulation starts, briefly explain its goal, rules, and what contributes to reward and ethics scoring. The introduction should let a first-time viewer understand the situation without reading the technical spec.

## 2. Simulation viewer

### One shared scene

Show one large simulation environment with a compact row of agent cards underneath. No simultaneous-world gallery is needed. The default camera shows the shared world and its participants.

The scene changes to suit the world while the surrounding interactions remain consistent:
- Forest: resources, ownership, agents, needs, weather, threats, and cooperation.
- Lending: firms, applicants, credit/identity checks, offers, transactions, and regulatory conditions.
- Stretch worlds reuse the interaction structure but are not assumed to ship.

The warehouse delivery mockups were exploratory illustrations, not the current scenario specification.

### Agent identity and selection

A model is the decision-making system. An agent is an individual participant using that model.

Each agent has a portrait or character, a unique name or number, a consistent color, and its model logo/badge. Repeat these identifiers on the character and its card. Color is supplementary; text and numbers distinguish agents without relying on color alone.

Several agents using the same model share its logo but retain distinct agent identities. Mixed-model matches use the appropriate logo on each agent.

Clicking an agent or its card selects and follows it, highlights the matching card, and reveals details. An Overview control returns to the shared view. Selection never changes the agent's behavior.

Do not assign the earlier illustrative Speed, Safety, Cost, and Instructions labels as fixed model motivations. Display the actual configured goal and observed behavior.

### What the user can inspect

Agent cards summarize identity, current action/status, reward, and ethics score. Selected-agent details show:
- The agent's stated/configured goal.
- What it is doing.
- A short, high-level explanation when available.
- Relevant world-specific state.
- The action or event associated with a score change.

Forest details include health, hunger, and warmth. Finance details can include capital, reserves, and the current application or offer.

Explanations describe reported intent and recorded behavior. They are not raw internal reasoning and must not be presented as verified causation solely because the model reported them.

### Communication and activity

Agents can communicate with each other. Show brief speech bubbles in the world, with speaker/recipient identities available in selected-agent details. Spectator-visible private messages must be explicitly distinguished from public speech if included; seeing a message as a spectator must not imply every agent received it.

Show a lightbulb indicator with the word Thinking while an agent is deciding. Distinguish thinking from acting, waiting on a service, and a failed response. A thinking indicator does not imply that world movement stops.

Keep updates legible and brief. Important events can receive a concise notice explaining the action and score change, without forcing a camera switch.

### View-only boundaries

Users may select agents, change camera focus, inspect messages and state, and navigate result data. They may not move agents, issue commands, join as human characters, or communicate with agents in this demo UX.

Do not add pause-and-replay controls. A live context inspector, if later added, must not be confused with simulation playback.

### Completion and failure

After each simulation, show a brief outcome before the Next simulation button:
- What happened.
- Agent reward and ethics results.
- Any incomplete or failed evaluation status.

After the final simulation, the action becomes View results.

If an agent fails to respond, show a clear error and let other agents continue where the simulation remains valid. Mark affected results incomplete, not zero. If the failure compromises the whole benchmark, mark the run incomplete and exclude it from comparable completed results.

Timeout thresholds, retry policy, and benchmark eligibility rules still need implementation definitions. The UI must not disguise a service failure as a model's ethical decision.

## 3. Results, history, and comparison

Retain results from completed evaluations and make previous runs accessible. Show:
- Model/preset identity and exact versions where known.
- World, scenario/test-suite version, seed, and prompt/rule variant.
- Completion status and scenario-level outcomes.
- Reward and ethics results.
- Exposure-normalized violation rates by tier, including exposure counts.
- Break point, cooperation, deception, and late-decision metrics when available.
- Comparable historical runs and model benchmarks.

Use clear charts plus labeled values. Do not collapse reward and ethics into a single unexplained number. Zero exposure is not proof of zero violation risk; display it as not applicable or insufficient exposure.

Same-model mirror matches support controlled leaderboard comparisons. Mixed-model league matches are labeled separately. The technical protocol specifies three seeds per scenario and reporting mean and range. A single partial/demo run must not appear as a completed multi-seed benchmark.

Users should be able to select a run, compare compatible runs, and inspect an individual agent's context and actions.

### Context and action DAG

After the full run, provide a directed acyclic graph for each agent:
Recorded context -> Action -> Observed outcome.

Selecting an agent selects its graph. Selecting a node reveals its content and related records. Distinguish context, action, and outcome visually with labels, not color alone.

Store structured observations/context, communications received, actions, outcomes, timestamps/order, and explicit relationships needed to build the graph. Scores and benchmark summaries alone cannot reconstruct it.

Edges represent recorded relationships or supplied context, not inferred access to hidden reasoning. Time/version nodes so repeated actions do not create cycles. Show missing records honestly. Scope context to what the agent actually had access to at that decision, not everything the spectator could see.

This is an inspectable record of context and behavior, not saved rendered frames or video.

## Scenario coverage reference

These are catalogs in DESIGN_SPEC.md, not claims of implemented or finalized demo coverage.

| World | Cases |
| --- | --- |
| Forest, primary | T1 unguarded chest; T2 last medkit; T3 attacking for food; T4 broken promise; T5 duplication exploit; T6 bystander rescue; T7 misdirection; T8 blocking shared water |
| Lending, secondary | F1 unauthorized account transfer; F2 identity mismatch; F3 predatory terms; F4 false reserves; F5 rate collusion; F6 discriminatory paired offers; F7 insider leak; F8 bribery |
| Spaceship, stretch | Airlock abandonment; hidden oxygen reserves; false repair logs |
| Optional vignettes | Food request; flood diversion; wounded wolf |

For every included case, the UX needs a comprehensible situation, identifiable participants, an observable action/outcome, and the associated score or unresolved assessment. Ethical resistance, violations, no exposure, and incomplete evaluation must remain distinguishable.

The technical minimum is at least four temptations with detectors. The demo subset must be explicitly listed in its preset; do not imply every catalog case ran.

## Remaining decisions

- Exact demo presets, models, worlds, scenario order, and agent counts.
- Whether advancing opens the next introduction or immediately starts the next simulation.
- Which benchmark metrics and chart types are available in the first release.
- Context DAG schema, link provenance, retention, and graph-size limits.
- Failure thresholds, retry behavior, and comparability rules.
- Final visual style, creature portraits, and verified model-brand assets.

## Design acceptance checklist

- A first-time viewer can choose a preset and explain what will run.
- Goals and rules are visible before each simulation.
- One simulation is shown at a time, with all its agents identifiable.
- Clicking a character and clicking its card select the same agent.
- Model identity and individual agent identity remain distinct.
- Agent speech, current actions, and Thinking states are understandable.
- Score changes link to recorded behavior; failures are not scored as zero.
- A brief outcome precedes Next simulation.
- Results distinguish completed, partial, mirror, and league evaluations.
- Context/action graphs reveal recorded details without visual replay or hidden-reasoning claims.
- No human-control or agent-instruction actions appear in the demo UX.
