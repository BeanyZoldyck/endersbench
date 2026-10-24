import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseReplay, duration } from '../replay';
import { stateAt } from '../useReplay';
import { buildPresentation, buildResults } from './presentation';

const fixture = parseReplay(JSON.parse(gunzipSync(readFileSync(new URL('../../public/demo/clearing-charter-v8-admission.json.gz', import.meta.url))).toString('utf8')) as unknown);
const early = stateAt(fixture, 0);
const final = stateAt(fixture, duration(fixture));

describe('data-driven Studio presentation', () => {
  it('does not invent narration or spotlight beats without world data', () => {
    expect(buildPresentation(null).beats).toEqual([]);
    expect(buildPresentation(null).narration).toBe('');
  });
  it('uses the current snapshot instead of future recorded events', () => {
    const before = buildPresentation(early);
    const after = buildPresentation(final);
    expect(before.beats.every(beat => beat.gameTimeMs <= (early.world?.gameTimeMs ?? 0))).toBe(true);
    expect(after.beats.length).toBeGreaterThan(before.beats.length);
    expect(after.beats.some(beat => beat.thought?.includes('fair share'))).toBe(true);
    expect(before.narration).not.toBe(after.narration);
  });
  it('reads prompt condition from recorded metadata', () => {
    expect(buildPresentation(final).promptVariant).toBe('charter');
  });
});

describe('backend-table result projection', () => {
  it('never marks absent data as connected results', () => {
    const result = buildResults(null, false, true);
    expect(['loading', 'unavailable']).toContain(result.status);
    expect(result.agents).toEqual([]);
    expect(result.modelId).toBeNull();
  });
  it('labels current and recorded results separately', () => {
    expect(buildResults(final, true, true).status).toBe('current');
    expect(buildResults(final, true, false).status).toBe('recorded');
  });
  it('does not label a partial capture as a completed outcome', () => {
    const partial = parseReplay(JSON.parse(gunzipSync(readFileSync(new URL('../../public/demo/clearing-reward-v2.json.gz', import.meta.url))).toString('utf8')) as unknown);
    const results = buildResults(stateAt(partial, duration(partial)), true, false);
    expect(results.complete).toBe(false);
    expect(results.worldState).toBe('waiting');
    expect(results.agents.length).toBeGreaterThan(0);
  });
  it('projects actual names, rewards and exposure counts', () => {
    const result = buildResults(final, true, true);
    expect(result.agents).toHaveLength(final.agents.length);
    for (const agent of final.agents) {
      const row = result.agents.find(item => item.id === String(agent.id));
      const score = final.scores.find(item => item.agentId === agent.id);
      expect(row?.name).toBe(agent.name);
      expect(row?.reward).toBe(score?.reward ?? null);
      expect(row?.temptations).toBe(score?.temptations ?? null);
    }
  });
  it('responds to new score rows instead of retaining static outcome values', () => {
    const target = final.agents[0];
    const changed = { ...final, scores: final.scores.map(score => score.agentId === target.id ? { ...score, reward: 123.5, ethics: 0, temptations: 1 } : score) };
    const row = buildResults(changed, true, true).agents.find(agent => agent.id === String(target.id));
    expect(row?.reward).toBe(123.5);
    expect(row?.ethics).toBe(0);
  });
  it('preserves individual model identities in a mixed-model run', () => {
    const data = { ...final, agents: final.agents.map((agent, index) => ({ ...agent, modelId: index === 0 ? 'provider:model-a' : 'provider:model-b' })) };
    const result = buildResults(data, true, true);
    expect(result.agents[0].modelId).toBe('provider:model-a');
    expect(result.agents[1].modelId).toBe('provider:model-b');
  });
  it('distinguishes missing scores and unassessed ethics from real zero', () => {
    const noScores = buildResults({ ...final, scores: [] }, true, true);
    expect(noScores.agents.every(agent => agent.ethics === null && agent.reward === null)).toBe(true);
    const noExposure = buildResults({ ...final, scores: final.scores.map(score => ({ ...score, temptations: 0 })) }, true, true);
    expect(noExposure.agents.every(agent => agent.ethics === null)).toBe(true);
  });
});
