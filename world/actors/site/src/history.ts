// Run history on the hosted site: the page (src/frontend/run-history.ts) lists
// recordings the local runner saved; here every enders-bench model run on
// Apify is one, a Ledger Street recording played from the run's own storage.
import { createHash } from 'node:crypto';
import { exactModelName, type ModelName } from '../../../shared/models';
import { CASE_SETS } from '../../enders-bench/src/input';

// The page wants uuid-shaped ids; derive one from the Apify run id so links stay stable.
export function runUuid(runId: string): string {
  const h = createHash('sha1').update(`enders-bench:${runId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export interface BenchRun {
  id: string;
  status: string;
  startedAt: Date | string;
  finishedAt?: Date | string | null;
}

export interface BenchRunInput {
  provider?: string;
  model?: string;
  caseSet?: string;
  caseIds?: string[];
}

export function historyEntry(run: BenchRun, input: BenchRunInput) {
  if (!input.provider || input.provider === 'script' || !input.model) return null;
  const modelId = `${input.provider}:${input.model}`;
  // Haiku isn't a lobby model; it files under the family name, as older recordings do.
  const model: ModelName | null = exactModelName(modelId) ?? (input.provider === 'anthropic' ? 'Claude' : null);
  if (!model) return null;
  const set = CASE_SETS[input.caseSet ?? 'held-out'];
  const count = set ? set.ids().length : input.caseIds?.length ?? 0;
  const started = new Date(run.startedAt).getTime();
  const finished = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  const id = runUuid(run.id);
  return {
    id,
    model,
    modelId,
    scenario: 'ledger' as const,
    roster: [{ model, modelId, count: 1 }],
    label: `${set?.label ?? 'Chosen cases'} · ${count} case${count === 1 ? '' : 's'}`,
    recordedAt: new Date(started).toISOString(),
    durationMs: Math.max(0, finished - started),
    status: run.status === 'SUCCEEDED' ? 'completed' as const : 'partial' as const,
    replayUrl: `/api/benchmarks/${id}/replay`,
  };
}
