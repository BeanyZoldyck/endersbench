// The river's ribbon, as plain arrays so it is tested without a renderer.
// River.tsx turns these into a BufferGeometry. Points are scene x/z.

type Point = readonly [number, number];

const unit = (dx: number, dz: number): [number, number] => {
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
};

// Runs the centre line on past both ends, the way it was heading, so the river
// comes out of the forest and goes back into it instead of stopping at the edge.
export function extendEnds(points: readonly Point[], by: number): Array<[number, number]> {
  const out = points.map(p => [p[0], p[1]] as [number, number]);
  if (out.length < 2) return out;
  const [a, b] = [out[0], out[1]], [y, z] = [out[out.length - 2], out[out.length - 1]];
  const head = unit(a[0] - b[0], a[1] - b[1]), tail = unit(z[0] - y[0], z[1] - y[1]);
  return [[a[0] + head[0] * by, a[1] + head[1] * by], ...out, [z[0] + tail[0] * by, z[1] + tail[1] * by]];
}

// Two vertices per point (left bank, right bank), `width` apart across the path;
// `wobble` is the fraction the width swells and narrows by along the way, and
// `height` lifts each vertex off y = 0. u runs bank to bank, v along the length
// in tiles, so a texture scrolled along v is the current.
export function ribbon(points: readonly Point[], width: number, wobble = 0, height: (x: number, z: number) => number = () => 0) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  if (points.length < 2) return { positions, uvs, indices, length: 0 };
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) along += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    // The bend's direction is the average of the segments either side of it.
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    const [tx, tz] = unit(after[0] - before[0], after[1] - before[1]);
    const half = (width * (1 + wobble * Math.sin(i * 0.9 + 0.5))) / 2;
    const [x, z] = points[i], nx = -tz * half, nz = tx * half;
    positions.push(x + nx, height(x + nx, z + nz), z + nz, x - nx, height(x - nx, z - nz), z - nz);
    uvs.push(0, along, 1, along);
    if (i > 0) { const k = i * 2; indices.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  return { positions, uvs, indices, length: along };
}
