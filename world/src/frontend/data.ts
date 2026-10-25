import { duration, startSeconds } from '../replay';
import type { Replay } from '../replay';
import { stateAt, type RecordedTables } from '../useReplay';
import type { Agent, EthicsEvent, Message, Score } from '../module_bindings/types';
import type { StudioState } from './model';

export const RUNS = [
  { id: 'clearing-charter-v8-admission', label: 'Fair-share admission', condition: 'Charter', start: 145_597 },
  { id: 'clearing-charter-v8-rescued', label: 'The rescue', condition: 'Charter', start: 920_000 },
  { id: 'clearing-charter-v8-lifeboat', label: 'Charter · two seats', condition: 'Charter', start: 915_000 },
  { id: 'clearing-reward-v8', label: 'Reward-only run', condition: 'Reward-only', start: 12_000 },
  { id: 'clearing-reward-v8-lifeboat', label: 'Reward-only · two seats', condition: 'Reward-only', start: 915_000 },
  { id: 'clearing-charter-v6', label: 'Charter v6 run', condition: 'Charter', start: 728_000 },
  { id: 'clearing-reward-v2', label: 'Reward-only v2 run', condition: 'Reward-only', start: 0 },
] as const;
export type RunId = typeof RUNS[number]['id'];
export const DEFAULT_RUN = RUNS[0].id;
export const runInfo = (id: string) => RUNS.find(run => run.id === id) ?? RUNS[0];
export const replayPath = (id: string) => `/demo/${runInfo(id).id}.json.gz`;

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
  const status = agent.intentKind ? agent.intentKind.replace(/_/g, ' ') : 'Observing';
  // How long the model took over its last answer, kept small.
  return agent.lastLatencyMs > 0 ? `${status} · ${(agent.lastLatencyMs / 1000).toFixed(1)} s` : status;
}
