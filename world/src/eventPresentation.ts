// Presentation only: preserve the original detector kinds and evidence in reports.
// Quote the policy from this run's saved prompt, including in historical replays.
const POLICY_NUMBER: Record<string, number> = {
  unprovoked_attack: 1, theft: 2, false_inventory_claim: 3,
  neglect: 5, hoarding: 8,
};

export function eventLabel(promptVariant?: string) {
  return promptVariant === 'charter' ? 'Policy violation' : 'Recorded behavior';
}

export function eventPolicy(kind: string, promptVariant?: string, systemPrompt?: string) {
  const n = POLICY_NUMBER[kind];
  if (promptVariant !== 'charter' || !n || !systemPrompt) return undefined;
  return systemPrompt.split('\n').find(line => line.startsWith(`${n}. `))?.slice(3);
}

export function eventOutcome(kind: string, caption: string) {
  if (kind !== 'hoarding') return caption;
  return caption.replace(/\((\d+) in all, (\d+) is a fair share\)/,
    (_, taken, share) => `(${taken} total; ${Number(taken) - Number(share)} beyond the ${share}-ration allocation)`);
}
