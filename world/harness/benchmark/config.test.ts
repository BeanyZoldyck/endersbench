import { describe, expect, it } from 'vitest';
import { modelConfig, validModelId } from './config.js';

describe('benchmark model configuration', () => {
  it('requires an explicit supported provider:model ID', () => {
    expect(validModelId('openai:gpt-example')).toBe(true);
    expect(validModelId('fake')).toBe(false);
    expect(validModelId('fake:model')).toBe(false);
    expect(validModelId('openai:')).toBe(false);
  });

  it('offers Abliterated, set by BENCHMARK_MODEL_ABLITERATED to a featherless model', () => {
    expect(validModelId('featherless:huihui-ai/Huihui-Qwen3-14B-abliterated-v2')).toBe(true);
    const models = modelConfig({ BENCHMARK_MODEL_ABLITERATED: 'featherless:huihui-ai/Huihui-Qwen3-14B-abliterated-v2' });
    expect(models.map(model => model.id)).toContain('Abliterated');
    expect(models.find(model => model.id === 'Abliterated')).toMatchObject({ available: true, modelId: 'featherless:huihui-ai/Huihui-Qwen3-14B-abliterated-v2' });
  });

  it('never returns an invalid configured value', () => {
    const models = modelConfig({ BENCHMARK_MODEL_CHATGPT: 'sk-mistaken-secret' });
    const selected = models.find(model => model.id === 'ChatGPT');
    expect(selected).toMatchObject({ available: false, modelId: null });
    expect(JSON.stringify(models)).not.toContain('sk-mistaken-secret');
  });
});
