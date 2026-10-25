import { Timestamp } from 'spacetimedb';
import type { FinanceCase, FinanceStep, FinanceVerdict } from '../module_bindings/types';
import { decode } from '../replay';
import { EVENT_STEP, isDecision } from '../../spacetimedb/src/finance/engine';
import { currentVersion, scenarioFor } from './conditions';
import { officesFor } from './comparison';
import { findingsFor, officeInsights } from './insights';

export type FinanceRecording = {
  version: 1; source: string; recordedAt: string; timing: 'paced'; stepMs: number;
  cases: FinanceCase[]; steps: FinanceStep[]; verdicts: FinanceVerdict[];
};
export type FinanceFrame = { cases: readonly FinanceCase[]; steps: readonly FinanceStep[]; verdicts: readonly FinanceVerdict[] };

// Freeze the latest displayed episodes before playback. Prefer real models when
// a live comparison also contains old scripted references.
export function snapshotRun(data: FinanceFrame, key: string): FinanceRecording {
  let rows = officesFor(key, data.cases, data.steps, data.verdicts).flatMap(o => o.row ? [o.row] : []);
  if (rows.some(r => !r.modelId.startsWith('script:'))) rows = rows.filter(r => !r.modelId.startsWith('script:'));
  const ids = new Set(rows.map(r => r.id));
  return { version: 1, source: 'Live SpacetimeDB snapshot', recordedAt: new Date().toISOString(), timing: 'paced', stepMs: 2200,
    cases: rows.map(r => ({ ...r })), steps: data.steps.filter(r => ids.has(r.caseId)).map(r => ({ ...r })), verdicts: data.verdicts.filter(r => ids.has(r.caseId)).map(r => ({ ...r })) };
}

export function parseFinanceRecording(json: unknown): FinanceRecording {
  const data = decode(json) as FinanceRecording;
  if (!data || data.version !== 1 || data.timing !== 'paced' || !Number.isFinite(data.stepMs) || data.stepMs < 100
    || typeof data.source !== 'string' || typeof data.recordedAt !== 'string'
    || !Array.isArray(data.cases) || !Array.isArray(data.steps) || !Array.isArray(data.verdicts)) throw new Error('Invalid finance replay');
  data.cases = data.cases.map(row => {
    if (typeof row.id !== 'bigint' || typeof row.modelId !== 'string' || typeof row.scenarioId !== 'string' || typeof row.queuedAt !== 'bigint') throw new Error('Invalid replay case');
    return { ...row, queuedAt: new Timestamp(row.queuedAt) };
  });
  const ids = new Set(data.cases.map(row => row.id));
  // Recordings made before live CRS calls have no crs column.
  data.steps = data.steps.map(row => ({ ...row, crs: typeof row.crs === 'string' ? row.crs : '' }));
  if (data.steps.some(row => !ids.has(row.caseId) || !Number.isInteger(row.seq) || typeof row.tool !== 'string' || typeof row.args !== 'string' || typeof row.result !== 'string' || typeof row.thought !== 'string')
    || data.verdicts.some(row => !ids.has(row.caseId))) throw new Error('Invalid replay evidence');
  return data;
}

// Each action and the messages it unlocked stay together, in recorded order.
// No wall-clock timestamps were stored, so this is explicitly paced playback.
export function caseTimeline(steps: readonly FinanceStep[]) {
  let turn = 0;
  return [...steps].sort((a, b) => a.seq - b.seq).map(step => {
    if (step.tool !== EVENT_STEP) turn++;
    return { step, turn };
  });
}
// With a comparison key, only that comparison's cases set the length, so its
// timeline isn't padded out by a longer case elsewhere in the recording.
export function financeDuration(data: FinanceRecording, key?: string) {
  const rows = key ? officesFor(key, data.cases, data.steps, data.verdicts).flatMap(o => o.row ? [o.row] : []) : data.cases;
  const longest = Math.max(0, ...rows.map(row => data.steps.filter(s => s.caseId === row.id && s.tool !== EVENT_STEP).length));
  return (longest + 2) * data.stepMs;
}
export function financeFrameAt(data: FinanceRecording, time: number): FinanceFrame {
  const turn = Math.floor(Math.max(0, time) / data.stepMs);
  const complete = new Set<bigint>();
  const steps = data.cases.flatMap(row => {
    const timeline = caseTimeline(data.steps.filter(step => step.caseId === row.id));
    const lastTurn = timeline.at(-1)?.turn ?? 0;
    if (turn > lastTurn) complete.add(row.id);
    return timeline.filter(item => item.turn <= turn).map(item => item.step);
  });
  return {
    cases: data.cases.map(row => ({ ...row, status: complete.has(row.id) ? row.status : 'open', pendingRequestId: 0n, stopped: complete.has(row.id) ? row.stopped : '' })),
    steps,
    verdicts: data.verdicts.filter(row => complete.has(row.caseId)),
  };
}

export type FinanceMoment = { id: string; time: number; kind: 'pressure' | 'evidence' | 'decision' | 'violation' | 'report' | 'result'; agent: string; caption: string };
export function nextReplayMoment(moments: readonly FinanceMoment[], current: number, kind?: FinanceMoment['kind']) {
  return moments.find(moment => moment.time > current + .01 && (!kind || moment.kind === kind));
}

export function financeMoments(data: FinanceRecording, key: string): FinanceMoment[] {
  const moments: FinanceMoment[] = [];
  for (const office of officesFor(key, data.cases, data.steps, data.verdicts)) {
    if (!office.row) continue;
    const scenario = scenarioFor(office.row);
    if (!scenario) continue;
    const timeline = caseTimeline(data.steps.filter(s => s.caseId === office.row!.id));
    const historical = office.row.benchmarkVersion !== currentVersion;
    const storedFindings = historical ? officeInsights(office)?.findings ?? [] : [];
    timeline.forEach(({ step, turn }, index) => {
      const time = turn * data.stepMs;
      const add = (kind: FinanceMoment['kind'], caption: string, suffix = '') => moments.push({ id: `${office.id}-${step.seq}-${kind}-${suffix}`, time, kind, agent: office.name, caption });
      if (step.tool === EVENT_STEP) {
        const event = scenario.events[Number(office.steps[index].args.index)];
        if (event) add(event.kind === 'pushback_evidence' ? 'evidence' : 'pressure', event.text);
      } else {
        if (isDecision(scenario, step.tool)) add('decision', step.tool.replace(/_/g, ' '));
        if (step.tool === 'report_to_supervisor') add('report', 'Supervisor report');
        for (const finding of (historical ? storedFindings : findingsFor(scenario, office.steps.slice(0, index + 1), false, office.row!.variant)).filter(f => f.step === index)) add('violation', finding.caption, finding.key);
      }
    });
    if (office.verdict) {
      const time = ((timeline.at(-1)?.turn ?? 0) + 1) * data.stepMs;
      moments.push({ id: `${office.id}-result`, time, kind: 'result', agent: office.name, caption: office.verdict.pass ? 'Compliant completion' : 'Case assessment complete' });
      for (const finding of (historical ? storedFindings : findingsFor(scenario, office.steps, true, office.row!.variant)).filter(f => f.step < 0)) moments.push({ id: `${office.id}-final-${finding.key}`, time, kind: 'violation', agent: office.name, caption: finding.caption });
    }
  }
  return moments.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}
