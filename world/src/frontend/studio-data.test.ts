import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { duration, parseReplay, type Replay } from '../replay';
import type { Agent, Message } from '../module_bindings/types';
import {
  DEFAULT_RUN,
  RUNS,
  agentStatus,
  evidenceMoments,
  finalTables,
  messagesFor,
  replayPath,
  runInfo,
  scoreFor,
  type RunId,
} from './data';

function loadReplay(id: RunId): Replay {
  const file = new URL(`../../public/demo/${id}.json.gz`, import.meta.url);
  const json = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as unknown;
  return parseReplay(json);
}

const replay = loadReplay('clearing-charter-v8-admission');
const recorded = finalTables(replay);

describe('exhibit button timestamp', () => {
  test('opens the advertised ethics event at its actual recorded time', () => {
    const moments = evidenceMoments(replay);
    const exhibit = moments.filter(event => event.t <= runInfo(DEFAULT_RUN).start).slice(-1)[0];
    expect(exhibit?.kind).toBe('hoarding');
    expect(exhibit?.title).toContain('12 in all');
    expect(exhibit?.detail.toLowerCase()).toContain('fair share');
    for (const moment of moments.filter(event => event.key.startsWith('ethics-'))) {
      const firstFrame = replay.frames.find(frame => frame.tables.ethics_event?.some(row => `ethics-${String(row.id)}` === moment.key));
      expect(firstFrame).toBeDefined();
      expect(moment.t).toBe(firstFrame?.t);
    }
  });
});

describe('studio run allowlist', () => {
  test.each(RUNS)('$id resolves to its committed replay', run => {
    expect(replayPath(run.id)).toBe(`/demo/${run.id}.json.gz`);
    const file = new URL(`../../public${replayPath(run.id)}`, import.meta.url);
    expect(readFileSync(file).byteLength).toBeGreaterThan(0);
    expect(runInfo(run.id)).toBe(run);
  });

  test('an unrecognized run id cannot escape the committed replay allowlist', () => {
    const path = replayPath('../../private/secret');

    expect(RUNS.some(run => path === `/demo/${run.id}.json.gz`)).toBe(true);
    expect(path).not.toContain('..');
    expect(runInfo('../../private/secret').id).toBe(DEFAULT_RUN);
  });
});

describe('recorded final tables', () => {
  test('reconstructs complete table state from a committed replay', () => {
    expect(recorded.world).toMatchObject({ id: 0 });
    expect(recorded.agents).toHaveLength(4);
    expect(recorded.scores).toHaveLength(4);
    expect(recorded.ethics.length).toBeGreaterThan(0);
    expect(recorded.messages.length).toBeGreaterThan(0);
    expect(recorded.metadata.some(row => row.key === 'physics')).toBe(true);
    expect(recorded.agents.map(agent => agent.name)).toEqual(
      expect.arrayContaining(['Ivy', 'Rook', 'Sage', 'Wren'])
    );
  });

  test('score lookup distinguishes an absent score from an explicit zero', () => {
    const absentAgentId = 999_999_999n;
    expect(scoreFor(recorded.scores, absentAgentId)).toBeUndefined();

    const existing = recorded.scores[0];
    const explicitZero = { ...existing, reward: 0, ethics: 0 };

    expect(scoreFor([explicitZero], existing.agentId)).toBe(explicitZero);
    expect(scoreFor([explicitZero], existing.agentId)?.reward).toBe(0);
    expect(scoreFor([explicitZero], existing.agentId)?.ethics).toBe(0);
  });
});

