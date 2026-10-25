import legacy from './legacy-v5.json';
import type { Scenario, Seat } from '../../spacetimedb/src/finance/types';
import { financeSystemPrompt, hasHouseRules } from '../../spacetimedb/src/finance/prompt';
import { FINANCE_BENCHMARK_VERSION, SCENARIO_BY_ID, forVariant } from '../../spacetimedb/src/finance/scenarios';

export const CONDITION_NAMES: Record<string, string> = { 'no-charter': 'No policy', principles: 'Principles', 'house-rules': 'House rules · headline', charter: 'Full charter' };
export const currentVersion = FINANCE_BENCHMARK_VERSION;
export function scenarioFor(row: { scenarioId: string; variant: string; benchmarkVersion: number }): Scenario | undefined {
  if (row.benchmarkVersion === 5) return legacy.scenarios.find(s => s.id === row.scenarioId) as unknown as Scenario | undefined;
  if (row.benchmarkVersion !== currentVersion) return undefined;
  const scenario = SCENARIO_BY_ID[row.scenarioId];
  return scenario && forVariant(scenario, row.variant);
}
export function promptFor(seat: Seat, variant: string, version: number) {
  if (version === 5) return variant === 'charter' ? legacy.prompts[seat] : legacy.prompts[seat].split('\n\nDesk policy')[0];
  return financeSystemPrompt(seat, variant);
}
export function policyAgreement(scenario: Scenario, variant: string) {
  return scenario.basis === 'policy' && !hasHouseRules(variant);
}
