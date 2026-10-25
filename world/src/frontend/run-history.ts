import { RUNS } from './catalog';
import metadata from './recording-metadata.json';
import type { StudioModel } from './model';

export type HistoryModel = 'all' | StudioModel;
export type SavedRecording = {
  id: string;
  model: StudioModel;
  modelId: string;
  scenario: 'clearing-charter';
  label: string;
  recordedAt: string;
  durationMs: number;
  status: 'completed' | 'partial';
  replayUrl: string;
};
export type HistoryRecording = {
  id: string; model: StudioModel; modelId: string; label: string; condition: string;
  recordedAt: string; durationMs: number; status: 'completed' | 'partial' | 'packaged';
};

export const isSavedRunId = (id: string): boolean => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);

export function parseSavedRecordings(value: unknown): SavedRecording[] {
  if (!Array.isArray(value)) throw new Error('Invalid recording history.');
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid saved recording.');
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string' || !isSavedRunId(row.id)
      || !['Ender', 'Grok', 'Claude', 'ChatGPT'].includes(String(row.model))
      || typeof row.modelId !== 'string' || !row.modelId.trim() || row.modelId.length > 200
      || row.scenario !== 'clearing-charter'
      || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 300
      || typeof row.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(row.recordedAt) || !Number.isFinite(Date.parse(row.recordedAt))
      || typeof row.durationMs !== 'number' || !Number.isFinite(row.durationMs) || row.durationMs < 0
      || (row.status !== 'completed' && row.status !== 'partial')
      || row.replayUrl !== `/api/benchmarks/${row.id}/replay`
      || ids.has(row.id.toLowerCase())) throw new Error('Invalid saved recording.');
    ids.add(row.id.toLowerCase());
    return {
      id: row.id, model: row.model as StudioModel, modelId: row.modelId, scenario: row.scenario,
      label: row.label, recordedAt: row.recordedAt, durationMs: row.durationMs,
      status: row.status, replayUrl: row.replayUrl as string,
    };
  });
}

export async function fetchSavedRecordings(signal?: AbortSignal): Promise<SavedRecording[]> {
  const response = await fetch('/api/benchmarks/history', { signal: signal ?? AbortSignal.timeout(15000), cache: 'no-store' });
  if (!response.ok) throw new Error('Local recording history unavailable.');
  return parseSavedRecordings(await response.json());
}

export function savedRecordings(model: HistoryModel, local: readonly SavedRecording[] = []): HistoryRecording[] {
  const packaged: HistoryRecording[] = RUNS.map(run => ({ ...run, ...metadata[run.id], status: 'packaged' }));
  const saved: HistoryRecording[] = local.map(run => ({ ...run, condition: 'Charter' }));
  return [...packaged, ...saved].filter(run => model === 'all' || run.model === model)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || a.id.localeCompare(b.id));
}

export function recordedOutcomeComplete(runId: string, worldComplete: boolean, recording?: Pick<SavedRecording, 'status'>): boolean {
  return worldComplete && (!isSavedRunId(runId) || recording?.status === 'completed');
}
