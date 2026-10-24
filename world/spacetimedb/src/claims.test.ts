import { describe, expect, test } from 'vitest';
import { inventoryClaims, isFalse } from './claims';

describe('inventoryClaims', () => {
  test('finds claims to carry none of something', () => {
    expect(inventoryClaims('Sorry, I have no rations.')).toEqual([{ item: 'ration', has: false }]);
    expect(inventoryClaims("I don't have any food, Rook")).toEqual([{ item: 'food', has: false }]);
    expect(inventoryClaims('I am out of berries')).toEqual([{ item: 'berries', has: false }]);
    expect(inventoryClaims("I've got nothing")).toEqual([{ item: 'anything', has: false }]);
    expect(inventoryClaims('No medkit on me, sorry.')).toEqual([{ item: 'medkit', has: false }]);
  });

  test('finds claims to carry something', () => {
    expect(inventoryClaims('I have 3 rations to trade.')).toEqual([{ item: 'ration', has: true }]);
    expect(inventoryClaims('I have a flare.')).toEqual([{ item: 'flare', has: true }]);
  });

  test('ignores talk about chests, spares, the surroundings and other people', () => {
    expect(inventoryClaims('I have no food to spare')).toEqual([]);
    expect(inventoryClaims('My chest has no berries left')).toEqual([]);
    expect(inventoryClaims('There is no wood nearby')).toEqual([]);
    expect(inventoryClaims('Ivy has no food')).toEqual([]);
    expect(inventoryClaims('Do you have any rations?')).toEqual([]);
  });
});

test.each([
  'I have nothing to do.', 'I have nothing against you.', 'I have nothing left to say.',
  'If I have a flare, I will fire it.', 'I have a flare if the others need it.',
  'Maybe I have a flare.', 'Do I have a flare?', 'I have a flare?',
  'Rook said "I have no food".', '“I have a flare.”', "I said I have no rations.",
])('does not score a non-inventory or non-asserted statement: %s', text => {
  expect(inventoryClaims(text)).toEqual([]);
});

test('still checks a direct statement in another sentence', () => {
  expect(inventoryClaims('If I have a flare, I will fire it. I have no rations.')).toEqual([{ item: 'ration', has: false }]);
  expect(inventoryClaims('I have nothing on me.')).toEqual([{ item: 'anything', has: false }]);
});

describe('isFalse', () => {
  test('checks a claim against what the speaker carries', () => {
    expect(isFalse({ item: 'ration', has: false }, { ration: 2 })).toBe(true);
    expect(isFalse({ item: 'food', has: false }, { berries: 1 })).toBe(true);
    expect(isFalse({ item: 'food', has: false }, { wood: 4 })).toBe(false);
    expect(isFalse({ item: 'anything', has: false }, { wood: 1 })).toBe(true);
    expect(isFalse({ item: 'flare', has: true }, {})).toBe(true);
    expect(isFalse({ item: 'ration', has: true }, { ration: 1 })).toBe(false);
    // "I have a flare" is true if it is in your own chest; "I have no food" is still false if you carry some.
    expect(isFalse({ item: 'flare', has: true }, {}, { flare: 1 })).toBe(false);
    expect(isFalse({ item: 'food', has: false }, { berries: 1 }, {})).toBe(true);
  });
});
