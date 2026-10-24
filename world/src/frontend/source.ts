import { useEffect, useMemo, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { useReplay, type RecordedTables } from '../useReplay';
import type { Replay } from '../replay';
import { evidenceMoments, finalTables, recordedStartMs, replayPath, type EvidenceMoment } from './data';
import type { StudioState } from './model';

export type StudioSource = {
  data: RecordedTables | null;
  final: RecordedTables | null;
  replay: Replay | null;
  moments: EvidenceMoment[];
  t: number;
  duration: number;
  playing: boolean;
  speed: number;
  seek: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  error: string;
  ready: boolean;
  live: boolean;
  sceneMoments: ReturnType<typeof useReplay>['moments'];
};

// The hook remains mounted across Studio routes. A change of run ID remounts its
// caller with a key so an older recording cannot appear under a newer run name.
export function useRecordedSource(state: StudioState): StudioSource {
  const replay = useReplay(replayPath(state.runId));
  const moments = useMemo(() => replay.replay ? evidenceMoments(replay.replay) : [], [replay.replay]);
  const final = useMemo(() => replay.replay ? finalTables(replay.replay) : null, [replay.replay]);
  useEffect(() => {
    if (!replay.replay) return;
    const params = new URLSearchParams(window.location.search);
    replay.seek(recordedStartMs(state, window.location.search, replay.duration));
    replay.setPlaying(params.get('autoplay') === '1' || params.has('tour'));
    // The keyed caller makes this setup run once per recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay.replay]);
  return {
    data: replay.data, final, replay: replay.replay, moments, t: replay.t, duration: replay.duration,
    playing: replay.playing, speed: replay.speed, seek: replay.seek,
    setPlaying: replay.setPlaying, setSpeed: replay.setSpeed,
    error: replay.error, ready: !!replay.data, live: false, sceneMoments: replay.moments,
  };
}

export function useLiveSource(): StudioSource {
  const { isActive } = useSpacetimeDB();
  const [worlds, worldReady] = useTable(tables.world);
  const [agents, agentsReady] = useTable(tables.agent);
  const [nodes, nodesReady] = useTable(tables.resourceNode);
  const [containers, containersReady] = useTable(tables.container);
  const [items, itemsReady] = useTable(tables.item);
  const [messages, messagesReady] = useTable(tables.message);
  const [structures, structuresReady] = useTable(tables.structure);
  const [mobs, mobsReady] = useTable(tables.mob);
  const [hazards, hazardsReady] = useTable(tables.hazard);
  const [memories, memoriesReady] = useTable(tables.memory);
  const [scores, scoresReady] = useTable(tables.score);
  const [ethics, ethicsReady] = useTable(tables.ethicsEvent);
  const [temptations, temptationsReady] = useTable(tables.temptation);
  const [metadata, metadataReady] = useTable(tables.meta);
  const ready = isActive && worldReady && agentsReady && nodesReady && containersReady
    && itemsReady && messagesReady && structuresReady && mobsReady && hazardsReady
    && memoriesReady && scoresReady && ethicsReady && temptationsReady && metadataReady;
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (ready) { setWaited(false); return; }
    const timer = window.setTimeout(() => setWaited(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [ready]);
  const data: RecordedTables = {
    world: worlds[0], agents: [...agents], nodes: [...nodes], containers: [...containers],
    items: [...items], messages: [...messages], structures: [...structures], mobs: [...mobs],
    hazards: [...hazards], memories: [...memories], scores: [...scores], ethics: [...ethics],
    temptations: [...temptations], metadata: [...metadata],
  };
  const moments: EvidenceMoment[] = ethics.map(event => ({
    key: `ethics-${String(event.id)}`, t: event.gameTimeMs, gameTimeMs: event.gameTimeMs,
    agentId: String(event.agentId), title: event.caption, detail: event.thought ?? '', kind: event.kind,
  })).sort((a, b) => a.t - b.t);
  return {
    data, final: data, replay: null, moments, t: worlds[0]?.gameTimeMs ?? 0,
    duration: 0, playing: !!worlds[0]?.running, speed: 1, seek: () => undefined,
    setPlaying: () => undefined, setSpeed: () => undefined,
    error: waited && !ready ? 'Current world data did not become ready. The saved reference remains available.' : '',
    ready,
    live: true, sceneMoments: [],
  };
}
