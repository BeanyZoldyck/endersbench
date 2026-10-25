// Ledger Street itself, drawn like an architect's massing model: the four offices take
// one block of a street grid, and the neighbouring blocks are pale, low volumes on their
// own pavements, set square to the grid and fading into the fog, as the clearing sits in
// its forest. Nothing here is scattered at random and nothing competes with the offices:
// they carry the colour and the story.
import { useMemo } from 'react';

const GROUND = '#cdd4c6', ROAD = '#bfc3b7', LINE = '#e3e0d2', CURB = '#c1c6b9', PAVEMENT = '#d5dacd';
const BLOCK = 11.5; // the offices' spacing: roads run between and around them
const ROAD_W = 3.1, ROADS = [-BLOCK * 1.5, 0, BLOCK * 1.5];
// The street grid's cells: the roads at 0 and ±17.25 repeat every 17.25 units.
const CELL = BLOCK * 1.5, CENTERS = [-2.5, -1.5, -.5, .5, 1.5, 2.5].map(k => k * CELL);
const PAVED = CELL - ROAD_W, BUILT = PAVED - 2.6;
const MASS = ['#c8cdbf', '#c2c8b9', '#cbcabd'];

const noise = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
type Volume = { p: [number, number]; size: [number, number, number]; color: string };

export function StreetBackdrop() {
  const { pavements, volumes } = useMemo(() => {
    const pavements: [number, number][] = [], volumes: Volume[] = [];
    CENTERS.forEach((x, i) => CENTERS.forEach((z, j) => {
      // The four cells around the origin are the offices' block.
      if (Math.abs(x) < CELL && Math.abs(z) < CELL) return;
      pavements.push([x, z]);
      const n = noise(i * 7 + j * 13), color = MASS[(i + j) % MASS.length];
      // One volume or a pair split along the grid, always square to it; two heights only.
      const h = n > .5 ? 2.6 : 1.8;
      if (n < .35) volumes.push({ p: [x, z], size: [BUILT, h, BUILT], color });
      else for (const s of [-1, 1]) volumes.push((i + j) % 2
        ? { p: [x + s * (BUILT / 4 + .3), z], size: [BUILT / 2 - .6, s > 0 ? h : 1.8, BUILT], color }
        : { p: [x, z + s * (BUILT / 4 + .3)], size: [BUILT, s > 0 ? h : 1.8, BUILT / 2 - .6], color });
    }));
    return { pavements, volumes };
  }, []);
  return <group name="street-backdrop">
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.5, 0]}><planeGeometry args={[220, 220]} /><meshStandardMaterial color={GROUND} roughness={1} /></mesh>
    {ROADS.concat([-BLOCK * 3, BLOCK * 3]).map(c => <group key={c}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[c, -.485, 0]}><planeGeometry args={[ROAD_W, 120]} /><meshStandardMaterial color={ROAD} roughness={1} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.484, c]}><planeGeometry args={[120, ROAD_W]} /><meshStandardMaterial color={ROAD} roughness={1} /></mesh>
      {Array.from({ length: 30 }, (_, i) => -58 + i * 4).filter(t => [...ROADS, -BLOCK * 3, BLOCK * 3].every(r => Math.abs(t - r) > ROAD_W)).map(t => <group key={t}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[c, -.48, t]}><planeGeometry args={[.1, 1.2]} /><meshBasicMaterial color={LINE} /></mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[t, -.479, c]}><planeGeometry args={[1.2, .1]} /><meshBasicMaterial color={LINE} /></mesh>
      </group>)}
    </group>)}
    {/* Curbs around the office block. */}
    {[-1, 1].map(s => <group key={s}>
      <mesh position={[s * (BLOCK - ROAD_W / 2 + .1), -.43, 0]}><boxGeometry args={[.16, .12, BLOCK * 2 - ROAD_W]} /><meshStandardMaterial color={CURB} /></mesh>
      <mesh position={[0, -.43, s * (BLOCK - ROAD_W / 2 + .1)]}><boxGeometry args={[BLOCK * 2 - ROAD_W, .12, .16]} /><meshStandardMaterial color={CURB} /></mesh>
    </group>)}
    {pavements.map(([x, z]) => <mesh key={`${x},${z}`} position={[x, -.45, z]}><boxGeometry args={[PAVED, .1, PAVED]} /><meshStandardMaterial color={PAVEMENT} roughness={1} /></mesh>)}
    {volumes.map(({ p: [x, z], size: [w, h, d], color }, i) => <mesh key={i} position={[x, -.4 + h / 2, z]}><boxGeometry args={[w, h, d]} /><meshStandardMaterial color={color} roughness={1} /></mesh>)}
  </group>;
}
