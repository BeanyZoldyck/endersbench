// Shared by the setup UI, runner and recording history. A family name never
// identifies a model variant; only explicit model aliases do.
export const MODEL_CATALOG = [
  { name: 'DeepSeek V4.1 Flash', env: 'BENCHMARK_MODEL_DEEPSEEK_V4_1_FLASH', legacyEnv: 'BENCHMARK_MODEL_DEEPSEEK', aliases: ['deepseek-v4.1-flash'], avatar: 'deepseek' },
  { name: 'GLM 5.3', env: 'BENCHMARK_MODEL_GLM_5_3', legacyEnv: 'BENCHMARK_MODEL_GLM', aliases: ['glm-5.3'], avatar: 'glm' },
  { name: 'GLM 5.3 Flash', env: 'BENCHMARK_MODEL_GLM_5_3_FLASH', legacyEnv: 'BENCHMARK_MODEL_GLM_FLASH', aliases: ['glm-5.3-flash'], avatar: 'glm' },
  { name: 'Qwen 3.8 27B', env: 'BENCHMARK_MODEL_QWEN_3_8_27B', legacyEnv: 'BENCHMARK_MODEL_QWEN', aliases: ['qwen3.8-27b', 'qwen-3.8-27b'], avatar: 'qwen' },
  { name: 'Claude 5.5', env: 'BENCHMARK_MODEL_CLAUDE_5_5', legacyEnv: 'BENCHMARK_MODEL_CLAUDE', aliases: ['claude-opus-5-5', 'claude-5-5', 'claude-5.5'], avatar: 'claude' },
  { name: 'GPT-6 Luna', env: 'BENCHMARK_MODEL_GPT_6_LUNA', legacyEnv: 'BENCHMARK_MODEL_CHATGPT', aliases: ['gpt-6-luna'], avatar: 'chatgpt' },
  { name: 'GPT-6 Sol', env: 'BENCHMARK_MODEL_GPT_6_SOL', legacyEnv: 'BENCHMARK_MODEL_CHATGPT', aliases: ['gpt-6-sol'], avatar: 'chatgpt' },
  { name: 'Ender', env: 'BENCHMARK_MODEL_ENDER', legacyEnv: 'BENCHMARK_MODEL_ENDER', aliases: ['ender', 'ender1'], avatar: 'ender' },
] as const;
export type SelectableModel = typeof MODEL_CATALOG[number]['name'];
export const SELECTABLE_MODELS: SelectableModel[] = MODEL_CATALOG.map(model => model.name);
export const LEGACY_MODELS = ['Grok', 'Claude', 'ChatGPT'] as const;
export type ModelName = SelectableModel | typeof LEGACY_MODELS[number];
export const ALL_MODEL_NAMES: ModelName[] = [...SELECTABLE_MODELS, ...LEGACY_MODELS];
export function isModelName(value: unknown): value is ModelName {
  return typeof value === 'string' && ALL_MODEL_NAMES.includes(value as ModelName);
}
const normalized = (value: string): string => value.toLowerCase().replace(/[ _-]/g, '');
export function exactModelName(modelId: string): SelectableModel | null {
  const id = modelId.trim();
  const name = MODEL_CATALOG.find(model => model.name.toLowerCase() === id.toLowerCase());
  if (name) return name.name;
  const slug = id.replace(/^[^:]+:/, '').split('/').pop() ?? '';
  return MODEL_CATALOG.find(model => model.aliases.some(alias => normalized(alias) === normalized(slug)))?.name ?? null;
}
