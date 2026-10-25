import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import type { ModelName, BenchmarkScenario } from './types.js';
import { MODEL_CATALOG, exactModelName } from '../../shared/models.js';
import { providerEndpoint } from '../../spacetimedb/src/brain/protocol.js';
import { BENCHMARK_SCENARIOS } from './scenarios.js';

type Environment = Record<string, string | undefined>;
const PROVIDERS = new Set(['ender', 'openai', 'openrouter', 'anthropic', 'codex', 'ollama', 'bitdeer', 'featherless', 'abliterated']);

export function validModelId(value: string | null | undefined): value is string {
  if (!value || value.length > 160 || /[\s\x00-\x1f]/.test(value)) return false;
  const match = /^([a-z][a-z0-9-]*):([A-Za-z0-9][A-Za-z0-9._/:-]*)$/.exec(value);
  return !!match && PROVIDERS.has(match[1]);
}

export function modelConfig(env: Environment): Array<{ id: ModelName; modelId: string | null; available: boolean; reason?: string }> {
  return MODEL_CATALOG.map(model => {
    const explicit = env[model.env]?.trim();
    const legacy = env[model.legacyEnv]?.trim();
    // Reuse old family configuration only for its exact model variant.
    const candidate = explicit || (legacy && exactModelName(legacy) === model.name ? legacy : null);
    const id = model.name;
    if (!validModelId(candidate)) return { id, modelId: null, available: false, reason: candidate ? 'Use a supported provider:model mapping.' : `Set ${model.env} to provider:model.` };
    const identity = exactModelName(candidate);
    const customEnder = id === 'Ender' && candidate.startsWith('ender:') && identity === null;
    if (identity !== id && !customEnder && id !== 'Abliterated') return { id, modelId: null, available: false, reason: `The configured mapping must identify ${id}.` };
    try {
      if (!candidate.startsWith('codex:')) providerEndpoint(candidate.split(':')[0], name => env[name]);
      return { id, modelId: candidate, available: true };
    } catch {
      return { id, modelId: candidate, available: false, reason: 'The configured provider needs its server-side connection settings.' };
    }
  });
}

export async function executable(env: Environment): Promise<string | null> {
  const configured = env.BENCHMARK_SPACETIME_BIN?.trim();
  const candidates = configured ? [configured] : (env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'spacetime'));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* try the next PATH entry */ }
  }
  return null;
}

export function localSpacetimeAvailable(timeoutMs = 800): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: 3000 });
    const done = (available: boolean): void => { socket.destroy(); resolve(available); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}

export async function benchmarkConfig(env: Environment, probe = localSpacetimeAvailable): Promise<{
  models: ReturnType<typeof modelConfig>;
  scenarios: BenchmarkScenario[];
  ready: boolean;
  reason?: string;
}> {
  const models = modelConfig(env);
  const [bin, server] = await Promise.all([executable(env), probe()]);
  const reason = Number(process.versions.node.split('.')[0]) < 22 ? 'The benchmark runner requires Node.js 22 or newer.'
    : !bin ? 'SpacetimeDB CLI is unavailable. Set BENCHMARK_SPACETIME_BIN.'
    : !server ? 'Local SpacetimeDB server is unavailable at 127.0.0.1:3000.'
    : !models.some(model => model.available) ? 'Configure at least one benchmark model.' : undefined;
  return {
    models,
    scenarios: BENCHMARK_SCENARIOS.map(scenario => ({ ...scenario })),
    ready: !reason,
    ...(reason ? { reason } : {}),
  };
}
