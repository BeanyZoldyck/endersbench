import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseReplay, duration } from '../replay';
import { stateAt } from '../useReplay';
import { modelDisplayName, modelAvatarPath, withModelNames } from './model-identity';

const replay = parseReplay(JSON.parse(gunzipSync(readFileSync(new URL('../../public/demo/clearing-charter-v8-admission.json.gz', import.meta.url))).toString('utf8')) as unknown);
const data = stateAt(replay, duration(replay));
describe('model identity presentation', () => {
  it('uses the recorded version rather than assigning unrelated provider names', () => {
    const named = withModelNames(data)!;
    expect(named.agents.map(agent => agent.name).sort()).toEqual(['GPT 6 Luna · 1', 'GPT 6 Luna · 2', 'GPT 6 Luna · 3', 'GPT 6 Luna · 4']);
    expect(named.agents.map(agent => agent.id)).toEqual(data.agents.map(agent => agent.id));
    expect(data.agents.map(agent => agent.name)).toContain('Wren');
    expect(named.scores).toBe(data.scores);
    expect(named.ethics).toBe(data.ethics);
  });
  it('keeps aliases stable when rows reorder', () => {
    const reversed = withModelNames({ ...data, agents: [...data.agents].reverse() })!;
    const normal = withModelNames(data)!;
    for (const agent of reversed.agents) expect(agent.name).toBe(normal.agents.find(row => row.id === agent.id)?.name);
  });
  it('handles mixed models and missing attribution honestly', () => {
    const mixed = withModelNames({ ...data, agents: data.agents.slice(0, 2).map((agent, i) => ({ ...agent, modelId: i ? '' : 'anthropic:claude-opus-5-5' })) })!;
    expect(mixed.agents.map(agent => agent.name)).toEqual(['Claude Opus 5 5', 'Unknown model']);
    expect(withModelNames(null)).toBeNull();
    expect(modelDisplayName('codex:gpt-6-sol')).toBe('GPT 6 Sol');
  });
  it('maps only recognized model families to branded buddies', () => {
    expect(modelAvatarPath('codex:gpt-6-luna')).toBe('/studio/avatars/chatgpt.png');
    expect(modelAvatarPath('Grok')).toBe('/studio/avatars/grok.png');
    expect(modelAvatarPath('Claude')).toBe('/studio/avatars/claude.png');
    expect(modelAvatarPath('Ender')).toBe('/studio/avatars/ender.png');
    expect(modelAvatarPath('other:model')).toBeNull();
  });
});
