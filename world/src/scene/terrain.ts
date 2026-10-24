// The forest floor outside the clearing rolls up into low hills, so the camera
// reads depth. Inside the playable circle (plus a small apron) it stays flat:
// the simulation is 2D and every prop sits at y = 0. Pure, so it is tested
// without a renderer; Environment.tsx displaces the ground and distant trees.

const smoothstep = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function terrainHeight(x: number, z: number, radius: number) {
  const r = Math.hypot(x, z);
  if (r <= radius + 3) return 0;
  const angle = Math.atan2(z, x);
  // Two slow ridgelines around the ring, so hills crowd in on some sides.
  const ridge = 0.6 + 0.25 * Math.sin(angle * 3 + 0.8) + 0.15 * Math.sin(angle * 7 - r * 0.05);
  return smoothstep(r, radius + 3, radius + 55) * 15 * ridge;
}
