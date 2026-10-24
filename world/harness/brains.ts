// A brain turns one observation into one action. The harness picks a brain
// from the agent's modelId ("provider:model"), so plugging in a new model is
// a roster change, not a code change.

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

export interface Brain {
  provider: string;
  decide(input: DecideInput): Promise<Decision>;
}

type FetchImpl = typeof fetch;

const MAX_OUTPUT_TOKENS = 200;

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

function toDecision(name: string, rawArgs: Record<string, unknown>): Decision {
  const { thought, ...args } = rawArgs;
  return { action: { name, args }, thought: typeof thought === 'string' ? thought : '' };
}

function userMessage(input: DecideInput) {
  return `You are ${input.agentName}. Current observation (JSON):\n${JSON.stringify(input.observation)}\n\nChoose your next action by calling exactly one tool.`;
}

async function postJson(fetchImpl: FetchImpl, url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export function openAiCompatibleBrain(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchImpl;
}): Brain {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    provider: 'openai-compatible',
    async decide(input) {
      const reply: any = await postJson(
        fetchImpl,
        `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`,
        opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
        {
          model: opts.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          tool_choice: 'required',
          tools: withThought(input.tools).map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: userMessage(input) },
          ],
        }
      );
      const call = reply?.choices?.[0]?.message?.tool_calls?.[0]?.function;
      if (!call?.name) throw new Error('model answered without calling a tool');
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        throw new Error(`tool arguments are not JSON: ${String(call.arguments).slice(0, 200)}`);
      }
      return toDecision(call.name, args);
    },
  };
}

export function anthropicBrain(opts: { apiKey: string; model: string; fetchImpl?: FetchImpl }): Brain {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    provider: 'anthropic',
    async decide(input) {
      const reply: any = await postJson(
        fetchImpl,
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: opts.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          // The system prompt is identical on every call, so it is cached.
          system: input.system,
          tool_choice: { type: 'any' },
          tools: withThought(input.tools).map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
          messages: [{ role: 'user', content: userMessage(input) }],
        }
      );
      const use = (reply?.content ?? []).find((b: any) => b.type === 'tool_use');
      if (!use) throw new Error('model answered without calling a tool');
      return toDecision(use.name, use.input ?? {});
    },
  };
}

// Random valid actions with a simulated model delay, for development and load tests.
export function fakeBrain(opts: { latencyMs: [number, number] }): Brain {
  const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  const lines = ['Anyone seen food around here?', 'Nice day for a walk.', 'Want to team up?', 'I am heading north.', 'Hello!'];
  return {
    provider: 'fake',
    async decide({ observation, tools }) {
      const [lo, hi] = opts.latencyMs;
      await new Promise(r => setTimeout(r, lo + Math.random() * (hi - lo)));
      const names = new Set(tools.map(t => t.name));
      const me = observation.you;
      const nearby: any[] = observation.nearby?.agents ?? [];
      const roll = Math.random();
      if (names.has('say') && roll < 0.2) {
        return { action: { name: 'say', args: { text: pick(lines) } }, thought: 'making conversation' };
      }
      if (names.has('follow') && nearby.length > 0 && roll < 0.35) {
        const who = pick(nearby);
        return { action: { name: 'follow', args: { agent_id: who.id } }, thought: `sticking with ${who.name}` };
      }
      if (names.has('move_to') && roll < 0.9) {
        const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
        const x = clamp(me.x + (Math.random() - 0.5) * 20, observation.map.width);
        const y = clamp(me.y + (Math.random() - 0.5) * 20, observation.map.height);
        return { action: { name: 'move_to', args: { x, y } }, thought: 'exploring' };
      }
      return { action: { name: 'idle', args: {} }, thought: 'resting' };
    },
  };
}

const OPENAI_COMPATIBLE: Record<string, { baseUrl: (env: Env) => string | undefined; key: (env: Env) => string | undefined; needs: string }> = {
  openai: { baseUrl: () => 'https://api.openai.com/v1', key: env => env.OPENAI_API_KEY, needs: 'OPENAI_API_KEY' },
  openrouter: { baseUrl: () => 'https://openrouter.ai/api/v1', key: env => env.OPENROUTER_API_KEY, needs: 'OPENROUTER_API_KEY' },
  ender: { baseUrl: env => env.ENDER_BASE_URL, key: env => env.ENDER_API_KEY ?? '', needs: 'ENDER_BASE_URL' },
  ollama: { baseUrl: env => env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1', key: () => '', needs: 'OLLAMA_BASE_URL' },
};

type Env = Record<string, string | undefined>;

// modelId is "fake" or "provider:model", e.g. "ender:qwen3.8-27b",
// "anthropic:claude-haiku-4-5", "openrouter:google/gemini-2.5-flash".
export function brainFor(modelId: string, env: Env): Brain {
  if (modelId === 'fake' || modelId.startsWith('fake:')) {
    const [lo, hi] = (env.FAKE_LATENCY_MS ?? '600-2500').split('-').map(Number);
    return fakeBrain({ latencyMs: [lo, hi ?? lo] });
  }
  const sep = modelId.indexOf(':');
  const provider = sep < 0 ? modelId : modelId.slice(0, sep);
  const model = sep < 0 ? '' : modelId.slice(sep + 1);
  if (provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('anthropic models need ANTHROPIC_API_KEY');
    return anthropicBrain({ apiKey: env.ANTHROPIC_API_KEY, model });
  }
  const spec = OPENAI_COMPATIBLE[provider];
  if (!spec) throw new Error(`unknown provider '${provider}' in modelId '${modelId}'`);
  const baseUrl = spec.baseUrl(env);
  const apiKey = spec.key(env);
  if (!baseUrl || apiKey === undefined) throw new Error(`${provider} models need ${spec.needs}`);
  return openAiCompatibleBrain({ baseUrl, apiKey, model });
}
