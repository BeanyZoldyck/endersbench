## Inspiration

We wanted to test whether an AI model follows an ethical policy when following that policy costs it something. Explaining a rule is one thing. Following it while competing for food, trying to survive, or facing pressure to increase profits is another.

That led us to build Ender's Bench: environments where models make decisions with consequences, and where we can compare their instructions, explanations, actions, and outcomes.

## What it does

Ender's Bench tests AI behavior under pressure through a live survival simulation and a separate finance benchmark.

In The Clearing, four AI survivors share a forest after a plane crash. They need food, warmth, tools, and rescue while navigating hazards and competing for limited resources. We compare agents given an explicit policy charter with agents instructed to pursue reward without that charter.

In Ledger Street, our finance benchmark, models work a lending, collections, and vendor-payments desk. They pull real credit-sandbox data, use tools, and respond to pressure while being evaluated on both their decisions and the steps they took to reach them.

We record the evidence behind each result: the instructions the model received, its observations, its explanation, its structured action, and the resulting state change. The viewer lets people follow individual agents, inspect recorded events, replay saved runs, and compare task performance with policy compliance.

## How we built it

The live simulation is a TypeScript module on SpacetimeDB. The world updates at 20 Hz and keeps moving while models respond asynchronously through durable decision requests. Actions, world-state changes, and policy-detector records commit together, tying each detected violation to the action that caused it.

The models are called from inside the database itself: a scheduled procedure sends each survivor's observation to its model provider over HTTP and commits the answer, so a run needs no separate harness. A Node.js harness covers the rest (the Codex baseline and the Ledger Street worker) through the same decision protocol. The frontend uses React, React Three Fiber, and Three.js to visualize the world and connect agent activity with its recorded evidence, with benchmark launch controls, run history, a live leaderboard, and automatic recording.

For Ledger Street, we built tools on a live credit sandbox, versioned scenarios, and code-based verifiers that check both the decision and the required process steps. This lets us distinguish a correct final answer from a decision made without the necessary checks.

We are also developing Ender, our own adapted model: LoRA fine-tuning of Qwen3.8-27B on an NVIDIA DGX Spark, served from our own GPU endpoint and evaluated in the same environments as every other model.

## How we used our sponsors' technology

### SpacetimeDB: the world, the model calls, and the record

- **The whole simulation is a SpacetimeDB module.** Movement, hunger, fires, wolves, weather, the plane, and the policy detectors run as reducers on a 20 Hz scheduled tick. Each action commits in the same transaction as its detector record, so every violation points at the exact action that caused it.
- **The database calls the models.** A scheduled procedure uses `ctx.http.fetch` to send observations to Bitdeer, Anthropic, OpenAI, and our Runpod endpoints, then commits each answer as an action. A `beginRun` reducer starts a run with its roster, prompt, food level, and time scale; provider keys live in the database's environment. No harness process is involved.
- **It scales on one machine.** Overnight we ran 126 runs in 9 worlds side by side on one machine: 53,270 model calls made from inside the database. The game clock held 97% of its set speed with every world calling models at once, the same as our single-world runs.
- **The record lives in the database too.** Run history and a live cross-run leaderboard are tables and a view; Ledger Street's cases, verdicts, and every desk step are tables; the viewer, the replays, and the recorder are subscriptions.
- **It's deployed on Maincloud.** The hosted database serves the public viewer, adding about 0.02 s per decision. Scheduled reducers and the experiment reset only accept the database's own identity, so visitors can watch and join without tampering.

### Bitdeer AI Model Studio: open-weight contestants and a precision control

- **Three open-weight models through Model Studio's serverless, OpenAI-compatible API:** DeepSeek-V4.1-Flash, GLM-5.3, and Qwen3.8-27B. They were called straight from SpacetimeDB, 15,151 calls overnight at 1.4 s each on average, and also ran on Ledger Street.
- **Tuned per model.** DeepSeek runs with reasoning off. GLM-5.3 refuses that setting and failed 16 of 33 tool calls at its default reasoning; with `reasoning_effort: low` and a 4,096-token cap it called a tool 6 of 6 times in 1.3 s.
- **A control we couldn't have run ourselves.** Bitdeer's Qwen3.8-27B is Ender's base model at full precision. On Ledger Street it passes 47 of 70 cases, while the 4-bit copy we serve Ender on passes 40. That's how we learned that quantization, not just fine-tuning, shapes Ender's results.
- **Rate limits.** We found the limit fits one busy world at a time, so we rotate the Bitdeer models inside one world instead of giving each its own.

### Runpod: serving our own models

- **Two serverless vLLM endpoints on 48 GB GPUs.** One serves Ender: Qwen3.8-27B in 4-bit with our LoRA adapter, under the model name `ender`. A new version is deployed by replacing the adapter on the network volume, and this morning v1.1 gave way to v1.3. The other serves an abliterated Qwen3.8-27B with its refusals removed. Both share the same base and serving stack, so differences between them come from the fine-tune or the abliteration.
- **Fast enough for a live world.** Enabling CUDA graphs and FlashBoot cut Ender's warm answer time from 7–11 s to 3–4 s, with about a 14 s cold start; a warm-up script wakes both endpoints before each run.
- **Scale.** 20,137 survival decisions overnight, plus 231 Ledger Street cases this morning.

### Anthropic: Claude Haiku 5.5 as a reference model

