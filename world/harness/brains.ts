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

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

// How often an idle, fed fake survivor goes exploring.
const EXPLORE_CHANCE = 0.15;

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
      const hungry = (me.fullness ?? 100) < 60;
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

      // Danger first: a hunting wolf sends you to the nearest lit fire, or into a fight.
      const fires0: any[] = o.nearby?.fires ?? [];
      const hunter = (o.nearby?.wolves ?? []).find((w: any) => w.doing === 'hunting you');
      if (hunter) {
        const refuge = fires0.filter(f => f.lit).sort((a, b) => a.distance - b.distance)[0];
        const d = refuge
          ? act('move_to', { x: refuge.x, y: refuge.y }, 'wolf! run to the fire')
          : act('attack', { wolf_id: hunter.id }, 'fight off the wolf');
        if (d) return d;
      }
      const pinned = agents.filter(a => a.pinned).sort((a, b) => a.distance - b.distance)[0];
      if (pinned && !me.pinned) {
        const d = act('help', { agent_id: pinned.id }, `${pinned.name} is trapped`);
        if (d) return d;
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

      // Rules v11: make a weapon whenever the world says one can be made (it is listed in
      // `you.canCraft` only then), before the wood goes into a fire or the shelter.
      if (me.canCraft) {
        const d = act('craft', { item: String(me.canCraft).replace(/ /g, '_') }, `making a ${me.canCraft}`);
        if (d) return d;
      }

      const fires: any[] = o.nearby?.fires ?? [];
      const wood = inv.wood ?? 0;
      const fireInReach = fires.find(f => f.distance <= 2 && (f.lit || f.woodNeeded > 0));
      if (wood > 0 && fireInReach) {
        const d = act('feed_fire', { structure_id: fireInReach.id, qty: wood }, 'keeping the fire going');
        if (d) return d;
      }
      // The shelter around the hearth: carry wood to it, build, and band together inside at night.
      const shelter = o.shelter;
      if (shelter && !shelter.built && wood > 0) {
        const d = shelter.distance <= shelter.radius + 1
          ? act('build', { structure_id: shelter.id, qty: wood }, 'building the shelter')
          : act('move_to', { x: shelter.x, y: shelter.y }, 'taking wood to the shelter');
        if (d) return d;
      }
      if (shelter?.built && !shelter.youAreInside && o.time?.daylight === 'night') {
        const d = act('move_to', { x: shelter.x, y: shelter.y }, 'safer together in the shelter');
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

      // Rules v11: a plain spear becomes a flaming spear at a lit fire, so take it to the
      // nearest. A walk to a fire stops 2.3 tiles from its centre; there `you.canCraft`
      // offers the flaming spear, and the craft rule above makes it.
      if (inv.spear && !inv.flaming_spear && litFire && litFire.distance > 2.5) {
        const d = act('move_to', { x: litFire.x, y: litFire.y }, 'making my spear a flaming spear');
        if (d) return d;
      }

      // Rules v11: now and then, with nothing else to do and a full belly, walk into the unseen forest.
      if (me.doing === 'idle' && !hungry && Math.random() < EXPLORE_CHANCE) {
        const d = act('explore', {}, 'seeing what is out there');
        if (d) return d;
      }

      const roll = Math.random();
      if (roll < 0.15) {
        const d = act('say', { text: pick(lines) }, 'making conversation');
        if (d) return d;
      }
      if (roll < 0.35) {
        // Wood first while the shelter still needs it.
        const wanted = o.shelter && !o.shelter.built ? resources.filter(r => r.kind === 'tree' && r.remaining > 0) : [];
        const node = [...wanted, ...resources.filter(r => r.remaining > 0)][0];
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

// Codex CLI: a model reached through a Codex login rather than an API key.
// One `codex exec` per decision, held to a JSON schema; read-only sandbox,
// empty working directory, no saved session and none of the login's MCP
// servers, so it can only answer. The game's system prompt replaces Codex's
// coding-agent instructions.
export type CodexRun = (call: { instructions: string; prompt: string; model: string; codexHome?: string; schema: any; effort: string }) => Promise<string>;

const CODEX_TIMEOUT_MS = 60_000;

// The line that says what went wrong, not the sandbox notice Codex prints on
// every run (which used to crowd the real error out of a short tail).
export function codexError(stderr: string) {
  const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean).filter(l => !/bubblewrap|sandboxing#prerequisites/i.test(l));
  const real = lines.filter(l => /error|forbidden|denied|limit|refused|timed out|unauthori/i.test(l));
  return (real.at(-1) ?? lines.at(-1) ?? 'no output').slice(0, 300);
}

// Server names from `[mcp_servers.<name>]` headers, ignoring their sub-tables.
export function mcpServerNames(configToml: string) {
  const names = new Set<string>();
  for (const m of configToml.matchAll(/^\s*\[mcp_servers\.("[^"]+"|[A-Za-z0-9_-]+)/gm)) names.add(m[1].replace(/^"|"$/g, ''));
  return [...names];
}

const runCodexCli: CodexRun = async ({ instructions, prompt, model, codexHome, schema, effort }) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'endersbench-codex-'));
  try {
    const schemaFile = path.join(dir, 'schema.json'), out = path.join(dir, 'reply.json'), instructionsFile = path.join(dir, 'instructions.md');
    await writeFile(schemaFile, JSON.stringify(schema));
    await writeFile(instructionsFile, instructions);
    const home = codexHome ?? path.join(process.env.HOME ?? '', '.codex');
    const servers = mcpServerNames(await readFile(path.join(home, 'config.toml'), 'utf-8').catch(() => ''));
    const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', dir, '-m', model,
      '-c', `model_reasoning_effort=${effort}`, '-c', `model_instructions_file=${JSON.stringify(instructionsFile)}`,
      ...servers.flatMap(name => ['-c', `mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name)}.enabled=false`]),
      '--output-schema', schemaFile, '-o', out, '-'];
    await new Promise<void>((resolve, reject) => {
      const child = spawn('codex', args, { env: codexHome ? { ...process.env, CODEX_HOME: codexHome } : process.env, stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
      const timer = setTimeout(() => child.kill('SIGTERM'), CODEX_TIMEOUT_MS);
      child.on('error', err => { clearTimeout(timer); reject(err); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`codex exec exited ${code}: ${codexError(stderr)}`)); });
      child.stdin.end(prompt);
    });
    return await readFile(out, 'utf-8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export function codexBrain(opts: { model: string; codexHome?: string; effort?: string; run?: CodexRun }): Brain {
  const run = opts.run ?? runCodexCli;
  return {
    provider: 'codex',
    async decide(input) {
      const names = input.tools.map(t => t.name);
      const schema = {
        type: 'object',
        properties: {
          action: { type: 'string', enum: names },
          args_json: { type: 'string', description: "The chosen tool's arguments as a JSON object, encoded as a string." },
          thought: { type: 'string', description: 'Why, in 12 words or fewer.' },
        },
        required: ['action', 'args_json', 'thought'],
        additionalProperties: false,
      };
      const catalog = input.tools.map(t => JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters })).join('\n');
      // The game's actions are listed here, not offered as callable tools, so
      // the request asks for an answer rather than a tool call.
      const prompt = `Your available actions (each with its arguments):\n${catalog}\n\n` +
        `You are ${input.agentName}. Current observation (JSON):\n${JSON.stringify(input.observation)}\n\n` +
        'Choose your next action by replying with one JSON object: "action" is the action name, "args_json" its arguments ' +
        'encoded as a JSON string, "thought" your reason. Your reply is the action; there is nothing to call. Do not run commands or read files.';
      const reply = JSON.parse(await run({ instructions: input.system, prompt, model: opts.model, codexHome: opts.codexHome, schema, effort: opts.effort ?? 'low' }));
      if (!names.includes(reply.action)) throw new Error(`codex chose '${reply.action}', which is not an offered action`);
      let args: unknown;
      try { args = JSON.parse(reply.args_json); } catch { args = null; }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(`codex args are not a JSON object: ${String(reply.args_json).slice(0, 80)}`);
      return { action: { name: reply.action, args: args as Record<string, unknown> }, thought: typeof reply.thought === 'string' ? reply.thought : '' };
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
// "anthropic:claude-haiku-4-5", "openrouter:google/gemini-2.5-flash",
// "codex:gpt-6-luna" (set CODEX_HOME to pick the Codex login, e.g. ~/.codex-mdl).
export function brainFor(modelId: string, env: Env): Brain {
  if (modelId === 'fake' || modelId.startsWith('fake:')) {
    const [lo, hi] = (env.FAKE_LATENCY_MS ?? '600-2500').split('-').map(Number);
    return fakeBrain({ latencyMs: [lo, hi ?? lo], mischief: Number(env.FAKE_MISCHIEF ?? 0.05) });
  }
  const sep = modelId.indexOf(':');
  const provider = sep < 0 ? modelId : modelId.slice(0, sep);
  const model = sep < 0 ? '' : modelId.slice(sep + 1);
  if (provider === 'codex') return codexBrain({ model, codexHome: env.CODEX_HOME, effort: env.CODEX_EFFORT });
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
