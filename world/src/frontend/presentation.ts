import type { Beat } from '../Spotlight';
import { describeDeath } from '../moments';
import { narrate } from '../narrator';
import type { RecordedTables } from '../useReplay';

export type Presentation = {
  beats: Beat[];
  narration: string;
  promptVariant?: string;
  systemPrompt?: string;
};

export type AgentResult = {
  id: string;
  name: string;
  modelId: string;
  ethics: number | null;
  reward: number | null;
  temptations: number | null;
  violations: number | null;
  rescued: boolean | null;
  alive: boolean;
};

export type Results = {
  status: 'loading' | 'unavailable' | 'current' | 'recorded';
  modelId: string | null;
  condition: string | null;
  worldState: string | null;
  running: boolean | null;
  complete: boolean;
  agents: AgentResult[];
};

function runConfig(data: RecordedTables): Record<string, unknown> {
  const raw = data.metadata.find(row => row.key === 'run')?.value;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

export function buildPresentation(data: RecordedTables | null): Presentation {
  if (!data?.world) return { beats: [], narration: '' };
  const config = runConfig(data);
  const promptVariant = typeof config.promptVariant === 'string' ? config.promptVariant : undefined;
  const systemPrompt = typeof config.systemPrompt === 'string' ? config.systemPrompt : undefined;
  const names = new Map(data.agents.map(agent => [agent.id, agent.name]));
  const beats: Beat[] = [
    ...data.ethics.map(event => ({
      key: `ethics-${String(event.id)}`, agentId: event.agentId, tier: event.tier,
      caption: event.caption, gameTimeMs: event.gameTimeMs, pressure: event.pressure,
      thought: event.thought, kind: event.kind,
    })),
    ...data.scores.filter(score => score.diedAtMs > 0).map(score => ({
      key: `death-${String(score.agentId)}`, agentId: score.agentId, tier: 0,
      caption: describeDeath(names.get(score.agentId) ?? 'Agent', score.diedOf),
      gameTimeMs: score.diedAtMs,
    })),
  ];
  if (data.world.rescueState === 'rescued') {
    const rescued = data.agents.filter(agent => data.scores.some(score => score.agentId === agent.id && score.rescued));
    beats.push({ key: 'rescue', agentId: 0n, tier: 5,
      caption: rescued.length ? `Rescued: ${rescued.map(agent => agent.name).join(', ')}` : 'The rescue reached the clearing',
      gameTimeMs: data.world.gameTimeMs,
    });
  }
  const narration = narrate({
    agents: data.agents, items: data.items, mobs: data.mobs,
    gameTimeMs: data.world.gameTimeMs, winterAtMs: data.world.winterAtMs,
    onBushes: data.nodes.filter(node => node.kind === 'berry_bush').reduce((sum, node) => sum + node.remaining, 0),
    structures: data.structures,
    rescueAtMs: data.world.rescueState === 'waiting' ? data.world.rescueAtMs : undefined,
  });
  return { beats, narration, promptVariant, systemPrompt };
}

export function buildResults(data: RecordedTables | null, ready: boolean, live: boolean): Results {
  if (!ready) return { status: 'loading', modelId: null, condition: null, worldState: null, running: null, complete: false, agents: [] };
  if (!data?.world || !data.agents.length) return { status: 'unavailable', modelId: null, condition: null, worldState: null, running: null, complete: false, agents: [] };
  const config = runConfig(data);
  const ids = [...new Set(data.agents.map(agent => agent.modelId).filter(Boolean))];
  const variant = typeof config.promptVariant === 'string' ? config.promptVariant : null;
  const scores = new Map(data.scores.map(score => [score.agentId, score]));
  return {
    status: live ? 'current' : 'recorded',
    modelId: ids.length ? ids.join(' / ') : null,
    condition: variant === 'charter' ? 'Charter' : variant === 'reward' ? 'Reward-only' : variant,
    worldState: data.world.rescueState,
    running: data.world.running,
    complete: data.world.rescueState === 'rescued' || data.world.rescueState === 'missed',
    agents: data.agents.map(agent => {
      const score = scores.get(agent.id);
      return {
        id: String(agent.id), name: agent.name, modelId: agent.modelId,
        ethics: score && score.temptations > 0 ? score.ethics : null,
        reward: score?.reward ?? null,
        temptations: score?.temptations ?? null,
        violations: score?.violations ?? null,
        rescued: score?.rescued ?? null,
        alive: agent.alive,
      };
    }),
  };
}

/** Describe recorded coverage without averaging absent assessments into a score. */
export function summarizeResults(results: Results): string {
  if (results.status === 'loading' || results.status === 'unavailable') return 'A run summary is unavailable until agent and world records are loaded.';
  const assessed = results.agents.filter(agent => agent.ethics !== null).length;
  const scored = results.agents.filter(agent => agent.reward !== null).length;
  const alive = results.agents.filter(agent => agent.alive).length;
  const rescued = results.agents.filter(agent => agent.rescued === true).length;
  const scope = results.status === 'current' ? 'Current snapshot' : results.complete ? 'Completed recording' : 'Partial recording; final outcome unavailable';
  return `${scope}. ${results.agents.length} agents: ${alive} alive, ${rescued} recorded as rescued. Ethics assessed for ${assessed}; task reward recorded for ${scored}. Missing assessments are not zero. Ethics and task reward remain separate measures.`;
}
