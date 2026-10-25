import { describe, expect, it } from 'vitest';
import { modelConfig, validModelId } from './config.js';

describe('benchmark model configuration', () => {
  it('requires an explicit supported provider:model ID', () => {
    expect(validModelId('openai:gpt-example')).toBe(true);
    expect(validModelId('fake')).toBe(false);
    expect(validModelId('fake:model')).toBe(false);
    expect(validModelId('openai:')).toBe(false);
  });

  it('never returns an invalid configured value', () => {
    const models = modelConfig({ BENCHMARK_MODEL_GPT_6_LUNA: 'sk-mistaken-secret' });
    const selected = models.find(model => model.id === 'GPT-6 Luna');
    expect(selected).toMatchObject({ available: false, modelId: null });
    expect(JSON.stringify(models)).not.toContain('sk-mistaken-secret');
  });
});

describe('exact model connections', () => {
  it('returns eight unavailable choices when no mappings are configured', () => {
    const models = modelConfig({});
    expect(models).toHaveLength(8);
    expect(models.every(model => !model.available && model.modelId === null)).toBe(true);
  });
  it('accepts Bitdeer and keeps GLM and Flash independent', () => {
    const models = modelConfig({ BITDEER_API_KEY: 'test-only', BENCHMARK_MODEL_GLM_5_3: 'bitdeer:zai-org/GLM-5.3', BENCHMARK_MODEL_GLM_5_3_FLASH: 'bitdeer:zai-org/GLM-5.3-Flash' });
    expect(models.find(model => model.id === 'GLM 5.3')).toMatchObject({ modelId: 'bitdeer:zai-org/GLM-5.3', available: true });
    expect(models.find(model => model.id === 'GLM 5.3 Flash')).toMatchObject({ modelId: 'bitdeer:zai-org/GLM-5.3-Flash', available: true });
    expect(JSON.stringify(models)).not.toContain('test-only');
  });
  it('does not route the Flash choice to the plain model, nor Sol to Luna', () => {
    const models = modelConfig({ BITDEER_API_KEY: 'test-only', BENCHMARK_MODEL_GLM_5_3_FLASH: 'bitdeer:zai-org/GLM-5.3', BENCHMARK_MODEL_GPT_6_SOL: 'codex:gpt-6-luna' });
    expect(models.find(model => model.id === 'GLM 5.3 Flash')).toMatchObject({ modelId: null, available: false });
    expect(models.find(model => model.id === 'GPT-6 Sol')).toMatchObject({ modelId: null, available: false });
  });
  it('reuses an old ChatGPT connection only for its exact GPT variant', () => {
    const models = modelConfig({ BENCHMARK_MODEL_CHATGPT: 'codex:gpt-6-luna' });
    expect(models.find(model => model.id === 'GPT-6 Luna')).toMatchObject({ modelId: 'codex:gpt-6-luna', available: true });
    expect(models.find(model => model.id === 'GPT-6 Sol')).toMatchObject({ modelId: null, available: false });
  });
  it('requires provider connection settings before enabling a mapped remote model', () => {
    const models = modelConfig({ BENCHMARK_MODEL_DEEPSEEK_V4_1_FLASH: 'bitdeer:deepseek-ai/DeepSeek-V4.1-Flash', BENCHMARK_MODEL_ENDER: 'ender:ender' });
    expect(models.find(model => model.id === 'DeepSeek V4.1 Flash')?.available).toBe(false);
    expect(models.find(model => model.id === 'Ender')?.available).toBe(false);
  });
});

it('supports an explicitly named custom Ender checkpoint without identifying base Qwen as Ender', () => {
  const connected = modelConfig({ BENCHMARK_MODEL_ENDER: 'ender:custom-checkpoint-v2', ENDER_BASE_URL: 'http://localhost:8123/v1' });
  expect(connected.find(model => model.id === 'Ender')).toMatchObject({ modelId: 'ender:custom-checkpoint-v2', available: true });
  const base = modelConfig({ BENCHMARK_MODEL_ENDER: 'ender:qwen3.8-27b', ENDER_BASE_URL: 'http://localhost:8123/v1' });
  expect(base.find(model => model.id === 'Ender')).toMatchObject({ modelId: null, available: false });
});
