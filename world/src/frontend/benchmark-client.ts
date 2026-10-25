import { ALL_MODEL_NAMES, isModelName } from '../../shared/models';
import { MAX_BENCHMARK_AGENTS, rosterSize, type BenchmarkRoster, type StudioModel } from './model';

export type BenchmarkRosterEntry = { model: StudioModel; count: number };
export type BenchmarkScenario = { id: string; name: string; description: string; available?: boolean; reason?: string };

export function rosterEntries(roster: BenchmarkRoster): BenchmarkRosterEntry[] {
  return ALL_MODEL_NAMES.filter(model => (roster[model] ?? 0) > 0).map(model => ({ model, count: roster[model] ?? 0 }));
}

export function rosterLabel(roster: BenchmarkRosterEntry[]): string {
  return roster.map(entry => `${entry.count} ${entry.model}`).join(' + ') || 'No agents selected';
}

export function benchmarkBlocker(config: BenchmarkConfig | null, roster: BenchmarkRoster, scenarioId: string): string | null {
  const total = rosterSize(roster);
  if (Object.entries(roster).some(([model, count]) => !isModelName(model) || !Number.isInteger(count) || (count ?? 0) < 0) || total > MAX_BENCHMARK_AGENTS) return 'Select up to four agents in total.';
  if (total < 1) return 'Add at least one agent to start.';
  if (!config) return 'Connect to the benchmark runner to check availability.';
  if (!config.ready) return config.reason || 'The benchmark runner is not ready.';
  const scenario = config.scenarios.find(option => option.id === scenarioId);
  if (!scenario) return 'Choose a supported scenario.';
  if (scenario.available === false) return scenario.reason || `${scenario.name} is unavailable.`;
  const unavailable = rosterEntries(roster).filter(entry => !config.models.find(option => option.id === entry.model)?.available);
  if (unavailable.length) return unavailable.map(entry => `Connect ${entry.model} before starting.`).join(' ');
  return null;
}

export type BenchmarkConfig = {
  ready: boolean;
  reason?: string;
  models: Array<{ id: StudioModel; modelId: string | null; available: boolean; reason?: string }>;
  scenarios: BenchmarkScenario[];
};
export type BenchmarkJob = {
  id: string;
  status: 'starting' | 'running' | 'completed' | 'failed';
  model: StudioModel;
  modelId: string;
  scenario: string;
  roster?: Array<BenchmarkRosterEntry & { modelId: string }>;
  dbName: string;
  host: string;
  error?: string;
  summary?: string;
  report?: unknown;
};

export function benchmarkViewerHref(job: BenchmarkJob): string {
  if (!/^endersbench-run-[a-z0-9-]+$/.test(job.dbName) || !/^[a-z0-9-]+$/.test(job.id)) throw new Error('Invalid benchmark destination.');
  if (job.scenario === 'ledger') return `/finance.html?${new URLSearchParams({ benchmark: job.id, db: job.dbName })}`;
  if (job.scenario !== 'clearing-charter') throw new Error('Unsupported benchmark scenario.');
  return job.status === 'completed'
    ? `/?${new URLSearchParams({ live: '1', studio: 'outcome', benchmark: job.id, db: job.dbName })}`
    : `/?${new URLSearchParams({ legacy: '1', benchmark: job.id, db: job.dbName })}`;
}

export async function benchmarkRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? body.error : 'The benchmark service could not complete this request.');
  }
  return response.json() as Promise<T>;
}

export function launchBenchmark(roster: BenchmarkRosterEntry[], scenario: string): Promise<BenchmarkJob> {
  return benchmarkRequest('/api/benchmarks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roster, scenario }),
  });
}
