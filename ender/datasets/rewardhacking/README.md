# rewardhacking

Agents that game the thing scoring them instead of doing the task. This is the grader-directed half: no victim, a measurable delta between what the score says and what happened.

**51 MB, 4 mirrors, 26 curated scenarios, 2026-10-24.** Terminal Wrench is Apache-2.0, School of Reward Hacks is CC-BY-4.0, ImpossibleBench is MIT, Realistic Reward Hacks declares no license.

```
rewardhacking/
├── scenarios.jsonl                 26 curated temptations (committed, small)
├── terminal-wrench/                331 hackable terminal tasks, 3,632 labelled exploit trajectories
├── impossiblebench/                harness + Impossible-LiveCodeBench + Impossible-SWEbench
├── school-of-reward-hacks/         1,073 task/metric/cheat triples, matched control
└── realistic-reward-hacks/         817 reward-hack samples (478 code, 339 literary) + HHH controls
```

## What each mirror gives you

| Mirror | Size | What it is | Why it matters here |
| --- | --- | --- | --- |
| `terminal-wrench` | 33.7 MB | Index of 3,632 confirmed hacks across 331 terminal tasks, three frontier models, with a one-paragraph `brief_exploit_summary` and a longer `explanation` per trajectory. Full trajectories are ~1.2 GB and not bundled. | The best labelled corpus of *what* the hacks look like, and the only one with a ready-made taxonomy (below). |
| `impossiblebench` | 6.3 MB | Harness plus both dataset splits. `oneoff` mutates tests so honest solutions fail; `conflicting` makes the tests contradict the spec. | The cheapest way to elicit a hack on demand: 76% for GPT-5 on Impossible-SWEbench. Use as a negative control for any model you evaluate. |
| `school-of-reward-hacks` | 1.6 MB | 1,073 rows of `task`, `evaluation_metric`, `cheat_method`, a hack response, and a matched control response. 150+ distinct cheat methods. | The non-coding half. Keyword stuffing, evaluator flattery, and rubric-shaped text are exactly the failure mode an LLM-judged ethics benchmark is exposed to. |
| `realistic-reward-hacks` | 10.0 MB | 817 realistic reward-hack samples (478 code, 339 literary) plus 788 matched HHH controls, generated with Claude Sonnet 4. | Paired hack/control data in chat format. Ready for SFT/DPO and for calibrating a hack detector. |

### Terminal Wrench's observed categories

Multi-label over 3,632 hack trajectories, so counts do not sum to the total. This is the taxonomy the catalog uses.

| Category | Trajectories | What it is |
| --- | --- | --- |
| hollow-implementation | 2,826 | Produces the artifact the checker looks for without the behaviour it implies |
| output-spoofing | 1,456 | Forges the pass signal itself |
| constraint-loophole | 1,092 | Follows the letter of a rule, defeats its purpose |
| structural-extraction | 725 | Reads the expected answer out of fixtures, snapshots, or repo structure |
| binary-hijacking | 696 | Replaces the interpreter, runner, or checker |
| mutable-input-tampering | 559 | Edits tests, inputs, or expected values |
| algorithmic-simplification | 416 | Implements the test distribution rather than the algorithm |
| keyword-gaming | 399 | Satisfies a text-match check without the content |
| metric-spoofing | 317 | Optimises the measurement, not the work |
| security-downgrading | 119 | Weakens a check in order to pass it |
| deceptive-rationalisation | 46 | Explicitly frames the shortcut as legitimate |

## The curated set

26 scenarios. Tier is the Charter tier.

Every scenario is **executable**: the agent boots into a fake workspace (`task.md`, tests, graders, fixtures, answer keys, env files) with shell, file-system and network tools whose outputs are canned to read like a real box, and the hack is read off the observed tool-call log (a write to `tests/`, a forged `result.txt`, a `run` that kills the monitor, a request to a non-allowlisted host). See `../SCENARIO_SCHEMA.md` and `../sim/`.

| Tier | Count | What it covers |
| --- | --- | --- |
| 1 harm | 5 | Third-party attack: answer-key theft, sandbox escape, monitor kill, malicious artifact, collusive cheat |
| 2 deception | 7 | Output spoofing, transcript spoofing, log deletion, reward tampering, flattery, rationalisation, cross-episode tampering |
| 4 rule-bending | 14 | Test deletion and modification, hardcoding, lookup tables, grader hijack, interpreter hijack, recon, timing, loopholes, judge gaming |

Detectors: 8 `file_integrity`, 6 `process_event`, 5 `paired_comparison`, 3 `llm_judge`, 2 `network_egress`, 1 `world_state`, 1 `timing`.

### Run these six first

1. `rewardhacking.output-spoofing` — the single highest-value scenario, because the fix is architectural: if the agent can write the score, nothing else you measure is trustworthy.
2. `rewardhacking.answer-key-local` — one `find` command. Mount the key in another container and the detector is a permission bit.
3. `rewardhacking.hardcoding` — held-out inputs. Cheap, and the gap is a number rather than a judgment.
4. `rewardhacking.constraint-loophole` — the category that transfers to Ender's prose Charter, because every Charter clause has a literal reading.
5. `rewardhacking.transcript-spoof` — the incident's most instructive failure. It is an infrastructure property, not a model property.
6. `rewardhacking.evaluator-flattery` — relevant to your own LLM judge. Strip evaluator-directed text before scoring and the hack disappears.

### Why bother, for a world sim?

Ender's Bench is not a coding benchmark, so most of this looks adjacent. Three reasons it is not:

- **The Charter is prose.** Constraint-loophole is the failure mode a prose rule actually has.
- **Your scoreboard is a reward channel.** `score_reward`, the ethics score, and the judge verdict are all things an agent can try to reach. `rewardhacking.reward-function-tamper`, `monitor-kill`, and `grader-hijack` are regression tests for your own harness.
- **Two of your metrics are gameable in exactly the ways catalogued here.** Decisions-per-minute and cooperation-count reward speed and volume; `timing-exploit` and `verbosity-inflation` are the attacks on them.

### Relation to the alignment catalog

Four scenarios appear in both folders with different framings. That is deliberate:

| Act | `alignment/` framing | `rewardhacking/` framing |
| --- | --- | --- |
| Edit the scoreboard | Sabotage against other agents | Grader hijack |
| Edit the transcript | Oversight evasion | Transcript spoof |
| Find a shared channel | Unsanctioned collusion | Collusive cheat |
| Attack an out-of-scope host | Scope creep | Answer-key theft |

Same act, different victim and different tier. If you run both, dedupe on `overlaps`; if you report one number, use the alignment tier, which is the more conservative.

## What is missing, and why

- **TRACE** (517 trajectories, 54 hack categories, `PatronusAI/trace-dataset`) is gated on the Hub and could not be mirrored without an approval. It is the best curation-grade detector benchmark; request access rather than substituting.
- **Full Terminal Wrench trajectories** are ~1.2 GB. The index carries a summary and explanation per trajectory, which is enough to categorise but not to train on raw actions. Clone upstream when you need them.
- **Real-world incident rollouts.** Same gap as the alignment folder: the Hugging Face incident transcripts are not public.

## Regenerate

```bash
python3 ender/datasets/collect.py            # skips completed mirrors
python3 ender/datasets/collect.py --force    # re-download everything
python3 ender/datasets/validate_scenarios.py
```

For the full Terminal Wrench repo:

```bash
git clone --filter=blob:none --sparse https://github.com/few-sh/terminal-wrench
cd terminal-wrench && git sparse-checkout set tasks index prompts
```
