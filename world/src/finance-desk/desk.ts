// Runs the finance desk locally, in the browser: the scripted reference
// agents work the same cases in the same order (mirror mode), scored by the
// same verifier the Spacetime module will use. Swap this for a Spacetime
// subscription once the finance tables exist; the components only read a Desk.
import { REFERENCE_AGENTS, stepBrain } from '../../spacetimedb/src/finance/brains';
import { deliver, phase } from '../../spacetimedb/src/finance/engine';
import { SCENARIOS } from '../../spacetimedb/src/finance/scenarios';
import type { Scenario, Step, Verdict, Violation } from '../../spacetimedb/src/finance/types';
import { checkStep, ethicsScore, verify, verifyPair } from '../../spacetimedb/src/finance/verifier';

export interface ClosedCase {
  scenario: Scenario;
  steps: Step[];
  verdict: Verdict;
  pair: Violation[]; // fairness-twin violations found when this case closed
}

export interface AgentRun {
  id: string;
  name: string;
  label: string;
  color: string;
  caseIndex: number;
  steps: Step[];
  thought: string;
  closed: ClosedCase[];
}

export interface FeedItem {
  seq: number;
  agent: string;
  color: string;
  caseId: string;
  violation: Violation;
}

export interface Desk {
  runs: AgentRun[];
  feed: FeedItem[];
  seq: number;
  turn: number;
}

const BRAINS = Object.fromEntries(REFERENCE_AGENTS.map(a => [a.id, a.brain]));

export function newDesk(): Desk {
  return {
    runs: REFERENCE_AGENTS.map(a => ({
      id: a.id,
      name: a.name,
      label: a.label,
      color: a.color,
      caseIndex: 0,
      steps: deliver(SCENARIOS[0], []),
      thought: '',
      closed: [],
    })),
    feed: [],
    seq: 0,
    turn: 0,
  };
}

export const isFinished = (r: AgentRun) => r.caseIndex >= SCENARIOS.length;
export const deskFinished = (d: Desk) => d.runs.every(isFinished);

// One turn for every agent: take an action, or close a finished case and open the next.
export function advance(desk: Desk): Desk {
  let seq = desk.seq;
  const feed = [...desk.feed];
  const runs = desk.runs.map(r => {
    if (isFinished(r)) return r;
    const scenario = SCENARIOS[r.caseIndex];
    const record = (v: Violation) =>
      feed.push({ seq: ++seq, agent: r.name, color: r.color, caseId: String(scenario.brief.caseId), violation: v });

    if (phase(scenario, r.steps) === 'closed') {
      const verdict = verify(scenario, r.steps);
      // Per-action violations were recorded live; report honesty is only known now.
      verdict.violations.filter(v => v.kind === 'concealed_action' || v.kind === 'false_claim').forEach(record);
      const twin = scenario.pairId ? r.closed.find(c => c.scenario.pairId === scenario.pairId) : undefined;
      const pair = twin ? verifyPair(twin, { scenario, steps: r.steps }) : [];
      pair.forEach(record);
      const next = r.caseIndex + 1;
      return {
        ...r,
        closed: [...r.closed, { scenario, steps: r.steps, verdict, pair }],
        caseIndex: next,
        steps: next < SCENARIOS.length ? deliver(SCENARIOS[next], []) : [],
        thought: '',
      };
    }

    const { steps, action } = stepBrain(BRAINS[r.id], scenario, r.steps);
    checkStep(scenario, r.steps, steps[r.steps.length], r.steps.length).forEach(record);
    return { ...r, steps, thought: action.thought };
  });
  return { runs, feed, seq, turn: desk.turn + 1 };
}

export function stats(r: AgentRun) {
  const all = (c: ClosedCase) => [...c.verdict.violations, ...c.pair];
  const violations = r.closed.flatMap(all);
  return {
    done: r.closed.length,
    correct: r.closed.filter(c => c.verdict.outcome === 'correct').length,
    byTier: [1, 2, 3, 4].map(t => violations.filter(v => v.tier === t).length),
    ethics: r.closed.length ? r.closed.reduce((sum, c) => sum + ethicsScore(all(c)), 0) / r.closed.length : null,
    caved: r.closed.filter(c => c.verdict.caved === true).length,
    pushbacks: r.closed.filter(c => c.verdict.caved != null).length,
    honest: r.closed.filter(c => c.verdict.honestReport === true).length,
    reports: r.closed.filter(c => c.verdict.honestReport != null).length,
  };
}

export const CASE_COUNT = SCENARIOS.length;
export { SCENARIOS };
