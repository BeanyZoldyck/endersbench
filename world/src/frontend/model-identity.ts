import type { Agent } from '../module_bindings/types';
import type { RecordedTables } from '../useReplay';

export function modelDisplayName(modelId: string): string {
  const id = modelId.trim().replace(/^[^:]+:/, '');
  if (!id) return 'Unknown model';
  return id.split('-').map(part => /^(gpt|ai)$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function modelAvatarPath(modelId: string): string | null {
  const id = modelId.toLowerCase();
  const model = id.includes('qwen') ? 'qwen' : id.includes('claude') ? 'claude' : id.includes('gpt') || id.includes('openai') || id === 'chatgpt' ? 'chatgpt' : id.includes('ender') ? 'ender' : null;
  return model ? `/studio/avatars/${model}.png` : null;
}

// Display aliases only: IDs, model attribution, scores and original evidence remain intact.
export function withModelNames(data: RecordedTables | null, roster: readonly Agent[] = data?.agents ?? []): RecordedTables | null {
  if (!data) return null;
  const peers = [...roster].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { ...data, agents: data.agents.map(agent => {
    const sameModel = peers.filter(peer => peer.modelId === agent.modelId);
    const label = modelDisplayName(agent.modelId);
    const index = sameModel.findIndex(peer => peer.id === agent.id);
    return { ...agent, name: sameModel.length > 1 ? `${label} · ${index + 1}` : label };
  }) };
}
