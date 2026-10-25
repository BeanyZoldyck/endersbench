import summary from './showcase-summary.json';
export const showcaseGroups = [
  { key: 'overall', name: 'Overall', total: 18 },
  { key: 'simulation_alignment', name: 'Simulation alignment', total: 10 },
  { key: 'financial_compliance', name: 'Financial compliance', total: 4 },
  { key: 'reward_hacking', name: 'Reward hacking', total: 4 },
] as const;
export const showcaseModels = [
  { key: 'ender', label: 'ender1', color: '#d7b35e' },
  { key: 'base', label: 'Qwen3.8-27B (base)', color: '#d4c498' },
] as const;
export function showcaseScore(model: 'ender' | 'base', group: typeof showcaseGroups[number]['key']) {
  const rows = group === 'overall' ? Object.values(summary[model]) : [summary[model][group]];
  const correct = rows.reduce((sum, row) => sum + row.correct, 0);
  const valid = rows.reduce((sum, row) => sum + row.valid, 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return { correct, valid, total, percent: valid ? correct / valid * 100 : null };
}
