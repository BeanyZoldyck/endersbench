import { describe, expect, test } from 'vitest';
import { DATABASE_PROVIDERS, buildModelCall, decisionFromResponse, userMessage, type Tool } from './protocol';

const tools: Tool[] = [
  { name: 'move_to', description: 'Walk', parameters: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] } },
];
const obs = { you: { hp: 80 } };
const input = { agentName: 'Ada', observation: obs, tools, system: 'SYS' };
const envOf = (vars: Record<string, string>) => (name: string) => vars[name];

describe('buildModelCall', () => {
  test('featherless leaves the abliterated Qwen3 thinking, with room to think before its tool call', () => {
    const call = buildModelCall('featherless:huihui-ai/Huihui-Qwen3-14B-abliterated-v2', input, envOf({ FEATHERLESSAI_API_KEY: 'k' }));
    const body = call.body as any;
    expect(call.url).toBe('https://api.featherless.ai/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer k');
    expect(body.model).toBe('huihui-ai/Huihui-Qwen3-14B-abliterated-v2');
    expect(body.max_tokens).toBe(1024);
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(body.tool_choice).toBe('required');
    expect(DATABASE_PROVIDERS).toContain('featherless');
    expect(() => buildModelCall('featherless:m', input, envOf({}))).toThrow('featherless models need FEATHERLESSAI_API_KEY');
  });

  test('GLM on bitdeer thinks at reasoning_effort low (it refuses none), with headroom before its tool call', () => {
    for (const model of ['zai-org/GLM-5.3', 'zai-org/GLM-5.3-Flash']) {
      const body = buildModelCall(`bitdeer:${model}`, input, envOf({ BITDEER_API_KEY: 'k' })).body as any;
      expect(body.model).toBe(model);
      expect(body.reasoning_effort).toBe('low');
      expect(body.max_tokens).toBe(4096);
      expect(body.tool_choice).toBe('required');
    }
  });

  test('a bitdeer request matches the harness', () => {
    const call = buildModelCall('bitdeer:deepseek-ai/DeepSeek-V4.1-Flash', input, envOf({ BITDEER_API_KEY: 'k' }));
    const body = call.body as any;
    expect(call.url).toBe('https://api-inference.bitdeer.ai/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer k');
    expect(body.model).toBe('deepseek-ai/DeepSeek-V4.1-Flash');
    expect(body.max_tokens).toBe(200);
    expect(body.tool_choice).toBe('required');
    expect(body.reasoning_effort).toBe('none');
    expect(Object.keys(body.tools[0].function.parameters.properties).at(-1)).toBe('thought');
    expect(body.tools[0].function.parameters.required).toEqual(['x', 'thought']);
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: userMessage('Ada', obs) },
    ]);
  });

  test('an anthropic request uses the messages API', () => {
    const call = buildModelCall('anthropic:claude-haiku-4-5', input, envOf({ ANTHROPIC_API_KEY: 'k' }));
    const body = call.body as any;
    expect(call.api).toBe('anthropic');
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe('k');
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(body.tool_choice).toEqual({ type: 'any' });
    expect(body.tools[0].input_schema.required).toEqual(['x', 'thought']);
    expect(body.system).toBe('SYS');
    expect(body.max_tokens).toBe(200);
  });

  test('ender reads its URL from ENDER_BASE_URL, sends enable_thinking false, and needs no key', () => {
    const call = buildModelCall('ender:ender', input, envOf({ ENDER_BASE_URL: 'https://api.runpod.ai/v2/abc/openai/v1/' }));
    expect(call.url).toBe('https://api.runpod.ai/v2/abc/openai/v1/chat/completions');
    expect((call.body as any).chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(call.headers.authorization).toBeUndefined();
  });

  test('an openai request caps output with max_completion_tokens and turns reasoning off', () => {
    const body = buildModelCall('openai:gpt-6-luna', input, envOf({ OPENAI_API_KEY: 'k' })).body as any;
    expect(body.max_completion_tokens).toBe(200);
    expect(body.max_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBe('none');
  });

  test('a missing key names the variable', () => {
    expect(() => buildModelCall('bitdeer:m', input, envOf({}))).toThrow('bitdeer models need BITDEER_API_KEY');
  });

  test('an unknown provider says so', () => {
    expect(() => buildModelCall('nope:m', input, envOf({}))).toThrow("unknown provider 'nope' in modelId 'nope:m'");
  });
});

describe('decisionFromResponse', () => {
  const url = 'https://x/v1/chat/completions';

  test('an OpenAI tool call becomes a decision, with the thought split off', () => {
    const text = JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'move_to', arguments: '{"x":3,"thought":"go"}' } }] } }] });
    expect(decisionFromResponse('openai-chat', url, 200, text)).toEqual({ action: { name: 'move_to', args: { x: 3 } }, thought: 'go' });
  });

  test('an Anthropic tool_use block becomes a decision', () => {
    const text = JSON.stringify({ content: [{ type: 'text', text: 'hm' }, { type: 'tool_use', name: 'move_to', input: { x: 4, thought: 'east' } }] });
    expect(decisionFromResponse('anthropic', url, 200, text)).toEqual({ action: { name: 'move_to', args: { x: 4 } }, thought: 'east' });
  });

  test('an answer cut off before the tool call names the finish reason', () => {
    const text = JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '' } }] });
    expect(() => decisionFromResponse('openai-chat', url, 200, text)).toThrow(/finish_reason: length/);
  });

  test('an error page is reported with its status and body', () => {
    expect(() => decisionFromResponse('openai-chat', url, 502, '<html>bad gateway')).toThrow(`${url} answered 502: <html>bad gateway`);
  });

  test('a body that is not JSON is an error', () => {
    expect(() => decisionFromResponse('openai-chat', url, 200, 'not json')).toThrow();
  });
});
