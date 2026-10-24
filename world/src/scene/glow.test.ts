import { describe, expect, test } from 'vitest';
import { GLOW, glowCategory, glowFor } from './glow';

const stack = (kind: string, qty: number) => ({ kind, qty });

describe('glowCategory', () => {
  test('groups item kinds into the four glow kinds', () => {
    expect(['berries', 'ration', 'meat'].map(glowCategory)).toEqual(['food', 'food', 'food']);
    expect(glowCategory('wood')).toBe('wood');
    expect(glowCategory('medkit')).toBe('medical');
    expect(glowCategory('flare')).toBe('flare');
  });
});

describe('glowFor', () => {
  test('a weapon is not a supply: it does not make anyone glow', () => {
    expect(glowFor([stack('spear', 1)])).toBeNull();
    expect(glowFor([stack('flaming_spear', 1), stack('spear', 1)])).toBeNull();
    const withWood = glowFor([stack('spear', 1), stack('wood', 3)]);
    expect(withWood?.color).toBe(GLOW.wood.color);
    expect(withWood?.ring).toBeNull();
  });

  test('an empty container does not glow', () => {
    expect(glowFor([])).toBeNull();
    expect(glowFor([stack('berries', 0)])).toBeNull();
  });

  test('glows in the colour of its biggest kind, with a ring for the next', () => {
    const g = glowFor([stack('wood', 2), stack('berries', 3), stack('ration', 4)])!;
    expect(g.color).toBe(GLOW.food.color); // 7 food beats 2 wood
    expect(g.ring).toBe(GLOW.wood.color);
  });

  test('a single kind has no second ring', () => {
    expect(glowFor([stack('medkit', 1)])!.ring).toBeNull();
  });

  test('brightness grows with quantity but stays within a soft range', () => {
    const one = glowFor([stack('berries', 1)])!.intensity;
    const many = glowFor([stack('berries', 24)])!.intensity;
    expect(one).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(one);
    expect(many).toBeLessThanOrEqual(1);
  });
});
