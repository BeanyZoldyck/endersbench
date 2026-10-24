import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, Container, EthicsEvent, Hazard, Item, Memory, Message, Meta, Mob, Record as GameRecord, ResourceNode, Score, Structure, Temptation, World } from './module_bindings/types';
import { duration, eventsBetween, frameAt, parseReplay, startSeconds, timeAtGame, type Replay, type ReplayRow } from './replay';
import { eventMoments, useMomentQueue } from './scene/SceneEvents';

// Plays a recorded run (npm run record) through the same viewer, with no
// database: the demo backstop. Positions are interpolated between the 2 Hz
// frames; events replay through the same code that draws live ones.

export type RecordedTables = {
  world?: World; agents: Agent[]; nodes: ResourceNode[]; containers: Container[]; items: Item[]; messages: Message[];
  structures: Structure[]; mobs: Mob[]; hazards: Hazard[]; memories: Memory[]; scores: Score[]; ethics: EthicsEvent[];
  temptations: Temptation[]; records: GameRecord[]; metadata: Meta[];
};

const TICK_MS = 100;
type Positioned = ReplayRow & { id: bigint; x: number; y: number };

// Moves rows with positions part of the way to their place in the next frame.
function lerpRows(rows: ReplayRow[] = [], next: ReplayRow[] | undefined, alpha: number) {
  if (!next || alpha <= 0) return rows;
  const ahead = new Map((next as Positioned[]).map(r => [r.id, r]));
  return (rows as Positioned[]).map(r => {
    const n = ahead.get(r.id);
    return n ? { ...r, x: r.x + (n.x - r.x) * alpha, y: r.y + (n.y - r.y) * alpha } : r;
  });
}

export function stateAt(replay: Replay, t: number) {
  const base = frameAt(replay, t);
  const nextFrame = replay.frames.find(f => f.t > t);
  const alpha = nextFrame && nextFrame.t > base.t ? (t - base.t) / (nextFrame.t - base.t) : 0;
  const tables = base.tables;
  const world = tables.world?.[0] as World | undefined;
  const gameTimeMs = nextFrame ? base.gameTimeMs + (nextFrame.gameTimeMs - base.gameTimeMs) * alpha : base.gameTimeMs;
  return {
    world: world && ({ ...world, gameTimeMs } as World),
    agents: lerpRows(tables.agent, nextFrame?.tables.agent, alpha) as Agent[],
    mobs: lerpRows(tables.mob, nextFrame?.tables.mob, alpha) as Mob[],
    nodes: (tables.resource_node ?? []) as ResourceNode[],
    containers: (tables.container ?? []) as Container[],
    items: (tables.item ?? []) as Item[],
    messages: (tables.message ?? []) as Message[],
    structures: (tables.structure ?? []) as Structure[],
    hazards: (tables.hazard ?? []) as Hazard[],
    memories: (tables.memory ?? []) as Memory[],
    scores: (tables.score ?? []) as Score[],
    ethics: (tables.ethics_event ?? []) as EthicsEvent[],
    temptations: (tables.temptation ?? []) as Temptation[],
    records: (tables.record ?? []) as GameRecord[],
    metadata: (tables.meta ?? []) as Meta[],
  } satisfies RecordedTables;
}

// Recordings are large; a .gz copy is about a fifteenth of the size and is
// decompressed in the browser.
async function loadJson(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  // Some servers send .gz with Content-Encoding: gzip and the browser has
  // already unpacked it; only unpack here if the gzip magic bytes remain.
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gzipped ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

export function useReplay(url: string | null) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState('');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const { moments, push } = useMomentQueue();
  const clock = useRef(0);

  useEffect(() => {
    if (!url) return;
    loadJson(url).then(json => {
      setReplay(parseReplay(json));
      // ?t= opens the replay at a chosen moment instead of the start.
      const start = startSeconds(window.location.search) * 1000;
      clock.current = start;
      setT(start);
    }).catch(e => setError(String(e)));
  }, [url]);

  useEffect(() => {
    if (!replay || !playing) return;
    const end = duration(replay);
    const timer = window.setInterval(() => {
      const from = clock.current, to = Math.min(end, from + TICK_MS * speed);
      clock.current = to;
      const here = stateAt(replay, to);
      for (const e of eventsBetween(replay, from, to)) push(eventMoments(e.table, e.row, { ...here, world: here.world }));
      setT(to);
      if (to >= end) setPlaying(false);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [replay, playing, speed, push]);

  const data = useMemo(() => (replay ? stateAt(replay, t) : null), [replay, t]);
  const seek = (ms: number) => { clock.current = ms; setT(ms); };
  // Show a moment the world stamped in game time, from a few seconds before it.
  const jumpToGame = (gameTimeMs: number) => { if (replay) seek(timeAtGame(replay, gameTimeMs - 5000)); };
  return { active: !!url, replay, error, data, t, duration: replay ? duration(replay) : 0, playing, setPlaying, speed, setSpeed, seek, jumpToGame, moments };
}
