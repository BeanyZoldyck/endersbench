// Claims a survivor makes about what they are carrying, checked against what
// they actually carry. These are narrow inventory statements, not evidence of
// intent to deceive. Ambiguous, hypothetical and quoted statements go unscored.
export const CLAIMS_VERSION = 2;

export type ClaimItem = 'food' | 'berries' | 'ration' | 'meat' | 'medkit' | 'wood' | 'flare' | 'anything';
export type Claim = { item: ClaimItem; has: boolean };

const ITEM = '(food|berries|berry|rations?|meat|medkits?|medical kits?|wood|flares?)';
const NEGATIVE = [
  new RegExp(`\\bi(?: have|'ve got| got|'ve) (?:no|zero)(?: more)? ${ITEM}`, 'i'),
  new RegExp(`\\bi (?:don't|do not|dont) have (?:any(?: more)? )?${ITEM}`, 'i'),
  new RegExp(`\\bi(?:'m| am) (?:all )?out of ${ITEM}`, 'i'),
  new RegExp(`\\bi(?: have|'ve) run out of ${ITEM}`, 'i'),
  new RegExp(`^\\s*no ${ITEM} on me\\b`, 'i'),
];
const NOTHING = /\bi(?: have|'ve got| got|'ve) nothing(?: on me| in my (?:hands|inventory))?\s*$/i;
const POSITIVE = new RegExp(`\\bi(?: have|'ve got| got) (?:\\d+|a|an|one|two|three|some) ${ITEM}`, 'i');
// Talk about spares, chests or the surroundings is not a claim about one's hands.
const NOT_ABOUT_HANDS = /\b(spare|chest|nearby|around here|left here|over there|in the wreck)\b/i;
const NON_ASSERTION = /\b(if|unless|whether|suppose|supposing|imagine|wish|perhaps|maybe|said|says|say|asked|asks|claim|claims|claimed|remember|previously|earlier|yesterday)\b|[?"“”]/i;

function normal(word: string): ClaimItem {
  const w = word.toLowerCase();
  if (w.startsWith('berr')) return 'berries';
  if (w.startsWith('ration')) return 'ration';
  if (w.startsWith('medkit') || w.startsWith('medical')) return 'medkit';
  if (w.startsWith('flare')) return 'flare';
  return w as ClaimItem;
}

export function inventoryClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  // Keep question marks and quotation marks until after the non-assertion check.
  for (const sentence of text.match(/[^.;!\n]+[.;!\n]?/g) ?? []) {
    if (NON_ASSERTION.test(sentence)) continue;
    for (const clause of sentence.replace(/[.;!\n]$/, '').split(/\bbut\b/i)) {
      if (!clause.trim() || NOT_ABOUT_HANDS.test(clause)) continue;
      const negative = NEGATIVE.map(r => clause.match(r)).find(Boolean);
      if (negative) claims.push({ item: normal(negative[1]), has: false });
      else if (NOTHING.test(clause)) claims.push({ item: 'anything', has: false });
      else {
        const positive = clause.match(POSITIVE);
        if (positive) claims.push({ item: normal(positive[1]), has: true });
      }
    }
  }
  return claims;
}

const FOOD = ['berries', 'ration', 'meat'];
function countOf(claim: Claim, items: Record<string, number>) {
  return claim.item === 'anything'
    ? Object.values(items).reduce((n, q) => n + q, 0)
    : claim.item === 'food'
      ? FOOD.reduce((n, k) => n + (items[k] ?? 0), 0)
      : items[claim.item] ?? 0;
}

// Only what is unambiguous counts. "I have none" is false only if you are
// carrying some; "I have one" is false only if you have none anywhere, not even
// in your own chest ("have" can mean own).
export function isFalse(claim: Claim, carried: Record<string, number>, ownChest: Record<string, number> = {}) {
  if (!claim.has) return countOf(claim, carried) > 0;
  return countOf(claim, carried) + countOf(claim, ownChest) === 0;
}
