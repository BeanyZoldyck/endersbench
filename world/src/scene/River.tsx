import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { World } from '../module_bindings/types';
import { boundaryFog } from './boundaryFog';
import { toScene } from './Environment';
import { terrainHeight } from './terrain';
import { extendEnds, ribbon } from './riverGeometry';

// The river is scenery: a few tiles wide (the module's RIVER_WIDTH is 3), and
// survivors walk across it. It is painted over the ground, not built on it:
// the layers draw in order after the ground, test against it, and write no
// depth, so contact shadows and rings under survivors in the water still show.
const WIDTH = 3.1;
const BANK_WIDTH = 5.2;
// How far the river runs on past the ends of the published line, into the trees.
const RUN_ON = 9;
const LAYERS = { bank: 1, foam: 2, water: 3 };
const decal = { depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } as const;

const noise = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

function geometryOf(r: ReturnType<typeof ribbon>, normal = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(r.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(r.uvs, 2));
  if (normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(r.positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(r.indices);
  return g;
}

// Pale, soft streaks along the current: a tile that wraps top to bottom, so
// scrolling it never shows a seam.
function streaks(seed: number) {
  const w = 64, h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d')!;
  for (let i = 0; i < 20; i++) {
    const x = 6 + noise(seed + i) * (w - 12), y = noise(seed + i + 50) * h, len = 34 + noise(seed + i + 90) * 56, thick = 1.6 + noise(seed + i + 130) * 2.2;
    for (const wrap of [-h, 0, h]) {
      const gradient = g.createLinearGradient(0, y + wrap - len / 2, 0, y + wrap + len / 2);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.5, `rgba(255,255,255,${0.35 + noise(seed + i + 170) * 0.4})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gradient;
      g.fillRect(x - thick / 2, y + wrap - len / 2, thick, len);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function River({ river, world }: { river: ReadonlyArray<readonly [number, number]>; world: World }) {
  const winter = world.phase === 'winter';
  const built = useMemo(() => {
    const line = extendEnds(river.map(([x, y]) => toScene(world, x, y)), RUN_ON);
    // Past the playable circle the ground starts to rise; follow it.
    const height = (lift: number) => (x: number, z: number) => terrainHeight(x, z, world.radius) + lift;
    const bank = ribbon(line, BANK_WIDTH, 0.14, height(0.012));
    const foam = ribbon(line, WIDTH + 0.7, 0.12, height(0.016));
    const water = ribbon(line, WIDTH, 0.1, height(0.02));
    // Stones on the banks, every few points and on alternate sides.
    const stones = line.flatMap(([x, z], i) => {
      if (i % 3 !== 1 || i < 3 || i > line.length - 4) return [];
      const [px, pz] = line[i - 1], [nx, nz] = line[i + 1];
      const len = Math.hypot(nx - px, nz - pz) || 1, side = i % 2 ? 1 : -1;
      const off = BANK_WIDTH / 2 + 0.1 + noise(i) * 0.8, size = 0.25 + noise(i + 7) * 0.4;
      const sx = x + (-(nz - pz) / len) * off * side, sz = z + ((nx - px) / len) * off * side;
      return [{ x: sx, z: sz, y: terrainHeight(sx, sz, world.radius), size, turn: noise(i + 13) * 6 }];
    });
    return { bank: geometryOf(bank), foam: geometryOf(foam), water: geometryOf(water), stones };
  }, [river, world.width, world.height, world.radius]);
  useEffect(() => () => { built.bank.dispose(); built.foam.dispose(); built.water.dispose(); }, [built]);

  const textures = useMemo(() => {
    const near = streaks(1), far = streaks(77);
    near.repeat.set(1, 1 / 12); far.repeat.set(1, 1 / 19);
    return { near, far };
  }, []);
  useEffect(() => () => { textures.near.dispose(); textures.far.dispose(); }, [textures]);

  // The current: two layers of streaks drifting downstream at different speeds,
  // and the water's normals swaying a little, so the light catches it.
  const surface = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1), t = clock.elapsedTime;
    // Offsets run backwards so the streaks travel with the river's direction (increasing v).
    textures.near.offset.set(Math.sin(t * 0.21) * 0.03, textures.near.offset.y - dt * 0.05);
    textures.far.offset.set(0.4 + Math.sin(t * 0.16 + 2) * 0.04, textures.far.offset.y - dt * 0.028);
    const normals = surface.current?.geometry.attributes.normal as THREE.BufferAttribute | undefined;
    if (normals) {
      for (let i = 0; i < normals.count; i++) {
        const sway = 0.1;
        const x = Math.sin(t * 0.8 + i * 0.9) * sway, z = Math.cos(t * 0.65 + i * 0.7 + (i % 2) * 1.7) * sway;
        const len = Math.hypot(x, 1, z);
        normals.setXYZ(i, x / len, 1 / len, z / len);
      }
      normals.needsUpdate = true;
    }
  });

  return <group name="river">
    <mesh geometry={built.bank} renderOrder={LAYERS.bank} receiveShadow raycast={() => null}>
      <meshStandardMaterial {...boundaryFog} {...decal} color={winter ? '#a9a994' : '#8f8a68'} roughness={1} />
    </mesh>
    <mesh geometry={built.foam} renderOrder={LAYERS.foam} raycast={() => null}>
      <meshBasicMaterial {...boundaryFog} {...decal} color={winter ? '#e0e9e6' : '#cfdcd5'} />
    </mesh>
    <mesh ref={surface} geometry={built.water} renderOrder={LAYERS.water} receiveShadow raycast={() => null} name="river-water">
      <meshStandardMaterial {...boundaryFog} {...decal} color={winter ? '#86a8b4' : '#5c93a2'} roughness={0.3} metalness={0.05} />
    </mesh>
    {/* Streaks are lit like the ground, so they dim at night rather than glow; they draw before the discs under survivors. */}
    <mesh geometry={built.water} renderOrder={-2} raycast={() => null} position={[0, 0.004, 0]}>
      <meshLambertMaterial {...boundaryFog} {...decal} map={textures.near} transparent opacity={0.6} color="#f2f8f5" />
    </mesh>
    <mesh geometry={built.water} renderOrder={-1} raycast={() => null} position={[0, 0.006, 0]}>
      <meshLambertMaterial {...boundaryFog} {...decal} map={textures.far} transparent opacity={0.4} color="#dcecec" />
    </mesh>
    {built.stones.map((s, i) => <mesh key={i} position={[s.x, s.y + s.size * 0.3, s.z]} rotation={[0, s.turn, 0]} scale={[s.size * 1.3, s.size * 0.8, s.size]} castShadow receiveShadow>
      <icosahedronGeometry args={[1, 0]} /><meshStandardMaterial {...boundaryFog} color={['#8d9180', '#9a9d8c', '#7f8577'][i % 3]} roughness={1} flatShading />
    </mesh>)}
  </group>;
}
