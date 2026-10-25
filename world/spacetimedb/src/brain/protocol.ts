// One decision protocol for every brain, in the module and in the harness:
// the tools a model sees, the message it reads, the request each provider
// takes, and how its answer becomes an action. Pure: no SpacetimeDB or Node
// APIs, so the harness can import it and both sides ask exactly alike.

export type JsonSchema = {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
};

export type Tool = { name: string; description: string; parameters: JsonSchema };

export type Decision = {
  action: { name: string; args: Record<string, unknown> };
  thought: string;
};

export type DecideInput = {
  agentName: string;
  observation: any;
  tools: Tool[];
  system: string;
};

export const MAX_OUTPUT_TOKENS = 200;

// Every tool gets a short required `thought`, last, so the action fields
// stream first and the reasoning stays one line.
export function withThought(tools: Tool[]): Tool[] {
  return tools.map(tool => ({
    ...tool,
    parameters: {
      ...tool.parameters,
      properties: {
        ...tool.parameters.properties,
        thought: { type: 'string', description: 'Why, in 12 words or fewer.' },
      },
      required: [...(tool.parameters.required ?? []), 'thought'],
    },
  }));
}

export function toDecision(name: string, rawArgs: Record<string, unknown>): Decision {
  const { thought, ...args } = rawArgs;
  return { action: { name, args }, thought: typeof thought === 'string' ? thought : '' };
}

export function userMessage(agentName: string, observation: unknown) {
  return `You are ${agentName}. Current observation (JSON):\n${JSON.stringify(observation)}\n\nChoose your next action by calling exactly one tool.`;
}

export type ProviderSpec = {
  api: 'openai-chat' | 'anthropic';
  baseUrl?: string; // fixed, or the default when baseUrlEnv is unset
  baseUrlEnv?: string;
  keyEnv?: string;
  keyOptional?: boolean;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'; // default max_tokens
  extraBody?: Record<string, unknown>;
};

export const PROVIDERS: Record<string, ProviderSpec> = {
  // Current OpenAI models refuse max_tokens ("Use 'max_completion_tokens' instead"), and refuse
  // function tools with reasoning on chat completions ("set reasoning_effort to 'none'").
  openai: { api: 'openai-chat', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', maxTokensField: 'max_completion_tokens', extraBody: { reasoning_effort: 'none' } },
  openrouter: { api: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  // DeepSeek on Bitdeer reasons by default, and the reasoning counts against
  // max_tokens: at MAX_OUTPUT_TOKENS it never reaches the tool call.
  bitdeer: { api: 'openai-chat', baseUrl: 'https://api-inference.bitdeer.ai/v1', keyEnv: 'BITDEER_API_KEY', extraBody: { reasoning_effort: 'none' } },
  // Ender is a Qwen3 fine-tune on vLLM (Runpod: https://api.runpod.ai/v2/<endpoint>/openai/v1,
  // model "ender"). Qwen3 thinks by default and runs out of max_tokens before answering.
  ender: { api: 'openai-chat', baseUrlEnv: 'ENDER_BASE_URL', keyEnv: 'ENDER_API_KEY', keyOptional: true, extraBody: { chat_template_kwargs: { enable_thinking: false } } },
  ollama: { api: 'openai-chat', baseUrlEnv: 'OLLAMA_BASE_URL', baseUrl: 'http://localhost:11434/v1' },
  anthropic: { api: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', keyEnv: 'ANTHROPIC_API_KEY' },
};

// The providers the module can call itself. Codex runs a CLI and fake runs
// locally, so they stay with the harness; ollama is usually on localhost.
export const DATABASE_PROVIDERS = ['bitdeer', 'openai', 'anthropic', 'openrouter', 'ender'];

// "provider:model", e.g. "bitdeer:deepseek-ai/DeepSeek-V4.1-Flash".
export function splitModelId(modelId: string) {
  const sep = modelId.indexOf(':');
  return sep < 0 ? { provider: modelId, model: '' } : { provider: modelId.slice(0, sep), model: modelId.slice(sep + 1) };
}

type Env = (name: string) => string | undefined;

export function providerEndpoint(provider: string, env: Env) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`unknown provider '${provider}'`);
  const baseUrl = (spec.baseUrlEnv && env(spec.baseUrlEnv)) || spec.baseUrl;
  if (!baseUrl) throw new Error(`${provider} models need ${spec.baseUrlEnv}`);
  const key = spec.keyEnv ? env(spec.keyEnv) || undefined : undefined;
  if (spec.keyEnv && !key && !spec.keyOptional) throw new Error(`${provider} models need ${spec.keyEnv}`);
  return { spec, baseUrl: baseUrl.replace(/\/$/, ''), key };
}

export function openAiChatBody(model: string, input: DecideInput, extraBody?: Record<string, unknown>, maxTokensField: ProviderSpec['maxTokensField'] = 'max_tokens') {
  return {
    model,
    [maxTokensField]: MAX_OUTPUT_TOKENS,
    tool_choice: 'required',
    tools: withThought(input.tools).map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: userMessage(input.agentName, input.observation) },
    ],
    ...extraBody,
  };
}

export function anthropicBody(model: string, input: DecideInput) {
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    // The system prompt is identical on every call, so it is cached.
    system: input.system,
    tool_choice: { type: 'any' },
    tools: withThought(input.tools).map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    messages: [{ role: 'user', content: userMessage(input.agentName, input.observation) }],
  };
}

export function parseOpenAiChat(reply: any): Decision {
  const call = reply?.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!call?.name) throw new Error(`model answered without calling a tool (finish_reason: ${reply?.choices?.[0]?.finish_reason ?? 'none'})`);
  let args: Record<string, unknown> = {};
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {};
  } catch {
    throw new Error(`tool arguments are not JSON: ${String(call.arguments).slice(0, 200)}`);
  }
  return toDecision(call.name, args);
}

export function parseAnthropic(reply: any): Decision {
  const use = (reply?.content ?? []).find((b: any) => b.type === 'tool_use');
  if (!use) throw new Error(`model answered without calling a tool (stop_reason: ${reply?.stop_reason ?? 'none'})`);
  return toDecision(use.name, use.input ?? {});
}

export type ModelCall = { api: ProviderSpec['api']; url: string; headers: Record<string, string>; body: unknown };

export function buildModelCall(modelId: string, input: DecideInput, env: Env): ModelCall {
  const { provider, model } = splitModelId(modelId);
  if (!PROVIDERS[provider]) throw new Error(`unknown provider '${provider}' in modelId '${modelId}'`);
  const { spec, baseUrl, key } = providerEndpoint(provider, env);
  if (spec.api === 'anthropic') {
    return { api: 'anthropic', url: `${baseUrl}/messages`, headers: { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' }, body: anthropicBody(model, input) };
  }
  return { api: 'openai-chat', url: `${baseUrl}/chat/completions`, headers: key ? { authorization: `Bearer ${key}` } : {}, body: openAiChatBody(model, input, spec.extraBody, spec.maxTokensField) };
}

export function decisionFromResponse(api: ModelCall['api'], url: string, status: number, text: string): Decision {
  if (status < 200 || status >= 300) throw new Error(`${url} answered ${status}: ${text.slice(0, 300)}`);
  let reply: unknown;
  try {
    reply = JSON.parse(text);
  } catch {
    throw new Error(`${url} answered with something other than JSON: ${text.slice(0, 200)}`);
  }
  return api === 'anthropic' ? parseAnthropic(reply) : parseOpenAiChat(reply);
}
