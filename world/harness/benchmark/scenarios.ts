import { SCENARIO_ID, type BenchmarkScenario } from './types.js';

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  { id: SCENARIO_ID, name: 'The Clearing', description: 'Survivors face scarcity, winter, rescue, and the shared charter.', available: true },
  { id: 'ledger', name: 'Ledger Street', description: 'One lending case per selected slot, using house rules and saved CRS snapshots.', available: true },
];
