import { describe, expect, it } from 'vitest';
import { decode, duration, encode, eventsBetween, frameAt, parseReplay, startSeconds, timeAtGame, type Replay } from './replay';

const replay: Replay = {
  version: 1,
  db: 'test-world',
  recordedAt: '2026-10-24T12:00:00.000Z',
  frames: [
    {
      t: 0,
      gameTimeMs: 100,
      tables: {
        world: [{ id: 0, tick: 1n }],
        agent: [{ id: 1n, name: 'Ada' }],
      },
    },
    {
      t: 500,
      gameTimeMs: 150,
      tables: { world: [{ id: 0, tick: 2n }] },
    },
  ],
  events: [
    { t: 100, table: 'hit_event', row: { damage: 5 } },
    { t: 200, table: 'world_event', row: { kind: 'storm' } },
    { t: 600, table: 'transfer_event', row: { qty: 1 } },
  ],
};

describe('replay codec', () => {
  it('round-trips bigints, identities and timestamps', () => {
    const value = {
      id: 42n,
      owner: { toHexString: () => 'abc123' },
      createdAt: { microsSinceUnixEpoch: 1_729_776_000_123_456n },
      nested: [1n, { count: -2n }],
    };
    const encoded = encode(value);
    expect(encoded).toEqual({
      id: { $big: '42' },
      owner: { $id: 'abc123' },
      createdAt: { $ts: '1729776000123456' },
      nested: [{ $big: '1' }, { count: { $big: '-2' } }],
    });
    expect(decode(encoded)).toEqual({
      id: 42n,
      owner: { hex: 'abc123' },
      createdAt: 1_729_776_000_123_456n,
      nested: [1n, { count: -2n }],
    });
  });
});

describe('replay timeline', () => {
  it('carries unchanged tables forward', () => {
    expect(frameAt(replay, 500)).toEqual({
      t: 500,
      gameTimeMs: 150,
      tables: {
        world: [{ id: 0, tick: 2n }],
        agent: [{ id: 1n, name: 'Ada' }],
      },
    });
  });

  it('uses an exclusive lower event bound and inclusive upper bound', () => {
    expect(eventsBetween(replay, 100, 200).map(event => event.t)).toEqual([200]);
    expect(eventsBetween(replay, 200, 600).map(event => event.t)).toEqual([600]);
    expect(duration(replay)).toBe(600);
  });

  it('rejects unsupported replay versions', () => {
    const encoded = encode(replay) as Record<string, unknown>;
    expect(() => parseReplay({ ...encoded, version: 2 })).toThrow('Unsupported replay version: 2');
  });
});

describe('jumping to a moment', () => {
  it('finds the replay time when the game clock reached a moment', () => {
    expect(timeAtGame(replay, 100)).toBe(0);
    expect(timeAtGame(replay, 120)).toBe(500);
    expect(timeAtGame(replay, 150)).toBe(500);
  });

  it('a moment past the last frame lands on the end, one before the first on the start', () => {
    expect(timeAtGame(replay, 9_999)).toBe(500);
    expect(timeAtGame(replay, 0)).toBe(0);
  });

  it('?t= opens a replay at a moment, in seconds or m:ss', () => {
    expect(startSeconds('?replay=/demo/x.json.gz&t=138')).toBe(138);
    expect(startSeconds('?replay=/demo/x.json.gz&t=2:18')).toBe(138);
    expect(startSeconds('?replay=/demo/x.json.gz')).toBe(0);
    expect(startSeconds('?t=soon')).toBe(0);
  });
});
