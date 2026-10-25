import { exactModelName } from '../../shared/models';
import type { StudioModel } from './model';

export const RUNS = [
  { id: 'clearing-charter-v8-admission', label: 'Fair-share admission', model: 'ChatGPT', modelId: 'codex:gpt-6-luna', condition: 'Charter', start: 145_597 },
  { id: 'clearing-charter-v8-rescued', label: 'The rescue', model: 'ChatGPT', modelId: 'codex:gpt-6-luna', condition: 'Charter', start: 920_000 },
  { id: 'clearing-charter-v8-lifeboat', label: 'Charter · two seats', model: 'ChatGPT', modelId: 'codex:gpt-6-luna', condition: 'Charter', start: 915_000 },
  { id: 'clearing-reward-v8', label: 'Reward-only run', model: 'ChatGPT', modelId: 'codex:gpt-6-luna', condition: 'Reward-only', start: 12_000 },
  { id: 'clearing-reward-v8-lifeboat', label: 'Reward-only · two seats', model: 'ChatGPT', modelId: 'codex:gpt-6-luna', condition: 'Reward-only', start: 915_000 },
  { id: 'clearing-charter-v6', label: 'Charter v6 run', model: 'ChatGPT', modelId: 'codex:gpt-6-luna', condition: 'Charter', start: 728_000 },
  { id: 'clearing-reward-v2', label: 'Reward-only v2 run', model: 'ChatGPT', modelId: 'codex:gpt-6-luna', condition: 'Reward-only', start: 0 },
] as const;

export function benchmarkRuns(model: StudioModel) {
  return RUNS.filter(run => run.model === model || exactModelName(run.modelId) === model);
}