describe('agent message selection', () => {
  test('includes the selected sender and recipient, but excludes messages between other agents', () => {
    const template = recorded.messages[0];
    const selected = recorded.agents.find(agent => agent.id === template.fromAgentId)!;
    const other = recorded.agents.find(agent => agent.id !== selected.id)!;
    const third = recorded.agents.find(agent => agent.id !== selected.id && agent.id !== other.id)!;
    const outgoing = {
      ...template,
      id: 9001n,
      fromAgentId: selected.id,
      toAgentId: other.id,
      gameTimeMs: 30,
    } satisfies Message;
    const incoming = {
      ...template,
      id: 9002n,
      fromAgentId: other.id,
      toAgentId: selected.id,
      gameTimeMs: 10,
    } satisfies Message;
    const unrelated = {
      ...template,
      id: 9003n,
      fromAgentId: other.id,
      toAgentId: third.id,
      gameTimeMs: 20,
    } satisfies Message;
    const authoredInRecording = recorded.messages.find(message => message.fromAgentId === selected.id);
    const messages = [...recorded.messages, outgoing, incoming, unrelated];
    const selectedMessages = messagesFor(messages, selected.id);

    expect(authoredInRecording).toBeDefined();
    expect(selectedMessages).toContainEqual(authoredInRecording);
    expect(selectedMessages).toContainEqual(outgoing);
    expect(selectedMessages).toContainEqual(incoming);
    expect(selectedMessages).not.toContainEqual(unrelated);
    expect(selectedMessages.map(message => message.gameTimeMs)).toEqual(
      [...selectedMessages].map(message => message.gameTimeMs).sort((a, b) => a - b)
    );
  });

  test('the unselected view returns all recorded messages in chronological order without mutating its input', () => {
    const original = [...recorded.messages];
    const allMessages = messagesFor(recorded.messages, null);

    expect(allMessages).toEqual([...recorded.messages].sort((a, b) => a.gameTimeMs - b.gameTimeMs));
    expect(recorded.messages).toEqual(original);
  });
});

describe('recorded evidence', () => {
  const moments = evidenceMoments(replay);

  test('keeps evidence in replay-time order across ethics rows and event-table rows', () => {
    expect(moments.length).toBeGreaterThan(0);
    expect(moments.map(moment => moment.t)).toEqual(
      [...moments].map(moment => moment.t).sort((a, b) => a - b)
    );
    expect(moments.every(moment => Number.isFinite(moment.t) && Number.isFinite(moment.gameTimeMs))).toBe(true);
  });

  test('ethics evidence preserves the recorded row id, actor id, caption, thought, and game time', () => {
    const ethicsMoments = moments.filter(moment => moment.kind !== 'transfer');

    expect(ethicsMoments).toHaveLength(recorded.ethics.length);
    for (const event of recorded.ethics) {
      const moment = ethicsMoments.find(candidate => candidate.key === `ethics-${String(event.id)}`);
      const frame = replay.frames.find(candidate => candidate.gameTimeMs >= event.gameTimeMs);

      expect(moment).toBeDefined();
      expect(moment).toMatchObject({
        t: frame?.t ?? duration(replay),
        gameTimeMs: event.gameTimeMs,
        agentId: String(event.agentId),
        title: event.caption,
        detail: event.thought || '',
        kind: event.kind,
      });
    }
  });

  test('transfer evidence comes from positive recorded transfer events with their recorded timestamps', () => {
    const transfers = replay.events.filter(
      event => event.table === 'transfer_event' && Number(event.row.qty ?? 0) > 0
    );
    const transferMoments = moments.filter(moment => moment.kind === 'transfer');

    expect(transfers.length).toBeGreaterThan(0);
    expect(transferMoments).toHaveLength(transfers.length);
    for (const event of transfers) {
      expect(transferMoments.some(moment => moment.t === event.t)).toBe(true);
    }
    expect(transferMoments.every(moment => moment.detail === 'Recorded item transfer')).toBe(true);
  });

  test('every non-null evidence actor is a real agent from the recording', () => {
    const agentIds = new Set(recorded.agents.map(agent => String(agent.id)));
    const evidenceActorIds = moments.flatMap(moment => moment.agentId === null ? [] : [moment.agentId]);

    expect(evidenceActorIds.length).toBeGreaterThan(0);
    expect(evidenceActorIds.every(agentId => agentIds.has(agentId))).toBe(true);
  });
});

describe('agent status', () => {
  const agent = (fields: Record<string, unknown>) => ({ alive: true, pendingRequestId: 0n, intentKind: '', lastLatencyMs: 0, ...fields }) as unknown as Agent;

  test('shows how long the model took over its last answer', () => {
    expect(agentStatus(agent({ intentKind: 'gather', lastLatencyMs: 1138 }))).toBe('gather · 1.1 s');
  });

  test('says Thinking while a decision is in flight, whatever the last answer took', () => {
    expect(agentStatus(agent({ pendingRequestId: 7n, lastLatencyMs: 1138 }))).toBe('Thinking');
  });

  test('leaves the time off before the first answer', () => {
    expect(agentStatus(agent({}))).toBe('Observing');
  });
});
