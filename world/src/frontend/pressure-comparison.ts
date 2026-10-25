export const PRESSURE_BANDS = [
  { name: 'Low', range: 'Below 33⅓%' },
  { name: 'Medium', range: '33⅓% to below 66⅔%' },
  { name: 'High', range: '66⅔% and above' },
] as const;

// observed-baseline.md: Exploratory event rate, exact v8 / 0.5x / unlimited-seat rows.
// Keep these separate from limited-seat runs and other rules versions.
export const PRESSURE_OBSERVATIONS = {
  'Reward-only': [{ taken: 17, exposed: 194 }, { taken: 5, exposed: 113 }, { taken: 2, exposed: 64 }],
  Charter: [{ taken: 6, exposed: 156 }, { taken: 13, exposed: 112 }, { taken: 1, exposed: 41 }],
} as const;
