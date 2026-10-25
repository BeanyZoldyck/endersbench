// Ledger Street lineups on the hosted site: up to four agents at once, each its
// own enders-bench run, watched side by side. The site merges the runs'
// recordings into one, so the offices fill with every agent on the same case,
// and lists the runs as one entry. A lineup's address is its run ids joined by
// commas, so a link to it needs nothing the site has to remember.
export const DONE = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);
export const MAX_LINEUP = 4;

const RUN_ID = /^[A-Za-z0-9]+$/;

export function lineupIds(segment: string): string[] | null {
  const ids = segment.split(',');
  return ids.length <= MAX_LINEUP && ids.every(id => RUN_ID.test(id)) && new Set(ids).size === ids.length ? ids : null;
}

export const replayPath = (ids: string[]) => `/api/apify/runs/${ids.join(',')}/replay`;

type Big = { $big: string };
type Row = Record<string, unknown>;
export interface Recording {
  version: number;
  source: string;
  recordedAt: string;
  timing: string;
  stepMs: number;
  lineup?: boolean;
  cases: (Row & { id: Big; modelId: string; sample: number })[];
  steps: (Row & { id: Big; caseId: Big })[];
  verdicts: (Row & { caseId: Big })[];
  inProgress?: boolean;
  progress?: { done: number; total: number };
}

const shift = (id: Big, by: number): Big => ({ $big: String(Number(id.$big) + by) });
const highest = (ids: Big[]) => Math.max(0, ...ids.map(id => Number(id.$big)));

// One recording of every run's cases, ids renumbered so they don't collide.
// The viewer compares rows of the same case, policy and sample, so each case
// opens with every agent in its own office. An agent picked twice has a
// second sample; the lineup flag puts those runs in offices beside the rest.
export function mergeRecordings(parts: Recording[], source: string): Recording {
  const cases: Recording['cases'] = [], steps: Recording['steps'] = [], verdicts: Recording['verdicts'] = [];
  let caseBase = 0, stepBase = 0;
  for (const part of parts) {
    cases.push(...part.cases.map(c => ({ ...c, id: shift(c.id, caseBase) })));
    steps.push(...part.steps.map(s => ({ ...s, id: shift(s.id, stepBase), caseId: shift(s.caseId, caseBase) })));
    verdicts.push(...part.verdicts.map(v => ({ ...v, caseId: shift(v.caseId, caseBase) })));
    caseBase += highest(part.cases.map(c => c.id));
    stepBase += highest(part.steps.map(s => s.id));
  }
  const models = new Set(cases.map(c => c.modelId));
  return {
    version: 1,
    source,
    recordedAt: parts.map(p => p.recordedAt).sort()[0] ?? new Date().toISOString(),
    timing: 'paced',
    stepMs: parts[0]?.stepMs ?? 2200,
    ...(models.size > 1 && cases.some(c => c.sample > 0) ? { lineup: true } : {}),
    cases,
    steps,
    verdicts,
    inProgress: parts.some(p => p.inProgress === true),
    progress: parts.reduce((sum, p) => ({ done: sum.done + (p.progress?.done ?? 0), total: sum.total + (p.progress?.total ?? p.cases.length) }), { done: 0, total: 0 }),
  };
}

export interface RunSummary {
  runId: string;
  label: string;
  status: string;
  statusMessage: string;
  startedAt: string;
  finishedAt: string | null;
  replayUrl: string;
}

// A lineup's runs as one: going while any is, done when all are, and
// succeeded if any agent finished its cases.
export function lineupSummary(ids: string[], runs: RunSummary[]): RunSummary {
  const going = runs.filter(r => !DONE.has(r.status));
  const failed = runs.filter(r => DONE.has(r.status) && r.status !== 'SUCCEEDED');
  const status = going.length
    ? (going.find(r => r.status === 'RUNNING') ?? going[0]).status
    : runs.some(r => r.status === 'SUCCEEDED') ? 'SUCCEEDED' : runs[0]?.status ?? 'READY';
  const done = runs.length - going.length;
  const statusMessage = going.length
    ? `${done} of ${runs.length} agents done`
    : failed.length ? `${failed.map(r => r.label).join(', ')} didn’t finish` : `All ${runs.length} agents done`;
  return {
    runId: ids.join(','),
    // Short names: "Ender 1.1 (our fine-tuned Qwen3.8-27B)" reads as Ender 1.1 here.
    label: runs.map(r => r.label.replace(/\s*\(.*\)\s*$/, '')).join(' + '),
    status,
    statusMessage,
    startedAt: runs.map(r => r.startedAt).sort()[0] ?? new Date().toISOString(),
    finishedAt: going.length ? null : runs.map(r => r.finishedAt ?? '').sort().at(-1) || null,
    replayUrl: replayPath(ids),
  };
}

// Newest first, a lineup's runs folded into one entry where its newest run was.
export function groupRuns<T extends RunSummary>(runs: T[], lineupOf: (runId: string) => string[] | undefined): (T | RunSummary)[] {
  const out: (T | RunSummary)[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    const ids = lineupOf(run.runId);
    if (!ids) {
      out.push(run);
      continue;
    }
    const key = ids.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lineupSummary(ids, ids.map(id => runs.find(r => r.runId === id)).filter((r): r is T => r !== undefined)));
  }
  return out;
}

// How many jobs Apify runs at once on the account, how many are going (this
// site is one), and how many agents could start now.
export interface Slots {
  max: number;
  going: number;
  free: number;
}

export function roomLine(slots: Slots, agents: number) {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (!slots.free) return `Apify runs ${slots.max} jobs at once on this account and all ${slots.max} are going (this site is one). Start when a run ends.`;
  return `Apify runs ${slots.max} jobs at once on this account and ${slots.going} are going (this site is one), so ${plural(slots.free, 'agent')} can start now, not ${agents}. Pick fewer, or start when a run ends.`;
}
