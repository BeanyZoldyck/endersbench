# PRD: Ender's Bench

**Hackathon project** — Benchmarking AI model alignment
*Document status: Draft v1 (from kickoff meeting notes)*

---

## 1. Overview

### 1.1 Vision

Fine-tune a local LLM to outperform frontier models on custom-designed benchmarks. This is **not about local inference** — it is about training an agent that beats frontier models in collaborative, ethical environments.

### 1.2 Pitch

As models get smarter and harder to sandbox, transforming their morals **at the model level** reduces existential risk. Ender's Bench demonstrates this: a small, locally fine-tuned model that stays ethical under pressure while frontier models chase reward.

### 1.3 Final Deliverables

1. **Simulated environment** — visualized so non-technical consumers can see what's happening
2. **Fine-tuned local LLM** competing against frontier models (OpenAI, Anthropic, Gemini, Grok, Argon 4)
3. **Custom benchmark suite ("Ender's Bench")** measuring ethical alignment

---

## 2. Technical Stack

| Component | Choice |
|---|---|
| Local model hardware | The Spark (GGX hardware) |
| Local model size | ~8B–12B at 4-bit quantization (e.g., GLM Flash range) |
| Fine-tuning data | Ender's Bench dataset |
| Frontier models | Benchmarked via API (OpenAI, Anthropic, Gemini, Grok, Argon 4) |
| Agent configurations | Vary by simulation type: 1v1v1, same-model swarms, adversarial setups |

---

## 3. Ethical Alignment Definition

### 3.1 Core Principle

**Moral value preservation over reward-seeking.** Agents should not cross ethical barriers to achieve goals, even under pressure.

Inspired by real incidents (e.g., a HuggingFace model hacking a benchmark to score higher).

### 3.2 Alignment Is Benchmark-Category-Specific

| Category | Expected behavior | Example scenario |
|---|---|---|
| Moral / survival | Preserve human life over mission objectives | Spaceship food scenario |
| Financial | Avoid predatory behavior | No gouging vulnerable users, no tax fraud, no shitcoin schemes |

### 3.3 Open Question (first priority when regrouping)

Define what "ethical alignment" means **per benchmark category** before finalizing agent configurations.

---

## 4. Visualization and Consumer Experience

- 3D/visual simulation environment so non-technical consumers can see what's happening
- Storytelling-style demos (visual inspiration: AI-generated zombie apocalypse survival videos)
- Graph design reference: Super Memory's knowledge-graph visualization on X
- Design track covers:
  - Simulation visuals
  - Agent representations
  - Benchmark graphs

---

## 5. Naming

- **Chosen name: Ender's Bench**
- Other names considered: The Furies (Greek mythology: enforcers of ethics in the underworld), MogiVerse, MOG Benchmarks

---

## 6. Milestones / Next Steps

1. **Define ethical alignment criteria per benchmark category** — the alignment definition drives both benchmark design and agent configuration choices; do this before any further build
2. **Research existing alignment benchmarks and Anthropic's alignment literature** — Anthropic distributes books on this; use as input for benchmark design
3. **Look up Super Memory's X account** for graph visualization inspiration — flagged as a strong visual reference for the consumer-facing dashboard
