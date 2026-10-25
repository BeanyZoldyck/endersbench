// The site's input built from the keys we already keep in .env, under the
// harness's names, so starting the site doesn't mean pasting each key into the
// Console. Apify encrypts the isSecret fields of an input sent through the API,
// the same as ones typed into the form.
import type { SiteInput, SiteModel } from './runs';

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return env;
}

export function siteInputFromEnv(env: Record<string, string | undefined>, models: SiteModel[], extra: Partial<SiteInput> = {}): SiteInput {
  const value = (name: string) => env[name]?.trim() || undefined;
  const crsUsername = value('CRS_USERNAME'), crsPassword = value('CRS_PASSWORD');
  const crsLive = !!(crsUsername && crsPassword);
  const input: SiteInput = {
    models,
    anthropicApiKey: value('ANTHROPIC_API_KEY'),
    openaiApiKey: value('OPENAI_API_KEY'),
    openrouterApiKey: value('OPENROUTER_API_KEY'),
    bitdeerApiKey: value('BITDEER_API_KEY'),
    // The harness reads FEATHERLESSAI_API_KEY; take the shorter name too.
    featherlessApiKey: value('FEATHERLESS_API_KEY') ?? value('FEATHERLESSAI_API_KEY'),
    // The fine-tune: the harness calls it ender (ENDER_BASE_URL, ENDER_API_KEY).
    customBaseUrl: value('ENDER_BASE_URL'),
    customApiKey: value('ENDER_API_KEY') ?? value('RUNPOD_API_KEY'),
    crsLive,
    ...(crsLive ? { crsUsername, crsPassword } : {}),
    // The shared world's owner login, so the setup page can start Clearing runs on Maincloud.
    spacetimeToken: value('SPACETIMEDB_TOKEN'),
    // Starting a run asks for this; browsing and watching don't.
    runPassword: value('RUN_PASSWORD'),
    ...extra,
  };
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as SiteInput;
}

const REPORTED: (keyof SiteInput)[] = ['anthropicApiKey', 'openaiApiKey', 'openrouterApiKey', 'bitdeerApiKey', 'featherlessApiKey', 'customBaseUrl', 'customApiKey', 'crsUsername', 'crsPassword', 'spacetimeToken', 'runPassword'];

// What the input holds, by field name only: safe to print.
export function fieldReport(input: SiteInput): string {
  return [
    `models: ${(input.models ?? []).map(m => m.id).join(', ')}`,
    ...REPORTED.map(name => `${name}: ${input[name] ? 'set' : 'missing'}`),
    `crsLive: ${input.crsLive === true}`,
  ].join('\n');
}
