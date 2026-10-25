// Starts the site Actor with its input built from .env, so no key is pasted
// into the Console. Prints field names only, never values.
//
//   npm run actors:site -- --check                 build and check the input, start nothing
//   npm run actors:site                            start the site (two days, 256 MB) and print its address
//   npm run actors:site -- --env ../../.env        read another .env (default: ./.env, then ../.env)
//   npm run actors:site -- --replace               abort a site run that's already going first
//
// Reads ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, BITDEER_API_KEY,
// FEATHERLESS_API_KEY (or FEATHERLESSAI_API_KEY), ENDER_BASE_URL, ENDER_API_KEY (or RUNPOD_API_KEY), CRS_USERNAME, CRS_PASSWORD
// and APIFY_TOKEN (or APIFY_API_KEY); the environment wins over the file.
// The models on offer are in models.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fieldReport, parseEnv, siteInputFromEnv } from './src/launch';
import { siteConfig, type SiteModel } from './src/runs';

const API = 'https://api.apify.com/v2';
const TIMEOUT_SECS = 172_800;
const MEMORY_MB = 256;
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const envFile = option('env') ?? ['.env', '../.env'].map(f => path.resolve(f)).find(f => fs.existsSync(f));
if (!envFile || !fs.existsSync(envFile)) fail(`No .env found${envFile ? ` at ${envFile}` : ' here or one folder up'}. Pass --env <path>.`);
const env = { ...parseEnv(fs.readFileSync(envFile!, 'utf-8')), ...process.env };
// The models file sits next to this script in the repo; the bundle runs from dist-harness/.
const modelsFile = option('models') ?? [path.join(here, 'models.json'), path.resolve('actors/site/models.json')].find(f => fs.existsSync(f));
const models = JSON.parse(fs.readFileSync(modelsFile ?? fail('No models.json: pass --models <path>.'), 'utf-8')) as SiteModel[];
const perHour = option('runs-per-hour');
const input = siteInputFromEnv(env, models, perHour ? { maxRunsPerHour: Number(perHour) } : {});

console.log(`Input from ${envFile}:\n${fieldReport(input)}`);
try {
  siteConfig(input);
} catch (err) {
  fail(`\nThe site would refuse this input: ${err instanceof Error ? err.message : String(err)}`);
}
console.log('The site accepts this input.');
if (flag('check')) process.exit(0);

const token = env.APIFY_TOKEN || env.APIFY_API_KEY || fail('No APIFY_TOKEN or APIFY_API_KEY in the environment or .env.');
async function api<T>(route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${route}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) fail(`Apify answered ${response.status} to ${route.split('?')[0]}: ${body?.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
  return body.data as T;
}

type Run = { id: string; status: string; statusMessage?: string; containerUrl?: string };
const me = await api<{ username: string }>('/users/me');
const actor = `${me.username}~enders-bench-site`;
const going = (await api<{ items: Run[] }>(`/acts/${actor}/runs?status=RUNNING&desc=true`)).items;
if (going.length && !flag('replace')) {
  const run = await api<Run>(`/actor-runs/${going[0].id}`);
  fail(`\nThe site is already running: ${run.containerUrl}/ (run ${run.id}). A new run gets a new address.\nPass --replace to abort it and start again.`);
}
for (const run of going) {
  await api(`/actor-runs/${run.id}/abort`, { method: 'POST' });
  console.log(`Aborted the running site ${run.id}.`);
}

const started = await api<Run>(`/acts/${actor}/runs?timeout=${TIMEOUT_SECS}&memory=${MEMORY_MB}`, { method: 'POST', body: JSON.stringify(input) });
console.log(`\nStarted ${started.id} (timeout ${TIMEOUT_SECS / 3600} h, ${MEMORY_MB} MB). Waiting for it to serve…`);
for (let i = 0; i < 60; i++) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  const run = await api<Run>(`/actor-runs/${started.id}`);
  if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) fail(`The site run ${run.status.toLowerCase()}: ${run.statusMessage ?? ''}\nLog: https://console.apify.com/view/runs/${run.id}`);
  if (run.status === 'RUNNING' && run.statusMessage?.startsWith('Serving')) {
    console.log(`\nThe site is up: ${run.containerUrl}/\nRun: https://console.apify.com/view/runs/${run.id}`);
    process.exit(0);
  }
}
fail(`The site run hasn't started serving after two minutes. Check its log: https://console.apify.com/view/runs/${started.id}`);
