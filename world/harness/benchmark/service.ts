import type { BenchmarkStore } from './store.js';
import { randomUUID } from 'node:crypto';
import { BenchmarkFailure } from './failure.js';
import { MODEL_IDS, type BenchmarkJob, type BenchmarkScenario, type ModelName } from './types.js';
import { isRosterSelection, type RosterSelection } from './roster.js';
import { BENCHMARK_SCENARIOS } from './scenarios.js';

export type Executor = (job: BenchmarkJob, onRunning: () => void) => Promise<unknown>;
export type Config = { scenarios?: BenchmarkScenario[]; ready: boolean; reason?: string; models: Array<{ id: ModelName; modelId: string | null; available: boolean; reason?: string }> };
export class RequestError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}

export class BenchmarkService {
  private readonly jobs = new Map<string, BenchmarkJob>();
  private activeId: string | null = null;

  constructor(private readonly config: () => Promise<Config>, private readonly execute: Executor, private readonly store?: BenchmarkStore) {
    for (const job of store?.load() ?? []) {
      this.jobs.set(job.id, job);
      if (job.status === 'starting' || job.status === 'running') this.activeId = job.id;
    }
  }

  private restored = true;
  private recoverPending(): void {
    if (!this.restored) return;
    for (const job of this.jobs.values()) {
      if (job.status === 'starting' || job.status === 'running') this.store?.recover(job);
    }
    if (this.activeId && this.jobs.get(this.activeId)?.status === 'failed') this.activeId = null;
  }
  get(id: string): BenchmarkJob | undefined { this.recoverPending(); return this.jobs.get(id); }
  list(): BenchmarkJob[] { this.recoverPending(); return [...this.jobs.values()].reverse(); }

  async start(input: unknown): Promise<BenchmarkJob> {
    this.recoverPending();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError(400, 'Expected a benchmark request.');
    const request = input as Record<string, unknown>;
    const keys = Object.keys(request).sort().join(',');
    const legacy = keys === 'model,scenario' && typeof request.model === 'string' && MODEL_IDS.includes(request.model as ModelName);
    const roster: RosterSelection[] | null = legacy ? [{ model: request.model as ModelName, count: 4 }]
      : keys === 'roster,scenario' && isRosterSelection(request.roster) ? request.roster : null;
    if (!roster || typeof request.scenario !== 'string' || !BENCHMARK_SCENARIOS.some(scenario => scenario.id === request.scenario)) {
      throw new RequestError(400, 'Choose a supported scenario and one to four survivors from unique models.');
    }
    if (this.activeId) throw new RequestError(409, 'A benchmark is already running.');
    const config = await this.config();
    if (this.activeId) throw new RequestError(409, 'A benchmark is already running.');
    if (!config.ready) throw new RequestError(503, config.reason ?? 'Benchmark runner is unavailable.');
    const scenario = (config.scenarios ?? BENCHMARK_SCENARIOS).find(entry => entry.id === request.scenario);
    if (!scenario || scenario.available === false) throw new RequestError(422, scenario?.reason ?? 'Scenario is unavailable.');
    const resolvedRoster = roster.map(entry => {
      const selected = config.models.find(model => model.id === entry.model);
      if (!selected?.available || !selected.modelId) throw new RequestError(422, selected?.reason ?? 'Model mapping is unavailable.');
      return { model: entry.model, modelId: selected.modelId, count: entry.count };
    });
    const selected = resolvedRoster[0];
    const id = randomUUID();
    const job: BenchmarkJob = {
      id, createdAt: new Date().toISOString(), status: 'starting', model: selected.model, modelId: selected.modelId, roster: resolvedRoster,
      scenario: request.scenario, dbName: `endersbench-run-${id}`, host: 'ws://localhost:3000',
    };
    this.store?.save(job);
    this.restored = false;
    this.jobs.set(id, job);
    this.activeId = id;
    void this.execute(job, () => { if (job.status === 'starting') job.status = 'running'; })
      .then(report => {
        if (job.status === 'failed') return;
        job.report = report;
        job.summary = 'The run completed and its report is ready.';
        job.status = 'completed';
        this.store?.archive(job);
        this.store?.save(job);
      })
      .catch(error => {
        job.error = error instanceof BenchmarkFailure ? error.message : 'Benchmark failed. Check the local runner logs.';
        job.status = 'failed';
        delete job.report;
        delete job.summary;
        try { this.store?.archive(job); }
        catch { job.error = 'Benchmark stopped, but its recording could not be saved. Check local disk space and runner logs.'; }
        try { this.store?.save(job); } catch { process.stderr.write(`Could not persist failed benchmark ${id}.\n`); }
      })
      .finally(() => { if (this.activeId === id) this.activeId = null; });
    return job;
  }
}
