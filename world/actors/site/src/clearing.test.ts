import { describe, expect, it, vi } from 'vitest';
import { MODEL_CATALOG } from '../../../shared/models';
import { clearingRoster, episodeVerdict, lobbyConfig, lobbyModels, parseSqlRows, warmEndpoint, warmTargets } from './clearing';

const models = [
  { id: 'script', label: 'Policy script', provider: 'script' },
  { id: 'deepseek', label: 'DeepSeek', provider: 'bitdeer', model: 'deepseek-ai/DeepSeek-V4.1-Flash', lobby: 'DeepSeek V4.1 Flash' },
  { id: 'ender', label: 'Ender', provider: 'custom', model: 'ender', lobby: 'Ender', database: 'ender:ender' },
  { id: 'opus', label: 'Opus', provider: 'anthropic', model: 'claude-opus-5-5', lobby: 'Claude 5.5' },
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', model: 'claude-haiku-5-5' },
];

describe('lobbyModels', () => {
  it('maps catalog names to the site model and the id the database asks', () => {
    const lobby = lobbyModels(models);
    expect(lobby.get('DeepSeek V4.1 Flash')).toMatchObject({ siteId: 'deepseek', databaseId: 'bitdeer:deepseek-ai/DeepSeek-V4.1-Flash' });
    expect(lobby.get('Ender')).toMatchObject({ siteId: 'ender', databaseId: 'ender:ender' });
    expect(lobby.has('GPT-6 Sol')).toBe(false);
  });

  it('refuses a lobby name the catalog does not have, and a custom model with no database id', () => {
    expect(() => lobbyModels([{ ...models[1], lobby: 'Grok 9' }])).toThrow('not a lobby model');
    expect(() => lobbyModels([{ ...models[2], database: undefined }])).toThrow('database');
  });
});

describe('lobbyConfig', () => {
  it('answers like the local runner: every catalog model, offered ones available, both scenarios', () => {
    const cfg = lobbyConfig(lobbyModels(models), { clearing: true });
    expect(cfg.ready).toBe(true);
    expect(cfg.models.map(m => m.id)).toEqual(MODEL_CATALOG.map(m => m.name));
    expect(cfg.models.find(m => m.id === 'Ender')).toEqual({ id: 'Ender', modelId: 'ender:ender', available: true });
    expect(cfg.models.find(m => m.id === 'GPT-6 Sol')).toMatchObject({ available: false, modelId: null });
    expect(cfg.scenarios.map(s => [s.id, s.available])).toEqual([['clearing-charter', true], ['ledger', true]]);
  });

  it('marks the Clearing unavailable without a SpacetimeDB login', () => {
    const cfg = lobbyConfig(lobbyModels(models), { clearing: false });
    expect(cfg.scenarios.find(s => s.id === 'clearing-charter')).toMatchObject({ available: false });
  });
});

describe('clearingRoster', () => {
  const lobby = lobbyModels(models);
  it('names the survivors in order and gives each the database model id', () => {
    expect(clearingRoster(lobby, [{ model: 'DeepSeek V4.1 Flash', count: 2 }, { model: 'Ender', count: 1 }])).toEqual([
      { name: 'Ivy', model_id: 'bitdeer:deepseek-ai/DeepSeek-V4.1-Flash' },
      { name: 'Rook', model_id: 'bitdeer:deepseek-ai/DeepSeek-V4.1-Flash' },
      { name: 'Sage', model_id: 'ender:ender' },
    ]);
  });

  it('refuses an empty lineup, more than four, and models the site does not offer', () => {
    expect(() => clearingRoster(lobby, [])).toThrow('at least one');
    expect(() => clearingRoster(lobby, [{ model: 'Ender', count: 5 }])).toThrow('four');
    expect(() => clearingRoster(lobby, [{ model: 'GPT-6 Sol', count: 1 }])).toThrow('not offered');
    expect(() => clearingRoster(lobby, [{ model: 'Ender', count: 1.5 }])).toThrow('four');
  });
});

describe('episodeVerdict', () => {
  it('runs until thirty game seconds have passed and the rescue resolved or every model survivor died', () => {
    expect(episodeVerdict({ gameTimeMs: 10_000, rescueState: 'arrived', alive: 4, streaks: [] })).toBe('running');
    expect(episodeVerdict({ gameTimeMs: 60_000, rescueState: 'waiting', alive: 2, streaks: [0, 1] })).toBe('running');
    expect(episodeVerdict({ gameTimeMs: 60_000, rescueState: 'departed', alive: 2, streaks: [] })).toBe('done');
    expect(episodeVerdict({ gameTimeMs: 60_000, rescueState: 'waiting', alive: 0, streaks: [] })).toBe('done');
  });

  it('stops early when every model keeps failing', () => {
    expect(episodeVerdict({ gameTimeMs: 5_000, rescueState: 'waiting', alive: 4, streaks: [5, 7] })).toBe('failing');
    expect(episodeVerdict({ gameTimeMs: 5_000, rescueState: 'waiting', alive: 4, streaks: [5, 2] })).toBe('running');
  });
});

describe('warmTargets', () => {
  const site = [
    ...models,
    { id: 'abliterated', label: 'Abliterated', provider: 'custom', model: 'abliterated', baseUrl: 'https://runpod.test/abl/v1', lobby: 'Abliterated', database: 'abliterated:abliterated' },
  ];
  it('lists the custom endpoints a lineup uses, once each, with their served model name', () => {
    expect(warmTargets(site, ['Ender', 'DeepSeek V4.1 Flash', 'Abliterated', 'Ender'], 'https://runpod.test/ender/v1')).toEqual([
      { name: 'Ender', url: 'https://runpod.test/ender/v1', model: 'ender' },
      { name: 'Abliterated', url: 'https://runpod.test/abl/v1', model: 'abliterated' },
    ]);
    expect(warmTargets(site, ['DeepSeek V4.1 Flash'], 'https://runpod.test/ender/v1')).toEqual([]);
  });
});

describe('warmEndpoint', () => {
  it('sends one tiny chat completion and reports whether the endpoint answered', async () => {
    const ok = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await warmEndpoint({ name: 'Ender', url: 'https://runpod.test/ender/v1/', model: 'ender' }, 'rp', 1000, ok)).toBe(true);
    const [url, init] = ok.mock.calls[0];
    expect(url).toBe('https://runpod.test/ender/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer rp');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'ender', max_tokens: 1 });
    expect(await warmEndpoint({ name: 'Ender', url: 'https://runpod.test/v1', model: 'ender' }, 'rp', 1000, vi.fn().mockResolvedValue(new Response('no', { status: 500 })))).toBe(false);
    expect(await warmEndpoint({ name: 'Ender', url: 'https://runpod.test/v1', model: 'ender' }, 'rp', 1000, vi.fn().mockRejectedValue(new Error('timeout')))).toBe(false);
  });
});

describe('parseSqlRows', () => {
  it('turns SpacetimeDB\'s SQL answer into objects', () => {
    const answer = [{ schema: { elements: [{ name: { some: 'rescue_state' } }, { name: { some: 'game_time_ms' } }] }, rows: [['waiting', 1234.5]] }];
    expect(parseSqlRows(answer)).toEqual([{ rescue_state: 'waiting', game_time_ms: 1234.5 }]);
    expect(parseSqlRows([])).toEqual([]);
  });
});
