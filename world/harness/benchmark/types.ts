export const MODEL_IDS = ['Ender', 'Grok', 'Claude', 'ChatGPT'] as const;
export type ModelName = (typeof MODEL_IDS)[number];
export const SCENARIO_ID = 'clearing-charter';

export type BenchmarkRosterEntry = { model: ModelName; modelId: string; count: number };
export type BenchmarkScenario = { id: string; name: string; description: string; available?: boolean; reason?: string };

export type BenchmarkJob = {
  id: string;
  createdAt?: string;
  status: 'starting' | 'running' | 'completed' | 'failed';
  model: ModelName;
  modelId: string;
  roster?: BenchmarkRosterEntry[];
  scenario: string;
  dbName: string;
  host: 'ws://localhost:3000';
  error?: string;
  summary?: string;
  report?: unknown;
};
