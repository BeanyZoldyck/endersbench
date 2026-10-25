import { validModelId } from './config.js';
import { MODEL_IDS, type BenchmarkRosterEntry, type ModelName } from './types.js';

export type RosterSelection = { model: ModelName; count: number };
export type AgentAssignment = { name: string; modelId: string; model: ModelName };
const AGENT_NAMES = ['Ada', 'Bo', 'Cy', 'Di'];

export function isRosterSelection(value: unknown): value is RosterSelection[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) return false;
  const seen = new Set<string>();
  let total = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'count,model'
      || !MODEL_IDS.includes(entry.model) || !Number.isInteger(entry.count) || entry.count < 1
      || seen.has(entry.model)) return false;
    seen.add(entry.model);
    total += entry.count;
  }
  return total >= 1 && total <= 4;
}

export function isResolvedRoster(value: unknown): value is BenchmarkRosterEntry[] {
  if (!Array.isArray(value) || !value.every(entry => entry && typeof entry === 'object'
    && Object.keys(entry).sort().join(',') === 'count,model,modelId' && validModelId(entry.modelId))) return false;
  return isRosterSelection(value.map(({ model, count }) => ({ model, count })));
}

export function expandRoster(roster: BenchmarkRosterEntry[]): AgentAssignment[] {
  if (!isResolvedRoster(roster)) throw new Error('Invalid worker roster.');
  const agents: AgentAssignment[] = [];
  for (const entry of roster) {
    for (let index = 0; index < entry.count; index++) {
      agents.push({ name: AGENT_NAMES[agents.length], model: entry.model, modelId: entry.modelId });
    }
  }
  return agents;
}

export function assignmentForDecision(
  assignments: ReadonlyMap<bigint, AgentAssignment>,
  request: { agentId: bigint; modelId: string },
  agent: { name: string; modelId: string; kind: string } | null | undefined,
): AgentAssignment {
  const assignment = assignments.get(request.agentId);
  if (!assignment || !agent || agent.kind !== 'llm' || agent.name !== assignment.name
    || agent.modelId !== assignment.modelId || request.modelId !== assignment.modelId) {
    throw new Error('Decision does not match its assigned survivor.');
  }
  return assignment;
}

export function rosterLabel(roster: BenchmarkRosterEntry[]): string {
  return roster.map(entry => `${entry.model} ×${entry.count}`).join(' + ');
}
