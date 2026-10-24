// What a container's glow says about its contents. Pure, so it is tested
// without a renderer; ItemGlow.tsx draws it.

export type GlowKind = 'food' | 'wood' | 'medical' | 'flare';

export const GLOW: Record<GlowKind, { color: string; label: string }> = {
  food: { color: '#e2725b', label: 'Food' },
  wood: { color: '#9fbf7a', label: 'Wood' },
  medical: { color: '#bfe6e4', label: 'Medical' },
  flare: { color: '#f5b041', label: 'Flare' },
};

// Weapons are carried, not stored supplies, so they never glow.
const WEAPONS = new Set(['spear', 'flaming_spear']);

export function glowCategory(kind: string): GlowKind {
  if (kind === 'wood') return 'wood';
  if (kind === 'medkit') return 'medical';
  if (kind === 'flare') return 'flare';
  return 'food';
}

// The colour of the biggest kind, a ring for the next biggest, and a brightness
// that grows softly with how much is there. Null when there is nothing to show.
export function glowFor(items: ReadonlyArray<{ kind: string; qty: number }>) {
  const totals = new Map<GlowKind, number>();
  for (const i of items) if (i.qty > 0 && !WEAPONS.has(i.kind)) totals.set(glowCategory(i.kind), (totals.get(glowCategory(i.kind)) ?? 0) + i.qty);
  if (totals.size === 0) return null;
  const ranked = [...totals].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((n, [, q]) => n + q, 0);
  return {
    color: GLOW[ranked[0][0]].color,
    ring: ranked[1] ? GLOW[ranked[1][0]].color : null,
    intensity: Math.min(1, 0.3 + Math.log2(total + 1) / 6),
  };
}
