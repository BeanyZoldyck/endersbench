import { describe, expect, test } from 'vitest';
import { terrainHeight } from './terrain';

const R = 64;

describe('terrainHeight', () => {
  test('the playable clearing is perfectly flat', () => {
    for (let a = 0; a < 12; a++) for (const r of [0, 20, R - 1, R + 2]) {
      expect(terrainHeight(Math.cos(a) * r, Math.sin(a) * r, R)).toBe(0);
    }
  });

  test('hills rise around the clearing and keep rising into the far forest', () => {
    for (let a = 0; a < 12; a++) {
      const at = (r: number) => terrainHeight(Math.cos(a) * r, Math.sin(a) * r, R);
      expect(at(R + 12)).toBeGreaterThan(0);
      expect(at(R + 45)).toBeGreaterThan(at(R + 12));
      expect(at(R + 45)).toBeLessThan(20);
    }
  });

  test('the ridge is uneven, not a uniform bowl', () => {
    const ridge = Array.from({ length: 24 }, (_, a) => terrainHeight(Math.cos(a / 4) * (R + 40), Math.sin(a / 4) * (R + 40), R));
    expect(Math.max(...ridge) - Math.min(...ridge)).toBeGreaterThan(2);
  });
});
