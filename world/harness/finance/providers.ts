// How the finance harness reaches a model, shared by the bench runner (run.ts)
// and the world's desk (desk.ts): settings from the environment or .env, the
// OpenAI-compatible providers, and the certificate store.
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import type { OpenAiApi } from './drivers';

// A setting from the environment, else from world/.env or the repo's .env.
export function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  for (const file of [path.resolve('.env'), path.resolve('..', '.env')]) {
    if (!fs.existsSync(file)) continue;
    const line = fs
      .readFileSync(file, 'utf-8')
      .split(/\r?\n/)
      .find(l => l.trim().startsWith(`${name}=`));
    const value = line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  }
  return undefined;
}

// OpenAI-compatible providers, the same table as the forest harness.
export const OPENAI_COMPATIBLE: Record<string, { baseUrl: () => string | undefined; key: () => string | undefined; needs: string; api?: OpenAiApi }> = {
  openai: { baseUrl: () => 'https://api.openai.com/v1', key: () => envValue('OPENAI_API_KEY'), needs: 'OPENAI_API_KEY', api: 'responses' },
  openrouter: { baseUrl: () => 'https://openrouter.ai/api/v1', key: () => envValue('OPENROUTER_API_KEY'), needs: 'OPENROUTER_API_KEY' },
  ender: { baseUrl: () => envValue('ENDER_BASE_URL'), key: () => envValue('ENDER_API_KEY') ?? '', needs: 'ENDER_BASE_URL' },
  ollama: { baseUrl: () => envValue('OLLAMA_BASE_URL') ?? 'http://localhost:11434/v1', key: () => '', needs: 'OLLAMA_BASE_URL' },
};

// Trust the OS certificate store as well as Node's own. Security software
// that inspects TLS (CrowdStrike on Sid's laptop) signs with a root only the
// OS knows. The API exists from Node 22.15.
export function trustSystemCertificates() {
  if (typeof tls.setDefaultCACertificates !== 'function') return;
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
}
