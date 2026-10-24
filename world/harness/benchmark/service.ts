import { randomUUID } from 'node:crypto';
import { MODEL_IDS, SCENARIO_ID, type BenchmarkJob, type ModelName } from './types.js';

export type Executor = (job: BenchmarkJob, onRunning: () => void) => Promise<unknown>;
export type Config = { ready: boolean; reason?: string; models: Array<{ id: ModelName; modelId: string | null; available: boolean; reason?: string }> };
export class RequestError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}

export class BenchmarkService {
  private readonly jobs = new Map<string, BenchmarkJob>();
  private activeId: string | null = null;

  constructor(private readonly config: () => Promise<Config>, private readonly execute: Executor) {}

  get(id: string): BenchmarkJob | undefined { return this.jobs.get(id); }
  list(): BenchmarkJob[] { return [...this.jobs.values()].reverse(); }

  async start(input: unknown): Promise<BenchmarkJob> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError(400, 'Expected a benchmark request.');
    const request = input as Record<string, unknown>;
    if (Object.keys(request).sort().join(',') !== 'model,scenario'
      || typeof request.model !== 'string' || !MODEL_IDS.includes(request.model as ModelName)
      || request.scenario !== SCENARIO_ID) throw new RequestError(400, 'Choose a supported model and scenario.');
    if (this.activeId) throw new RequestError(409, 'A benchmark is already running.');
    const config = await this.config();
    if (this.activeId) throw new RequestError(409, 'A benchmark is already running.');
    if (!config.ready) throw new RequestError(503, config.reason ?? 'Benchmark runner is unavailable.');
    const selected = config.models.find(model => model.id === request.model);
    if (!selected?.available || !selected.modelId) throw new RequestError(422, selected?.reason ?? 'Model mapping is unavailable.');
    const id = randomUUID();
    const job: BenchmarkJob = {
      id, status: 'starting', model: selected.id, modelId: selected.modelId,
      scenario: SCENARIO_ID, dbName: `endersbench-run-${id}`, host: 'ws://localhost:3000',
    };
    this.jobs.set(id, job);
    this.activeId = id;
    void this.execute(job, () => { if (job.status === 'starting') job.status = 'running'; })
      .then(report => {
        if (job.status === 'failed') return;
        job.report = report;
        job.summary = 'The run completed and its report is ready.';
        job.status = 'completed';
      })
      .catch(() => {
        job.error = 'Benchmark failed. Check the local runner logs.';
        job.status = 'failed';
      })
      .finally(() => { if (this.activeId === id) this.activeId = null; });
    return job;
  }
}
