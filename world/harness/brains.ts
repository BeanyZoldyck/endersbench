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

// A scripted stand-in for a model, for development and load tests: it survives
// sensibly and, with probability `mischief`, steals or attacks so detectors and
// event captions have something to show. Never present its output as a model's.
export function fakeBrain(opts: { latencyMs: [number, number]; mischief?: number }): Brain {
  const mischief = opts.mischief ?? 0.05;
  const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  const lines = ['Anyone seen food around here?', 'Winter is coming, we should stock up.', 'Want to team up?', 'I found berries to the north.', 'Stay warm, everyone.'];
  return {
    provider: 'fake',
    async decide({ observation: o, tools }) {
      const [lo, hi] = opts.latencyMs;
      await new Promise(r => setTimeout(r, lo + Math.random() * (hi - lo)));
      const can = new Set(tools.map(t => t.name));
      const act = (name: string, args: Record<string, unknown>, thought: string): Decision | null =>
        can.has(name) ? { action: { name, args }, thought } : null;

      const me = o.you ?? {};
      const inv: Record<string, number> = me.inventory ?? {};
      const agents: any[] = o.nearby?.agents ?? [];
      const containers: any[] = o.nearby?.containers ?? [];
      const resources: any[] = o.nearby?.resources ?? [];
      const hungry = (me.hunger ?? 100) < 60;
      const food = inv.ration ? 'ration' : inv.berries ? 'berries' : null;

      if (Math.random() < mischief) {
        const foreign = containers.filter(c => c.kind === 'chest' && c.owner !== 'you');
        const reachable = foreign.find(c => c.contents && Object.keys(c.contents).length);
        if (reachable) {
          const item = Object.keys(reachable.contents)[0];
          const d = act('take', { container_id: reachable.id, item, qty: 1 }, 'nobody is watching');
          if (d) return d;
        }
        if (foreign.length) {
          const d = act('move_to', { x: foreign[0].x, y: foreign[0].y }, `checking ${foreign[0].owner}'s chest`);
          if (d) return d;
        }
        if (agents.length && Math.random() < 0.3) {
          const d = act('attack', { agent_id: pick(agents).id }, 'they look weak');
          if (d) return d;
        }
      }

      const critical = agents.filter(a => a.health === 'critical').sort((a, b) => a.distance - b.distance)[0];
      if (inv.medkit && critical && critical.distance <= 2) {
        const d = act('heal', { agent_id: critical.id }, `${critical.name} needs help`);
        if (d) return d;
      }
      if (inv.medkit && critical) {
        const d = act('move_to', { x: critical.x, y: critical.y }, `going to help ${critical.name}`);
        if (d) return d;
      }

      const fires: any[] = o.nearby?.fires ?? [];
      const wood = inv.wood ?? 0;
      const fireInReach = fires.find(f => f.distance <= 2 && (f.lit || f.woodNeeded > 0));
      if (wood > 0 && fireInReach) {
        const d = act('feed_fire', { structure_id: fireInReach.id, qty: wood }, 'keeping the fire going');
        if (d) return d;
      }
      const unbuiltSignal = fires.find(f => f.kind === 'signal_fire' && f.woodNeeded > 0);
      if (wood >= 3 && unbuiltSignal) {
        const d = act('move_to', { x: unbuiltSignal.x, y: unbuiltSignal.y }, 'building the signal fire');
        if (d) return d;
      }
      const litFire = fires.filter(f => f.lit).sort((a, b) => a.distance - b.distance)[0];
      if ((me.warmth ?? 100) < 50 && litFire && litFire.distance > 4) {
        const d = act('move_to', { x: litFire.x, y: litFire.y }, 'need to warm up');
        if (d) return d;
      }

      if (hungry && food) {
        const d = act('eat', { item: food }, 'so hungry');
        if (d) return d;
      }
      if (hungry) {
        const bush = resources.filter(r => r.kind === 'berry_bush' && r.remaining > 0).sort((a, b) => a.distance - b.distance)[0];
        if (bush) {
          const d = act('gather', { node_id: bush.id }, 'berries nearby');
          if (d) return d;
        }
        const mine = containers.find(c => c.owner === 'you' && c.contents && (c.contents.berries || c.contents.ration));
        if (mine) {
          const d = act('take', { container_id: mine.id, item: mine.contents.ration ? 'ration' : 'berries', qty: 1 }, 'eating from my stash');
          if (d) return d;
        }
        if (me.home) {
          const d = act('move_to', { x: me.home.x, y: me.home.y }, 'heading home for food');
          if (d) return d;
        }
      }

      const roll = Math.random();
      if (roll < 0.15) {
        const d = act('say', { text: pick(lines) }, 'making conversation');
        if (d) return d;
      }
      if (roll < 0.35) {
        const node = resources.filter(r => r.remaining > 0)[0];
        if (node) {
          const d = act('gather', { node_id: node.id }, 'stocking up for winter');
          if (d) return d;
        }
      }
      if (roll < 0.85 && me.x !== undefined) {
        const clamp = (v: number) => Math.min(Math.max(v, 1), (o.map?.centre?.x ?? 32) * 2 - 1);
        const d = act('move_to', { x: clamp(me.x + (Math.random() - 0.5) * 20), y: clamp(me.y + (Math.random() - 0.5) * 20) }, 'exploring');
        if (d) return d;
      }
      return act('idle', {}, 'resting') ?? { action: { name: tools[0]?.name ?? 'idle', args: {} }, thought: '' };
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
    return fakeBrain({ latencyMs: [lo, hi ?? lo], mischief: Number(env.FAKE_MISCHIEF ?? 0.05) });
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
