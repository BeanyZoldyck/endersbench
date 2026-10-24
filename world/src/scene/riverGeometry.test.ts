import { describe, expect, it } from 'vitest';
import { extendEnds, ribbon } from './riverGeometry';

const line: Array<[number, number]> = [[0, 0], [10, 0], [20, 0]];
const vertex = (r: ReturnType<typeof ribbon>, i: number) => [r.positions[i * 3], r.positions[i * 3 + 2]];

describe('river ribbon', () => {
  it('makes a left and a right bank vertex for every point, a width apart and centred on the path', () => {
    const r = ribbon(line, 4);
    expect(r.positions.length / 3).toBe(6);
    for (let i = 0; i < 3; i++) {
      const [lx, lz] = vertex(r, i * 2), [rx, rz] = vertex(r, i * 2 + 1);
      expect(Math.hypot(lx - rx, lz - rz)).toBeCloseTo(4);
      expect((lx + rx) / 2).toBeCloseTo(line[i][0]);
      expect((lz + rz) / 2).toBeCloseTo(line[i][1]);
      expect(lx).toBeCloseTo(rx); // a path along x has banks along z
    }
  });
  it('is perpendicular to a curving path at the bend', () => {
    const r = ribbon([[0, 0], [10, 0], [10, 10]], 2);
    const [lx, lz] = vertex(r, 2), [rx, rz] = vertex(r, 3);
    // The bend's tangent is the average of its two segments, (1, 1) normalised.
    expect((lx - rx) * 1 + (lz - rz) * 1).toBeCloseTo(0);
    expect(Math.hypot(lx - rx, lz - rz)).toBeCloseTo(2);
  });
  it('lays two triangles on every segment and runs the v coordinate along the length', () => {
    const r = ribbon(line, 4);
    expect(r.indices).toHaveLength(2 * 3 * 2);
    expect(Math.max(...r.indices)).toBe(5);
    expect(r.length).toBeCloseTo(20);
    const v = [0, 2, 4].map(i => r.uvs[i * 2 + 1]);
    expect(v).toEqual([0, 10, 20]);
    expect([r.uvs[0], r.uvs[2]]).toEqual([0, 1]); // u runs bank to bank
  });
  it('faces up, so it is seen from above and not from beneath', () => {
    for (const path of [line, [[0, 0], [10, 0], [10, 10]] as Array<[number, number]>]) {
      const r = ribbon(path, 3);
      for (let t = 0; t < r.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map(k => r.indices[t + k] * 3);
        const u = [0, 1, 2].map(i => r.positions[b + i] - r.positions[a + i]), v = [0, 1, 2].map(i => r.positions[c + i] - r.positions[a + i]);
        expect(u[2] * v[0] - u[0] * v[2]).toBeGreaterThan(0); // the y component of u x v
      }
    }
  });
  it('narrows and widens by a fraction when asked to wobble, but never collapses', () => {
    const r = ribbon(line, 4, 0.25);
    for (let i = 0; i < 3; i++) {
      const [lx, lz] = vertex(r, i * 2), [rx, rz] = vertex(r, i * 2 + 1);
      expect(Math.hypot(lx - rx, lz - rz)).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(Math.hypot(lx - rx, lz - rz)).toBeLessThanOrEqual(5 + 1e-9);
    }
  });
  it('draws nothing for less than a line', () => {
    expect(ribbon([[1, 1]], 3).positions).toHaveLength(0);
    expect(ribbon([], 3).indices).toHaveLength(0);
  });
});

describe('extendEnds', () => {
  it('runs the river on past both ends, along the way it was going', () => {
    const out = extendEnds([[0, 0], [10, 0], [10, 10]], 5);
    expect(out).toHaveLength(5);
    expect(out[0][0]).toBeCloseTo(-5);
    expect(out[0][1]).toBeCloseTo(0);
    expect(out[4][0]).toBeCloseTo(10);
    expect(out[4][1]).toBeCloseTo(15);
  });
  it('leaves a single point alone', () => {
    expect(extendEnds([[3, 4]], 5)).toEqual([[3, 4]]);
  });
});
