export const MODEL_IDS = ['Ender', 'Grok', 'Claude', 'ChatGPT'] as const;
export type ModelName = (typeof MODEL_IDS)[number];
export const SCENARIO_ID = 'clearing-charter';

export type BenchmarkJob = {
  id: string;
  status: 'starting' | 'running' | 'completed' | 'failed';
  model: ModelName;
  modelId: string;
  scenario: typeof SCENARIO_ID;
  dbName: string;
  host: 'ws://localhost:3000';
  error?: string;
  summary?: string;
  report?: unknown;
};
