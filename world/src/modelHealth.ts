// When a model's calls keep failing (credits gone, rate-limited, too slow), its
// survivors stop acting and starve. Say so on screen, so a presenter can switch
// to a replay instead of narrating a world that has quietly stopped.
type Health = { modelId: string; failingInARow: number; lastError: string };

const FAILING_IN_A_ROW = 3;
const CAUSES: Array<[RegExp, string]> = [
  [/usage limit/i, 'usage limit reached'],
  [/out of credits/i, 'out of credits'],
  [/no answer in time/i, 'no answer in time'],
];

export function modelTrouble(rows: readonly Health[]): string | null {
  const h = rows.find(r => r.failingInARow >= FAILING_IN_A_ROW);
  if (!h) return null;
  const cause = CAUSES.find(([pattern]) => pattern.test(h.lastError))?.[1]
    ?? (h.lastError.length > 60 ? `${h.lastError.slice(0, 60)}…` : h.lastError);
  return `${h.modelId.replace(/^\w+:/, '')} calls are failing: ${cause}`;
}
