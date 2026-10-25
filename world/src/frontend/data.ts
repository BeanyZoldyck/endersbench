import { duration, startSeconds } from '../replay';
import type { Replay } from '../replay';
import { stateAt, type RecordedTables } from '../useReplay';
import type { Agent, EthicsEvent, Message, Score } from '../module_bindings/types';
import type { StudioState } from './model';

import { RUNS } from './catalog';
import { isSavedRunId, recordingIdentity, type SavedRecording } from './run-history';
export { RUNS } from './catalog';
export type RunId = typeof RUNS[number]['id'];
export const DEFAULT_RUN = RUNS[0].id;
export function runInfo(id: string, saved: readonly SavedRecording[] = []) {
  const packaged = RUNS.find(run => run.id === id);
  if (packaged) return packaged;
  const recording = saved.find(run => run.id === id);
  const identity = recording ? recordingIdentity(recording) : null;
  return { id, label: recording?.label ?? 'Saved benchmark', model: recording && (!recording.roster || recording.roster.length === 1) ? recording.model : null,
    modelId: identity?.modelIds ?? 'Model not recorded', condition: recording ? recording.scenario === 'ledger' ? 'House rules' : 'Charter' : 'Condition not recorded', start: 0 };
}
export const replayPath = (id: string): string | null => isSavedRunId(id)
  ? `/api/benchmarks/${id}/replay`
  : RUNS.some(run => run.id === id) ? `/demo/${id}.json.gz` : null;

export function recordedStartMs(
  state: Pick<StudioState, 'runId' | 'replayTimeMs' | 'previous'>,
  search: string,
  durationMs: number,
): number {
  const params = new URLSearchParams(search);
  const urlRun = params.get('run')
    ?? params.get('replay')?.match(/\/demo\/([a-z0-9-]+)\.json(?:\.gz)?$/)?.[1]
    ?? DEFAULT_RUN;
  const fromNavigation = state.previous.length > 0 || state.runId !== urlRun;
  const desired = fromNavigation
    ? state.replayTimeMs
    : params.has('t') ? startSeconds(search) * 1000 : state.replayTimeMs || runInfo(state.runId).start;
  return Math.min(Math.max(0, desired), Math.max(0, durationMs));
}

export type EvidenceMoment = {
  key: string;
  t: number;
  gameTimeMs: number;
  agentId: string | null;
  title: string;
  detail: string;
  kind: string;
};

export function finalTables(replay: Replay): RecordedTables {
  return stateAt(replay, duration(replay));
}

export function evidenceMoments(replay: Replay): EvidenceMoment[] {
  const final = finalTables(replay);
  const firstEthicsFrame = new Map<string, number>();
  for (const frame of replay.frames) {
    for (const row of frame.tables.ethics_event ?? []) {
      const id = String(row.id);
      if (!firstEthicsFrame.has(id)) firstEthicsFrame.set(id, frame.t);
    }
  }
  const ethics = final.ethics.map((event: EthicsEvent) => ({
    key: `ethics-${String(event.id)}`,
    t: firstEthicsFrame.get(String(event.id)) ?? timeForGame(replay, event.gameTimeMs),
    gameTimeMs: event.gameTimeMs,
    agentId: String(event.agentId), title: event.caption, detail: event.thought || '', kind: event.kind,
  }));
  const transfers = replay.events.filter(event => event.table === 'transfer_event' && Number(event.row.qty ?? 0) > 0).map((event, index) => {
    const row = event.row;
    const from = String(row.fromAgentId ?? '0');
    const to = String(row.toAgentId ?? '0');
    const names = new Map(final.agents.map(agent => [String(agent.id), agent.name]));
    const label = `${names.get(from) ?? 'Shared supply'} → ${names.get(to) ?? 'Shared supply'}: ${String(row.qty)} ${String(row.kind)}`;
    return { key: `transfer-${index}-${event.t}`, t: event.t, gameTimeMs: gameForTime(replay, event.t), agentId: from === '0' ? to : from, title: label, detail: 'Recorded item transfer', kind: 'transfer' };
  });
  const combined = [...ethics, ...transfers].sort((a, b) => a.t - b.t);
  return combined.length ? combined : [{ key: 'start', t: 0, gameTimeMs: 0, agentId: null, title: 'Recording begins', detail: 'No scored events in this recording.', kind: 'start' }];
}

function timeForGame(replay: Replay, gameTimeMs: number): number {
  return replay.frames.find(frame => frame.gameTimeMs >= gameTimeMs)?.t ?? duration(replay);
}
function gameForTime(replay: Replay, t: number): number {
  let gameTimeMs = 0;
  for (const frame of replay.frames) { if (frame.t > t) break; gameTimeMs = frame.gameTimeMs; }
  return gameTimeMs;
}

export function scoreFor(scores: readonly Score[], agentId: bigint): Score | undefined {
  return scores.find(score => score.agentId === agentId);
}
export function messagesFor(messages: readonly Message[], agentId: bigint | null): Message[] {
  return [...messages].filter(message => agentId === null || message.fromAgentId === agentId || message.toAgentId === agentId).sort((a, b) => a.gameTimeMs - b.gameTimeMs);
}
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
export function agentStatus(agent: Agent): string {
  if (!agent.alive) return 'Died';
  if (agent.pendingRequestId !== 0n) return 'Thinking';
  return agent.intentKind ? agent.intentKind.replace(/_/g, ' ') : 'Observing';
}
