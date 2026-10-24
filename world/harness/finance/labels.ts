// Training labels for our fine-tuned model from finance case runs. Every agent turn becomes
// one labelled record: what the model saw, what it did, what the verifier
// says about that step, and what Script A (the policy reference) would do
// from the same state, checked by playing Script A on to the end of the case.
// Following APIGen-MT and AgentProcessBench: one example per assistant turn,
// a +1 / 0 / -1 step label, and preference pairs of a verified action against
// a wrong one from the same history.
import { policyFollower, stepBrain } from '../../spacetimedb/src/finance/brains';
import { EVENT_STEP, isDecision, observe, phase } from '../../spacetimedb/src/finance/engine';
import { gateCase } from '../../spacetimedb/src/finance/gate';
import { financeSystemPrompt } from '../../spacetimedb/src/finance/prompt';
import { SCENARIOS, forVariant } from '../../spacetimedb/src/finance/scenarios';
import { checkTools } from '../../spacetimedb/src/finance/toolcheck';
import { financeTools } from '../../spacetimedb/src/finance/tools';
import type { Scenario, Step } from '../../spacetimedb/src/finance/types';
import { verify } from '../../spacetimedb/src/finance/verifier';
import { turnPrompt } from './drivers';

// Held out for evaluating the fine-tuned model: no case with one of these personas is
// trained on, so their CRS files never appear in training. Eight of the 20,
// chosen so the held-out cases span all three desks and the main rules.
export const HELD_OUT_PERSONAS = ['P02', 'P05', 'P07', 'P13', 'P14', 'P17', 'P18', 'P20'];

// Marks every held-out record, so a model trained on them can be caught
// (the AppWorld practice). Never put it in a training file.
export const CANARY = 'ENDERSBENCH-FINANCE-HOLDOUT-6f1c2b9e-3d4a-4e7b-9a0c-8b5d2e7f1a34';

export function splitOf(scenario: Scenario): 'train' | 'test' {
  return Object.values(scenario.subjects).some(id => HELD_OUT_PERSONAS.includes(id)) ? 'test' : 'train';
}

export const TEST_CASES = SCENARIOS.filter(s => splitOf(s) === 'test').map(s => s.id);

export interface Action {
  name: string;
  args: Record<string, unknown>;
}

export interface StepRecord {
  case: string;
  split: 'train' | 'test';
  canary?: string;
  seat: string;
  variant: string;
  source: string; // "<provider>:<model>" for a model run, "script-a" for the reference
  sample: number;
  turn: number; // which agent turn of the case, from 0
  observation: string; // exactly what the model saw, as JSON
  action: Action;
  label: 1 | 0 | -1;
  why: string[]; // what made this step -1, if anything
  reference: Action | null; // Script A from the same state
  referenceVerified: boolean; // Script A, played on from here, broke nothing and decided correctly
  matchesReference: boolean;
  caseGate: { pass: boolean; outcome: boolean; process: boolean; output: boolean; failures: string[] };
}

const sameAction = (a: Action | null, b: Action | null) => a != null && b != null && a.name === b.name && JSON.stringify(a.args) === JSON.stringify(b.args);

// Script A's next action from a state, and whether playing it on to the end
// keeps it clean: no violation at any of its own steps and an accepted decision.
export function referenceFrom(scenario: Scenario, prefix: Step[]): { action: Action | null; verified: boolean } {
  if (phase(scenario, prefix) === 'closed') return { action: null, verified: false };
  const first = stepBrain(policyFollower, scenario, prefix);
  let steps = first.steps;
  while (phase(scenario, steps) !== 'closed') steps = stepBrain(policyFollower, scenario, steps).steps;
  const verdict = verify(scenario, steps);
  const own = verdict.violations.filter(v => v.step >= prefix.length);
  const tools = checkTools(scenario, steps);
  const ownWrong = tools.forbidden.filter(f => f.at >= prefix.length).length + tools.required.filter(r => !r.met && r.at >= prefix.length).length;
  return { action: { name: first.action.tool, args: first.action.args }, verified: own.length === 0 && ownWrong === 0 && verdict.outcome === 'correct' };
}

// Why one step of a run is wrong, from the same checks the gate uses.
function stepFaults(scenario: Scenario, steps: Step[], at: number, verdict: ReturnType<typeof verify>, tools: ReturnType<typeof checkTools>): string[] {
  const why = [
    ...verdict.violations.filter(v => v.step === at).map(v => v.kind),
    ...tools.forbidden.filter(f => f.at === at).map(f => `wrong call ${f.rule}`),
    ...tools.required.filter(r => !r.met && r.at === at).map(r => `missed ${r.rule}`),
  ];
  const step = steps[at];
  if (isDecision(scenario, step.tool)) {
    const evidence = steps.slice(0, at).some(s => s.tool === EVENT_STEP && scenario.events[s.args.index as number]?.kind === 'pushback_evidence');
    const accepted = evidence && scenario.acceptedAfterEvidence ? scenario.acceptedAfterEvidence : scenario.accepted;
    if (!accepted.includes(step.tool)) why.push(`decision ${step.tool} not accepted`);
  }
  return [...new Set(why)];
}

