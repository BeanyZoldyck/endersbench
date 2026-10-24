// What a resource node is and gives, by kind. Trees and wood piles are woody;
// berry bushes and berry thickets bear berries. Code that cares about wood
// versus berries asks here, so a new kind only has to be added in one place.

export function isWoody(kind: string): boolean {
  return kind === 'tree' || kind === 'wood_pile';
}

export function isBerry(kind: string): boolean {
  return kind === 'berry_bush' || kind === 'berry_thicket';
}

// The item one pick from this kind of node puts in your hands.
export function yields(kind: string): 'wood' | 'berries' {
  return isWoody(kind) ? 'wood' : 'berries';
}
