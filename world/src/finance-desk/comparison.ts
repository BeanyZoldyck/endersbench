import type { FinanceCase, FinanceStep, FinanceVerdict } from '../module_bindings/types';
import type { CrsCall, Step, Verdict } from '../../spacetimedb/src/finance/types';
import { scenarioFor } from './conditions';
import { EVENT_STEP } from '../../spacetimedb/src/finance/engine';
import { describe } from './format';

export type Station = 'research' | 'phone' | 'decision' | 'audit';
export const STATIONS: Record<Station, { label: string; x: number; z: number }> = {
  research: { label: 'Research terminal', x: -2.15, z: -2.35 },
  phone: { label: 'Client line', x: 2.1, z: -2.35 },
  decision: { label: 'Decision desk', x: -1.7, z: .45 },
  audit: { label: 'Audit & records', x: 2.1, z: .45 },
};
export const OFFICE_COLORS = ['#8d6a4f', '#527b78', '#978145', '#7b7491'];
export function stationFor(tool?: string): Station {
  if (tool === 'report_to_supervisor' || tool === 'edit_decision_record' || tool === 'disable_audit_log' || tool === 'grant_self_permission') return 'audit';
  if (tool === 'verify_vendor_by_phone' || tool === 'send_message' || tool === 'contact_debtor' || tool === 'contact_third_party') return 'phone';
  if (tool && /^(pull_|verify_identity|check_|search_|criminal_|eviction_|reverse_)/.test(tool)) return 'research';
  return 'decision';
}
export function modelName(id: string) {
  const names: Record<string, string> = { 'script:policy': 'Policy reference', 'script:pleaser': 'People pleaser', 'script:revenue': 'Shortcut taker', 'script:escalate-all': 'Escalation baseline' };
  return names[id] ?? id.slice(id.indexOf(':') + 1).replace(/^.*\//, '');
}
export function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
export function cohortKey(row: FinanceCase) {
  return `${row.scenarioId}|${row.variant}|${row.sample}|${row.benchmarkVersion}`;
}
const replicaKey = (row: FinanceCase) => `${row.scenarioId}|${row.variant}|replicas|${row.benchmarkVersion}`;
export type ComparisonGroup = { key: string; row: FinanceCase; latest: bigint; models: Set<string>; samples: number[]; replicas: boolean };
export function cohorts(rows: readonly FinanceCase[]) {
  const groups = new Map<string, ComparisonGroup>();
  const families = new Map<string, FinanceCase[]>();
  for (const row of rows) {
    const family = replicaKey(row);
    families.set(family, [...(families.get(family) ?? []), row]);
    const key = cohortKey(row), found = groups.get(key);
    const queuedAt = row.queuedAt.microsSinceUnixEpoch;
    if (!found) groups.set(key, { key, row, latest: queuedAt, models: new Set([row.modelId]), samples: [row.sample], replicas: false });
    else { found.models.add(row.modelId); if (queuedAt > found.latest) found.latest = queuedAt; }
  }
  // Repeated attempts of one model share a labelled comparison. Multi-model
  // comparisons still match the exact sample, case, policy and version.
  for (const [key, family] of families) {
    const models = new Set(family.map(row => row.modelId)), samples = [...new Set(family.map(row => row.sample))].sort((a, b) => a - b);
    if (models.size !== 1 || samples.length < 2) continue;
    const row = family.reduce((latest, next) => next.queuedAt.microsSinceUnixEpoch > latest.queuedAt.microsSinceUnixEpoch ? next : latest);
    for (const item of family) groups.delete(cohortKey(item));
    groups.set(key, { key, row, latest: row.queuedAt.microsSinceUnixEpoch, models, samples, replicas: true });
  }
  return [...groups.values()].sort((a, b) => a.latest > b.latest ? -1 : a.latest < b.latest ? 1 : 0);
}
export function comparisonKeyFor(row: FinanceCase, cases: readonly FinanceCase[]) {
  return cohorts(cases).find(group => group.key === cohortKey(row) || (group.replicas && group.key === replicaKey(row)))?.key ?? cohortKey(row);
}
export type Office = {
  id: string; name: string; color: string; modelId: string; row?: FinanceCase;
  steps: Step[]; notes: string[]; verdict?: FinanceVerdict; detail?: Verdict;
  lastAction?: Step; thought?: string; station: Station; activity: string; decision?: string;
};
export function officesFor(key: string | undefined, cases: readonly FinanceCase[], steps: readonly FinanceStep[], verdicts: readonly FinanceVerdict[]): Office[] {
  const latest = new Map<string, FinanceCase>();
  const replicas = key?.split('|')[2] === 'replicas';
  for (const row of cases) {
    if ((replicas ? replicaKey(row) : cohortKey(row)) !== key) continue;
    const identity = replicas ? `${row.modelId}|${row.sample}` : row.modelId;
    if (!latest.has(identity) || latest.get(identity)!.queuedAt.microsSinceUnixEpoch < row.queuedAt.microsSinceUnixEpoch) latest.set(identity, row);
  }
  const selected = [...latest.values()].sort((a, b) => replicas ? a.sample - b.sample || a.modelId.localeCompare(b.modelId) : a.modelId.localeCompare(b.modelId)).slice(0, 4);
  return Array.from({ length: 4 }, (_, index) => {
    const row = selected[index], modelId = row?.modelId ?? '';
    const recorded = row ? steps.filter(s => s.caseId === row.id).sort((a, b) => a.seq - b.seq) : [];
    const timeline: Step[] = recorded.map(s => ({ tool: s.tool, args: parseJson(s.args, {}), ...(s.result ? { result: parseJson(s.result, {}) } : {}), ...(s.crs ? { crs: parseJson<CrsCall | undefined>(s.crs, undefined) } : {}) }));
    const lastAction = [...timeline].reverse().find(s => s.tool !== EVENT_STEP);
    const thought = [...recorded].reverse().find(s => s.tool !== EVENT_STEP)?.thought.trim() || undefined;
    const verdict = row ? verdicts.find(v => v.caseId === row.id) : undefined;
    const scenario = row && scenarioFor(row);
    const line = scenario && lastAction ? describe(scenario, lastAction) : undefined;
    return {
      id: row ? String(row.id) : `empty-${index}`, name: modelId ? `${modelName(modelId)}${replicas ? ` · run ${row.sample + 1}` : ''}` : `Office ${String(index + 1).padStart(2, '0')}`,
      color: OFFICE_COLORS[index], modelId, row, steps: timeline, notes: recorded.map(s => s.thought), verdict,
      detail: verdict ? parseJson<Verdict | undefined>(verdict.verdict, undefined) : undefined,
      lastAction, thought, station: stationFor(lastAction?.tool),
      activity: row?.stopped ? 'Run interrupted' : row?.status === 'closed' ? 'Case complete' : row?.status === 'queued' ? 'In the queue' : line?.kind === 'action' ? line.title : (row ? 'Opening the case' : 'Awaiting an agent'),
      decision: verdict?.decision || [...timeline].reverse().find(s => /^(approve_loan|decline_application|report_fraud|escalate_to_human|contact_debtor|pause_collection|release_payment|hold_payment)$/.test(s.tool))?.tool,
    };
  });
}
