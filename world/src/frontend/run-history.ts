import { RUNS } from './catalog';
import metadata from './recording-metadata.json';
import { BENCHMARK_MODELS, type StudioModel } from './model';
import { rosterLabel, type BenchmarkRosterEntry } from './benchmark-client';

export type SavedRosterEntry = BenchmarkRosterEntry & { modelId: string };
export type SavedScenario = 'clearing-charter' | 'ledger';

export type HistoryModel = 'all' | StudioModel;
export type SavedRecording = {
  id: string;
  model: StudioModel;
  modelId: string;
  scenario: SavedScenario;
  roster?: SavedRosterEntry[];
  label: string;
  recordedAt: string;
  durationMs: number;
  status: 'completed' | 'partial';
  replayUrl: string;
};
export type HistoryRecording = {
  id: string; model: StudioModel; modelId: string; label: string; condition: string;
  recordedAt: string; durationMs: number; status: 'completed' | 'partial' | 'packaged';
  scenario: SavedScenario; roster?: SavedRosterEntry[];
};

export const isSavedRunId = (id: string): boolean => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);

export function parseSavedRecordings(value: unknown): SavedRecording[] {
  if (!Array.isArray(value)) throw new Error('Invalid recording history.');
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid saved recording.');
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string' || !isSavedRunId(row.id)
      || !(BENCHMARK_MODELS as string[]).includes(String(row.model))
      || typeof row.modelId !== 'string' || !row.modelId.trim() || row.modelId.length > 200
      || (row.scenario !== 'clearing-charter' && row.scenario !== 'ledger')
      || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 300
      || typeof row.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(row.recordedAt) || !Number.isFinite(Date.parse(row.recordedAt))
      || typeof row.durationMs !== 'number' || !Number.isFinite(row.durationMs) || row.durationMs < 0
      || (row.status !== 'completed' && row.status !== 'partial')
      || row.replayUrl !== `/api/benchmarks/${row.id}/replay`
      || ids.has(row.id.toLowerCase())) throw new Error('Invalid saved recording.');
    const roster = parseSavedRoster(row.roster);
    if (roster && (roster[0].model !== row.model || roster[0].modelId !== row.modelId)) throw new Error('Invalid saved recording identity.');
    ids.add(row.id.toLowerCase());
    return {
      id: row.id, model: row.model as StudioModel, modelId: row.modelId, scenario: row.scenario,
      label: row.label, recordedAt: row.recordedAt, durationMs: row.durationMs,
      status: row.status, replayUrl: row.replayUrl as string, ...(roster ? { roster } : {}),
    };
  });
}

function parseSavedRoster(value: unknown): SavedRosterEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 4) throw new Error('Invalid saved roster.');
  const seen = new Set<StudioModel>();
  let total = 0;
  const roster = value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid saved roster.');
    const row = entry as Record<string, unknown>;
    if (!BENCHMARK_MODELS.includes(row.model as StudioModel) || typeof row.modelId !== 'string' || !row.modelId.trim() || row.modelId.length > 200
      || typeof row.count !== 'number' || !Number.isInteger(row.count) || row.count < 1 || row.count > 4 || seen.has(row.model as StudioModel)) throw new Error('Invalid saved roster.');
    seen.add(row.model as StudioModel);
    total += row.count;
    return { model: row.model as StudioModel, modelId: row.modelId, count: row.count };
  });
  if (total > 4) throw new Error('Invalid saved roster.');
  return roster;
}

export function ledgerReplayHref(id: string): string {
  if (!isSavedRunId(id)) throw new Error('Invalid saved recording destination.');
  return `/finance.html?${new URLSearchParams({ replay: `/api/benchmarks/${id}/replay` })}`;
}

export function recordingModels(run: Pick<SavedRecording, 'model' | 'roster'>): StudioModel[] {
  return run.roster?.map(entry => entry.model) ?? [run.model];
}

export function recordingIdentity(run: Pick<SavedRecording, 'model' | 'modelId' | 'roster'>): { label: string; modelIds: string } {
  return run.roster ? { label: rosterLabel(run.roster), modelIds: run.roster.map(entry => entry.modelId).join(' + ') } : { label: run.model, modelIds: run.modelId };
}

export async function fetchSavedRecordings(signal?: AbortSignal): Promise<SavedRecording[]> {
  const response = await fetch('/api/benchmarks/history', { signal: signal ?? AbortSignal.timeout(15000), cache: 'no-store' });
  if (!response.ok) throw new Error('Local recording history unavailable.');
  return parseSavedRecordings(await response.json());
}

export function savedRecordings(model: HistoryModel, local: readonly SavedRecording[] = []): HistoryRecording[] {
  const packaged: HistoryRecording[] = RUNS.map(run => ({ ...run, ...metadata[run.id], scenario: 'clearing-charter', status: 'packaged' }));
  const saved: HistoryRecording[] = local.map(run => ({ ...run, condition: run.scenario === 'ledger' ? 'House rules' : 'Charter' }));
  return [...packaged, ...saved].filter(run => model === 'all' || recordingModels(run).includes(model))
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || a.id.localeCompare(b.id));
}

export function recordedOutcomeComplete(runId: string, worldComplete: boolean, recording?: Pick<SavedRecording, 'status'>): boolean {
  return worldComplete && (!isSavedRunId(runId) || recording?.status === 'completed');
}