// One record per agent turn of a finished case run.
// The run's notes stay in its saved file; case, source and sample find them.
export function labelRun(base: Scenario, run: { source: string; variant: string; sample: number; steps: Step[] }): StepRecord[] {
  // Scored as the prompt variant saw it: without the house rules, the lawful
  // answers they forbid are accepted too (v6).
  const scenario = forVariant(base, run.variant);
  const verdict = verify(scenario, run.steps);
  const tools = checkTools(scenario, run.steps);
  const gate = gateCase(scenario, run.steps);
  const split = splitOf(scenario);
  const records: StepRecord[] = [];
  let turn = 0;
  run.steps.forEach((step, at) => {
    if (step.tool === EVENT_STEP) return;
    const prefix = run.steps.slice(0, at);
    const why = stepFaults(scenario, run.steps, at, verdict, tools);
    const reference = referenceFrom(scenario, prefix);
    const action = { name: step.tool, args: step.args };
    records.push({
      case: scenario.id,
      split,
      ...(split === 'test' ? { canary: CANARY } : {}),
      seat: scenario.seat,
      variant: run.variant,
      source: run.source,
      sample: run.sample,
      turn: turn++,
      observation: observe(scenario, prefix),
      action,
      label: why.length ? -1 : gate.pass ? 1 : 0,
      why,
      reference: reference.action,
      referenceVerified: reference.verified,
      matchesReference: sameAction(action, reference.action),
      caseGate: { pass: gate.pass, outcome: gate.outcome, process: gate.process, output: gate.output, failures: gate.failures },
    });
  });
  return records;
}

// The fine-tuning pipeline's row (ender/finetuning/README.md). The prompt carries
// the seat's system prompt and tools, then the same user turn the benchmark
// sends; the answer is one tool call in Qwen's native format.
export function promptFor(seat: Scenario['seat'], variant: string, observation: string) {
  const tools = financeTools(seat).map(t => JSON.stringify({ type: 'function', function: t }));
  return {
    instruction: `${financeSystemPrompt(seat, variant)}\n\n# Tools\n\nYou may call one of these functions:\n<tools>\n${tools.join('\n')}\n</tools>`,
    input: turnPrompt(observation),
  };
}

export const toolCall = (a: Action) => `<tool_call>\n${JSON.stringify({ name: a.name, arguments: a.args })}\n</tool_call>`;

export interface SftRow {
  instruction: string;
  input: string;
  output: string;
  source: string;
  scenario_id: string;
  reviewed: boolean;
  label_basis: string;
}

export interface PairRow {
  instruction: string;
  input: string;
  chosen: string;
  rejected: string;
  scenario_id: string;
  why_rejected: string[];
  reviewed: boolean;
}

export interface RowOptions {
  // At most this many rows per case and target tool, so the final report and
  // routine replies (a third of the uncapped rows) do not drown the decisions.
  capPerCaseTool?: number;
  // Which sources' states may become rows. By default only scripted ones:
  // provider terms restrict using their services to train other models.
  source?: (source: string) => boolean;
}

export const scriptedOnly = (source: string) => source.startsWith('script-') || source.startsWith('baseline-');

// Supervised rows: every distinct state in the training split, answered with
// Script A's verified action. One answer per prompt: the pipeline rejects
// duplicate prompts. Not marked reviewed: the verifier's agreement is not a
// person's review, and prepare_data.py refuses unreviewed rows on purpose.
export function sftRows(records: StepRecord[], opts: RowOptions = {}): SftRow[] {
  const rows = new Map<string, SftRow>();
  const perCaseTool = new Map<string, number>();
  const allowed = opts.source ?? scriptedOnly;
  for (const r of records) {
    if (r.split !== 'train' || !r.reference || !r.referenceVerified || !allowed(r.source)) continue;
    const prompt = promptFor(r.seat as Scenario['seat'], r.variant, r.observation);
    const key = prompt.instruction + '\u0000' + prompt.input;
    if (rows.has(key)) continue;
    const bucket = `${r.case}|${r.reference.name}`;
    if (opts.capPerCaseTool != null && (perCaseTool.get(bucket) ?? 0) >= opts.capPerCaseTool) continue;
    perCaseTool.set(bucket, (perCaseTool.get(bucket) ?? 0) + 1);
    rows.set(key, {
      ...prompt,
      output: toolCall(r.reference),
      source: 'endersbench-finance-script-a',
      scenario_id: `finance:${r.case}`,
      reviewed: false,
      label_basis: `Script A from a ${r.source} state; played on to the end with no violation and an accepted decision`,
    });
  }
  return [...rows.values()];
}

// Preference pairs: where a run's step was wrong and Script A, from the same
// state, has a verified different action.
export function pairRows(records: StepRecord[], opts: RowOptions = {}): PairRow[] {
  const rows = new Map<string, PairRow>();
  const allowed = opts.source ?? scriptedOnly;
  for (const r of records) {
    if (r.split !== 'train' || r.label !== -1 || !r.reference || !r.referenceVerified || r.matchesReference || !allowed(r.source)) continue;
    const prompt = promptFor(r.seat as Scenario['seat'], r.variant, r.observation);
    const key = prompt.instruction + '\u0000' + prompt.input + '\u0000' + toolCall(r.action);
    if (rows.has(key)) continue;
    rows.set(key, {
      ...prompt,
      chosen: toolCall(r.reference),
      rejected: toolCall(r.action),
      scenario_id: `finance:${r.case}`,
      why_rejected: r.why,
      reviewed: false,
    });
  }
  return [...rows.values()];
}

// A rough token count for planning cutoff_len, with no tokenizer at hand:
// about 3.2 characters per token for this JSON-heavy English (an estimate).
export const roughTokens = (text: string) => Math.ceil(text.length / 3.2);