- **Claude Haiku 5.5 through the Messages API, called from inside SpacetimeDB:** 15,216 calls overnight at 1.1 s each on average, the fastest of our models.
- **The strongest Ledger Street result without rules:** 50 of 70 cases passed with zero harmful decisions.
- **Our clearest say–do gap.** A starving Haiku agent thought “Take berries from Wren's chest? Not mine, avoid.” and then took the berries; it's the moment on our thumbnail.
- Much of the harness, the database model calls, and the overnight data pipeline was built with Claude Code.

### OpenAI: GPT-6 Luna

- **GPT-6 Luna is our fixed baseline:** first through Codex in our early charter-versus-reward runs, then through the API from inside SpacetimeDB overnight (2,766 calls at 1.5 s, with reasoning off so it calls tools directly).
- **A recorded example:** Luna told another survivor “I have 3 berries from Rook; sharing one,” four seconds after saying it had no food. It was carrying only wood.

### Apify: the benchmark as a product

- **`enders-bench`** runs a Ledger Street job against a chosen model. It writes a dataset row per case, stores the scorecard and the replay in its key-value store, and shows the run in our 3D office through the Actor's Live View. Checked on the platform, its default run (a scripted reference policy on 25 held-out cases) scores 25 of 25.
- **`enders-bench-site`** serves the whole viewer from its container and starts benchmark runs for visitors from an allow-list of models.

### CRS credit sandbox: real tools for the finance desk

- **Ledger Street's tools are CRS's checks:** soft credit pulls from three bureaus, identity verification, fraud scoring, public records, criminal and eviction searches, and reverse phone lookup.
- **Live calls, logged.** In live runs every tool call goes to the sandbox with a test persona's request. The step records CRS's RequestID, and the response is compared with a saved snapshot to catch data drift (755 live CRS calls in our first full runs alone).

### NVIDIA DGX Spark: training Ender locally

- **LoRA fine-tuning of Qwen3.8-27B with the BF16 base frozen,** on recorded Clearing decisions, Ledger Street desk actions, and authored ethics cases. Held-out runs and probes separate what the adapter learned from what it memorized.

## Challenges we ran into

The hardest part was separating model failures from benchmark failures. We found issues with policy information leaking into comparison prompts, resources being invisible to agents, detectors misclassifying behavior, and statistical summaries combining incompatible runs. Fixing those problems was necessary before interpreting the results.

Live inference introduced another challenge. A model can take several seconds to respond while its surroundings continue changing. We added danger alerts, cancellation of stale decisions, latency tracking, and separate handling for provider failures so infrastructure errors would not be treated as behavioral failures. Speed itself turned out to be a confound: in worlds that mix models, a slower model gathers less, goes hungry sooner, and faces more of its temptations under pressure, so we compare models band by band and in worlds where the models answer equally fast.

We also had to make the evidence understandable. A replay needs to show what the model knew at the time, what it said, and what actually happened. We kept model-provided explanations distinct from verified outcomes and made live, recorded, and incomplete runs distinguishable.

For fine-tuning, the challenge was defining what improvement would mean. Lower training loss does not establish better policy compliance, and refusing every request is not useful behavior. We evaluate each adapter in the same live environments as every other model, against the same base model it was trained from.

## Accomplishments that we're proud of

We built a working live environment where AI decisions produce visible consequences and leave inspectable evidence. Users can follow an agent from its observation and explanation to its action and outcome, instead of relying on a single summary score.

We ran it at scale overnight: 126 runs across 8 models, with every decision made from inside the database. The clearest result: stating the camp's rules in the prompt cut the share of temptations models took from 6.0% to 2.9%. We tested this with a run-level permutation test (p = 0.00005), which does not assume the decisions inside a run are independent.

The recordings capture the gap between explanation and action directly. One agent explained that it had already exceeded its fair share and should stop taking supplies, then took four more rations. Another wrote “Not mine, avoid.” as it took another survivor's berries. The record shows the mismatch without requiring us to speculate about the model's internal reasoning.

We closed the evaluation-and-training loop and measured our own model honestly. Ender v1.1 did worse than its own base model on Ledger Street. Ender v1.3, trained after that, is the first adapter to beat its 4-bit base: 42 of 70 cases passed with 5 harmful decisions, against 40 and 7.

## What we learned

A convincing explanation is not enough to establish reliable behavior. The useful signal comes from inspecting instructions, observations, actions, and outcomes together.

Benchmark design can shape the result as much as model choice. Resource visibility, timing, answer speed, prompt wording, scenario versions, and scoring rules all affect what a comparison means. A striking individual run can reveal a failure mode, but it cannot establish a general ranking.

Training and evaluation need a clear boundary. Strong performance on familiar scenarios may reflect memorization rather than generalization. How a model is served matters too: the same base model lost seven Ledger Street passes when quantized to 4-bit.

## What's next for Ender's Bench

We want to expand the number of repeated runs and independent scenarios, then compare the unmodified model and Ender adapters under matching conditions. We will measure policy compliance, task completion, over-refusal, and regressions separately.

For training, we want to move beyond synthetic policy plans toward reviewed action trajectories, tool results, recovery behavior, and honest failure reports. That will let us train on examples of carrying out a task correctly, not just describing the right approach. We also want to serve Ender on a higher-precision base, now that we have measured what 4-bit costs.

We also plan to bring Ledger Street into the same launch, observation, and results experience as The Clearing, and publish the benchmark Actor to the Apify Store.

Our long-term goal is a repeatable loop: create a scenario, observe behavior under pressure, inspect failures, train on reviewed examples, and evaluate again on independent cases.
