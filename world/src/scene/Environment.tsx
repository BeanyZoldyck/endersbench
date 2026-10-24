import { boundaryFog } from './boundaryFog';
import { terrainHeight } from './terrain';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { itemColor, itemName, type Physics } from './contract';
import type { Agent, Container, Item, ResourceNode, World } from '../module_bindings/types';

export const PALETTE = { forest: '#293f39', moss: '#78866a', grass: '#b5b88b', earth: '#94725e', linen: '#f0e4cc', amber: '#edaa61', winter: '#718899' };
// A berry thicket is this many times a bush's size.
const THICKET_SCALE = 2.3;
export const toScene = (world: World, x: number, y: number): [number, number] => [x - world.width / 2, y - world.height / 2];
type Instance = { position: [number, number, number]; scale: [number, number, number]; color: string; rotation?: number; tilt?: number };
const noise = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

// Shared geometry and one draw call per vegetation layer, including the distant forest.
function Instances({ data, shape = 'canopy', shadows = false }: { data: Instance[]; shape?: 'canopy' | 'trunk' | 'berry'; shadows?: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    data.forEach((entry, i) => {
      dummy.position.set(...entry.position);
      dummy.scale.set(...entry.scale);
      dummy.rotation.set(0, entry.rotation ?? 0, entry.tilt ?? 0);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
      mesh.current!.setColorAt(i, color.set(entry.color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [data]);
  return <instancedMesh ref={mesh} args={[undefined, undefined, data.length]} castShadow={shadows} receiveShadow>
    {shape === 'trunk' ? <cylinderGeometry args={[1, 1, 1, 12]} /> : <icosahedronGeometry args={[1, shape === 'berry' ? 0 : 1]} />}
    <meshStandardMaterial {...boundaryFog} roughness={1} flatShading />
  </instancedMesh>;
}

export function Environment({ world, nodes, containers, items, agents, physics, onClickTile }: {
  physics: Physics; world: World; nodes: readonly ResourceNode[]; containers: readonly Container[]; items: readonly Item[]; agents: readonly Agent[];
  onClickTile: (x: number, y: number) => void;
}) {
  const winter = world.phase === 'winter';
  const forest = useMemo(() => {
    const trunks: Instance[] = [], crowns: Instance[] = [], berries: Instance[] = [];
    const tree = (x: number, z: number, seed: number, decorative: boolean, stump: boolean) => {
      const h = decorative ? 7 + noise(seed) * 7 : 6 + noise(seed) * 3;
      const radius = decorative ? 0.6 : stump ? physics.stumpRadius : physics.treeRadius;
      // Distant trees stand on the hills; sunk a little so no root floats on a slope.
      const y = decorative ? terrainHeight(x, z, world.radius) - 0.4 : 0;
      trunks.push({ position: [x, y + (stump ? 0.25 : h * 0.35), z], scale: [radius, stump ? 0.5 : h * 0.7, radius], color: '#6b5846' });
      if (stump) return;
      for (let c = 0; c < 3; c++) {
        const angle = c * 2.1 + noise(seed) * 2;
        crowns.push({ position: [x + Math.cos(angle) * 1.5, y + h * (0.9 + c * 0.1), z + Math.sin(angle) * 1.5], scale: decorative ? [3.6 + noise(seed + c), 3.2 + noise(seed + c + 6), 3.5] : [2.25, 2.15, 2.2], color: winter ? ['#72877e', '#8c9b8d', '#a5ae9e'][c] : decorative ? ['#334d40', '#47604a', '#61714f'][c] : ['#6c7e4d', '#8a955d', '#a2a269'][c], rotation: angle });
      }
    };
    // The complete canopy footprint stays OUTSIDE the playable circle.
    for (let i = 0; i < 220; i++) {
      const a = i * 2.399963;
      const r = world.radius + 9 + noise(i + 10) * 52;
      tree(Math.cos(a) * r, Math.sin(a) * r, i + 800, true, false);
    }
    for (const n of nodes) {
      const [x, z] = toScene(world, n.x, n.y);
      const seed = Number(n.id % 10000n);
      if (n.kind === 'tree' && n.state !== 'fallen') tree(x, z, seed, false, n.state === 'stump');
      if (n.kind === 'berry_thicket') {
        // A find: several bushes grown together, well over twice a bush's size, with a heavy crop.
        const R = physics.bushRadius * THICKET_SCALE;
        const lobes = [{ dx: 0, dz: 0, size: R, tone: 0 }, ...Array.from({ length: 5 }, (_, k) => {
          const a = seed * 0.7 + k * 1.26 + noise(seed + k) * 0.5, reach = R * (0.72 + noise(seed + k + 20) * 0.18);
          return { dx: Math.cos(a) * reach, dz: Math.sin(a) * reach, size: R * (0.58 + noise(seed + k + 40) * 0.16), tone: 1 + (k % 2) };
        })];
        const green = winter ? ['#7a8b7c', '#889a8a', '#6f8071'] : ['#667a45', '#728750', '#5d7140'];
        for (const l of lobes) crowns.push({ position: [x + l.dx, l.size * 0.7, z + l.dz], scale: [l.size, l.size * 0.8, l.size], color: green[l.tone], rotation: seed + l.dx });
        const count = n.remaining === 0 ? 0 : Math.max(1, Math.ceil(36 * Math.min(1, n.remaining / Math.max(1, n.capacity))));
        for (let b = 0; b < count; b++) {
          const l = lobes[b % lobes.length], around = b * 2.4 + seed, lift = 0.25 + noise(b + seed) * 0.9;
          berries.push({
            position: [x + l.dx + Math.cos(around) * Math.cos(lift) * l.size * 0.95, l.size * 0.7 + Math.sin(lift) * l.size * 0.76, z + l.dz + Math.sin(around) * Math.cos(lift) * l.size * 0.95],
            scale: [R * 0.1, R * 0.105, R * 0.1], color: ['#9f5260', '#bf6b71', '#7d4a6b'][b % 3],
          });
        }
      }
      if (n.kind === 'berry_bush') {
        const r = physics.bushRadius;
        crowns.push({ position: [x, r * 0.7, z], scale: [r, r * 0.8, r], color: winter ? '#778579' : '#788752' });
        const count = n.remaining === 0 ? 0 : Math.max(1, Math.ceil(12 * Math.min(1, n.remaining / Math.max(1, n.capacity))));
        for (let b = 0; b < count; b++) {
          const a = b * 2.4;
          berries.push({ position: [x + Math.cos(a) * r * 0.7, r * (0.8 + noise(b + seed) * 0.5), z + Math.sin(a) * r * 0.7], scale: [r * 0.13, r * 0.14, r * 0.13], color: b % 2 ? '#9f5260' : '#bf6b71' });
        }
      }
    }
    return { trunks, crowns, berries };
  }, [nodes, world.width, world.height, world.radius, winter, physics]);
  const inventories = useMemo(() => {
    const map = new Map<bigint, Item[]>();
    for (const item of items) if (item.containerId !== 0n && item.qty > 0) map.set(item.containerId, [...(map.get(item.containerId) ?? []), item]);
    return map;
  }, [items]);
  return <group>
    <Ground world={world} onClickTile={onClickTile} />
    <Instances data={forest.trunks} shape="trunk" shadows />
    <Instances data={forest.crowns} shadows />
    <Instances data={forest.berries} shape="berry" />
    {nodes.filter(n => n.kind === 'wood_pile').map(n => <WoodPile key={String(n.id)} node={n} world={world} />)}
    {nodes.filter(n => n.kind === 'tree' && n.state === 'fallen').map(n => <FallenTree key={String(n.id)} node={n} world={world} physics={physics} />)}
    {containers.map(c => <ContainerProp key={String(c.id)} container={c} world={world} physics={physics} items={inventories.get(c.id) ?? []} owner={agents.find(a => a.id === c.ownerAgentId)} />)}
  </group>;
}

function Ground({ world, onClickTile }: { world: World; onClickTile: (x: number, y: number) => void }) {
  const winter = world.phase === 'winter';
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(world.radius * 6, world.radius * 6, 160, 160);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const moss = new THREE.Color(winter ? '#a8b4ac' : PALETTE.moss);
    const grass = new THREE.Color(winter ? '#cbd0bf' : PALETTE.grass);
    const mist = new THREE.Color(winter ? '#aabcc0' : '#a4ad91');
    const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, terrainHeight(x, z, world.radius));
      const patch = (Math.sin(x * 0.065 + Math.sin(z * 0.08)) + Math.cos(z * 0.09 - x * 0.035)) * 0.15 + 0.4;
      const edge = THREE.MathUtils.smoothstep(Math.hypot(x, z), world.radius - 7, world.radius + 32);
      color.copy(moss).lerp(grass, patch).lerp(mist, edge);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [world.radius, winter]);
  // Geometry is replaced only on a radius/season change, never on the world tick.
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || Math.hypot(e.point.x, e.point.z) > world.radius) return;
    e.stopPropagation();
    onClickTile(e.point.x + world.width / 2, e.point.z + world.height / 2);
  };
  return <mesh geometry={geometry} receiveShadow onClick={click}><meshStandardMaterial {...boundaryFog} vertexColors roughness={1} /></mesh>;
}

function Box({ position, scale, color, rotation = 0 }: { position: [number, number, number]; scale: [number, number, number]; color: string; rotation?: number; tilt?: number }) {
  return <mesh position={position} scale={scale} rotation={[0, rotation, 0]} castShadow receiveShadow><boxGeometry /><meshStandardMaterial {...boundaryFog} color={color} roughness={0.92} /></mesh>;
}

function Cargo({ items, radius }: { items: readonly Item[]; radius: number }) {
  return <group>{items.filter(i => i.qty > 0).map((item, i) => {
    const h = Math.min(1.2, Math.log2(item.qty + 1) * 0.15) * radius;
    const angle = i / Math.max(1, items.length) * Math.PI * 2;
    return <group key={String(item.id)} position={[Math.cos(angle) * radius * 0.45, 0, Math.sin(angle) * radius * 0.45]}>
      <Box position={[0, h / 2, 0]} scale={[radius * 0.48, h, radius * 0.48]} color={itemColor(item.kind)} />
      <Box position={[0, h + 0.01, 0]} scale={[radius * 0.5, 0.02, radius * 0.1]} color={PALETTE.linen} />
      {item.kind === 'medkit' && <Box position={[0, h + 0.02, 0]} scale={[radius * 0.1, 0.02, radius * 0.35]} color="#627f6b" />}
    </group>;
  })}</group>;
}

function ContainerProp({ container: c, world, items, owner, physics }: { container: Container; world: World; items: readonly Item[]; owner?: Agent; physics: Physics }) {
  const [x, z] = toScene(world, c.x, c.y);
  const [hovered, setHovered] = useState(false);
  const wreck = c.kind === 'wreck', chest = c.kind === 'chest', crate = c.kind === 'crate';
  const r = physics.chestRadius;
  return <group>
    {wreck && <PlaneWreck world={world} physics={physics} />}
    <group position={[x, 0, z]} onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)}>
      {chest ? <>
        <mesh position={[0, r * 0.55, 0]} castShadow receiveShadow><cylinderGeometry args={[r, r, r * 1.1, 16, 1, true]} /><meshStandardMaterial {...boundaryFog} color="#94725e" roughness={1} side={THREE.DoubleSide} /></mesh>
        <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[r, r, 0.1, 16]} /><meshStandardMaterial {...boundaryFog} color="#725741" roughness={1} /></mesh>
        <mesh position={[0, r * 1.4, -r * 0.5]} rotation={[-0.25, 0, 0]}><circleGeometry args={[r * 0.8, 16]} /><meshStandardMaterial {...boundaryFog} color="#ae8e68" roughness={1} side={THREE.DoubleSide} /></mesh>
        <Box position={[0, r * 0.65, r * 0.95]} scale={[r * 0.4, r * 0.35, r * 0.06]} color={owner?.color ?? PALETTE.linen} />
      </> : crate ? <SupplyCrate items={items} /> : <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}><circleGeometry args={[wreck ? 0.65 : 0.45, 16]} /><meshStandardMaterial {...boundaryFog} color={PALETTE.linen} roughness={1} /></mesh>}
      {!crate && <Cargo items={items} radius={wreck ? 0.7 : r * 0.8} />}
      {hovered && <Html position={[0, wreck ? 2.2 : crate ? 4.2 : r * 2.5, 0]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
        <div className="place-label hover-label"><strong>{wreck ? 'Wreck cargo' : chest ? `${owner?.name ?? 'Someone'}'s chest` : c.label}</strong><span>{contentsLine(items)}</span></div>
      </Html>}
    </group>
  </group>;
}

// The supply crate: a big open wooden box with its lid thrown back and its
// contents heaped inside (rations, medical kits, wood). Whatever is left shows;
// an emptied crate is an empty box. It stands on the ground the survivors do,
// a little wider than a survivor, and is as solid as the module's crateRadius.
const CRATE = { w: 3.6, d: 2.6, h: 2.1, wall: 0.2 };
const CRATE_SCALE = 0.75; // 2.7 x 2.0 tiles: a crate a survivor could have packed, beside a much bigger wreck
const PLANK_TONES = ['#b08a5c', '#a68153', '#b8935f'];
function SupplyCrate({ items }: { items: readonly Item[] }) {
  const { w, d, h, wall } = CRATE;
  const qty = (kind: string) => items.filter(i => i.kind === kind).reduce((n, i) => n + i.qty, 0);
  const rations = Math.min(18, qty('ration')), medkits = Math.min(4, qty('medkit')), logs = Math.min(7, Math.ceil(qty('wood') / 5));
  const plank = h / 3 - 0.03;
  const floor = 0.28;
  // Rations: six to a layer, three across and two deep, a little untidy.
  const stackTop = floor + 0.46 * Math.ceil(rations / 6);
  return <group rotation={[0, 0.32, 0]} scale={CRATE_SCALE} name="supply-crate">
    {[0, 1, 2].map(k => {
      const y = plank / 2 + k * (plank + 0.03) + 0.04, tone = PLANK_TONES[k];
      return <group key={k}>
        {[-1, 1].map(side => <Box key={`z${side}`} position={[0, y, side * (d / 2 - wall / 2)]} scale={[w, plank, wall]} color={tone} />)}
        {[-1, 1].map(side => <Box key={`x${side}`} position={[side * (w / 2 - wall / 2), y, 0]} scale={[wall, plank, d - 2 * wall]} color={PLANK_TONES[(k + 1) % 3]} />)}
      </group>;
    })}
    <Box position={[0, 0.18, 0]} scale={[w - 2 * wall, 0.2, d - 2 * wall]} color="#5d4a38" />
    {[-1, 1].flatMap(sx => [-1, 1].map(sz => <Box key={`${sx}${sz}`} position={[sx * (w / 2 - 0.15), (h + 0.1) / 2, sz * (d / 2 - 0.15)]} scale={[0.3, h + 0.1, 0.3]} color="#7a5c40" />))}
    {[-1, 1].map(side => <Box key={`strap${side}`} position={[side * w * 0.27, h / 2, 0]} scale={[0.24, h + 0.04, d + 0.05]} color="#4d5b55" />)}
    {/* The stencilled plate on the two faces the default camera sees: a medical cross on linen. */}
    {[0, 1].map(face => <group key={face} position={face ? [w / 2 + 0.03, h * 0.52, 0] : [0, h * 0.52, d / 2 + 0.03]} rotation={[0, face ? Math.PI / 2 : 0, 0]}>
      <Box position={[0, 0, 0]} scale={[1.15, 0.82, 0.05]} color={PALETTE.linen} />
      <Box position={[0, 0, 0.04]} scale={[0.5, 0.14, 0.04]} color="#627f6b" />
      <Box position={[0, 0, 0.04]} scale={[0.14, 0.5, 0.04]} color="#627f6b" />
    </group>)}
    {/* The lid, hinged at the back and thrown open past upright. */}
    <group position={[0, h, -d / 2]} rotation={[-1.92, 0, 0]}>
      <Box position={[0, 0, d / 2]} scale={[w + 0.16, 0.16, d + 0.08]} color="#a68153" />
      {[-1, 1].map(side => <Box key={side} position={[side * w * 0.27, 0.1, d / 2]} scale={[0.24, 0.06, d + 0.1]} color="#4d5b55" />)}
    </group>
    {Array.from({ length: rations }, (_, s) => {
      const pos = s % 6, layer = Math.floor(s / 6), n = noise(s + 3);
      return <group key={s} position={[(pos % 3 - 1) * 1.02 + (n - 0.5) * 0.08, floor + 0.23 + layer * 0.46, (Math.floor(pos / 3) - 0.5) * 0.92]} rotation={[0, (n - 0.5) * 0.3, 0]}>
        <Box position={[0, 0, 0]} scale={[0.92, 0.44, 0.82]} color={['#c4af81', '#b9a373', '#cdb98c'][s % 3]} />
        <Box position={[0, 0.225, 0]} scale={[0.94, 0.02, 0.2]} color={PALETTE.linen} />
      </group>;
    })}
    {Array.from({ length: medkits }, (_, k) => <group key={k} position={[(k - 1.5) * 0.7, stackTop + 0.17, -0.25 + (k % 2) * 0.3]} rotation={[0, (k - 1.5) * 0.12, 0]}>
      <Box position={[0, 0, 0]} scale={[0.56, 0.34, 0.42]} color="#e5e1cb" />
      <Box position={[0, 0.175, 0]} scale={[0.34, 0.02, 0.1]} color="#627f6b" />
      <Box position={[0, 0.175, 0]} scale={[0.1, 0.02, 0.34]} color="#627f6b" />
    </group>)}
    {/* Logs standing in the corner, leaning on the rim. */}
    {Array.from({ length: logs }, (_, k) => <mesh key={k} position={[w / 2 - 0.62 + (k % 2) * 0.25 + k * 0.03, 1.28 + (k % 3) * 0.06, -d / 2 + 0.6 + k * 0.26]} rotation={[0.06, k * 0.7, -0.2 - (k % 3) * 0.05]} castShadow>
      <cylinderGeometry args={[0.13, 0.13, 2.5, 6]} /><meshStandardMaterial {...boundaryFog} color={['#7c6248', '#8a6a4c', '#6f5640'][k % 3]} roughness={1} flatShading />
    </mesh>)}
  </group>;
}

// A wood pile: stacked logs, four on the bottom row and one at the top. Each
// gather takes one off the top; an emptied pile leaves bark and chips.
const LOG_ROWS = [4, 3, 2, 1];
const LOG_TONES = ['#7c6248', '#8a6a4c', '#6f5640', '#977658'];
function WoodPile({ node, world }: { node: ResourceNode; world: World }) {
  const [x, z] = toScene(world, node.x, node.y);
  const seed = Number(node.id % 10000n), r = 0.3, gap = r * 2.04;
  const total = LOG_ROWS.reduce((n, c) => n + c, 0);
  const shown = node.remaining <= 0 ? 0 : Math.max(1, Math.ceil(total * Math.min(1, node.remaining / Math.max(1, node.capacity))));
  const slots = LOG_ROWS.flatMap((count, row) => Array.from({ length: count }, (_, k) => ({ row, k, count })));
  return <group position={[x, 0, z]} rotation={[0, seed * 0.9, 0]} name={`wood-pile-${node.id}`}>
    {slots.slice(0, shown).map(({ row, k, count }, i) => {
      const n = noise(seed + i * 3);
      const length = 2.2 + n * 0.5;
      return <group key={i} position={[(n - 0.5) * 0.25, r + row * gap * 0.88, (k - (count - 1) / 2) * gap]} rotation={[0, (n - 0.5) * 0.12, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[r, r, length, 7]} />
          <meshStandardMaterial {...boundaryFog} attach="material-0" color={LOG_TONES[i % 4]} roughness={1} flatShading />
          <meshStandardMaterial {...boundaryFog} attach="material-1" color="#cdb184" roughness={1} />
          <meshStandardMaterial {...boundaryFog} attach="material-2" color="#cdb184" roughness={1} />
        </mesh>
      </group>;
    })}
    {shown === 0 && [[0.5, 0.2], [-0.4, -0.3], [0.1, -0.6]].map(([dx, dz], i) => <Box key={i} position={[dx, 0.06, dz]} scale={[0.5, 0.1, 0.18]} rotation={i} color={LOG_TONES[i]} />)}
  </group>;
}

function PlaneWreck({ world, physics }: { world: World; physics: Physics }) {
  const f = physics.wreck, r = f.radius, length = f.x2 - f.x1;
  const [x, z] = toScene(world, (f.x1 + f.x2) / 2, f.y1);
  return <group position={[x, 0, z]}>
    {/* The capsule's horizontal silhouette exactly matches the published collider. */}
    <mesh rotation={[0, 0, -Math.PI / 2]} castShadow receiveShadow name="wreck-fuselage">
      <capsuleGeometry args={[r, length, 8, 16]} /><meshStandardMaterial {...boundaryFog} color="#c8c3aa" roughness={1} />
    </mesh>
    <Box position={[0, 0.38, r * 0.96]} scale={[length * 0.95, 0.18, 0.02]} color="#8d6654" />
    {[-0.3, 0, 0.3].map(offset => <mesh key={offset} position={[offset * length, r * 0.63, r * 0.78]}><circleGeometry args={[r * 0.11, 12]} /><meshStandardMaterial {...boundaryFog} color="#485d58" /></mesh>)}
    {/* Cargo door is a hatch on the south side, not the collider's origin. */}
    <Box position={[0, r * 0.45, r * 0.9]} scale={[length * 0.115, r * 0.8, 0.025]} color="#536359" />
    <mesh position={[-length / 2, r * 0.42, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[r * 0.85, 0.06, 5, 16]} /><meshStandardMaterial {...boundaryFog} color="#81897b" /></mesh>
    <Box position={[length * 0.4, r * 1.2, 0]} scale={[length * 0.15, r * 1.5, 0.12]} color="#8d6654" />
    {/* Buried wing fragments are flat paint-like surfaces, never false solid obstacles. */}
    {[-1, 1].map(side => <mesh key={side} position={[0, 0.012, side * r * 1.5]} rotation={[-Math.PI / 2, 0, side * 0.15]}><planeGeometry args={[length * 0.26, r * 2]} /><meshStandardMaterial {...boundaryFog} color="#a8ac96" roughness={1} /></mesh>)}
  </group>;
}

function FallenTree({ node, world, physics }: { node: ResourceNode; world: World; physics: Physics }) {
  const length = physics.fallenTreeLength;
  // Same base-anchored capsule and radius ratio as staticColliders in physics.ts.
  const r = physics.treeRadius * 0.7;
  const [x, z] = toScene(world, node.x + Math.cos(node.angle) * length / 2, node.y + Math.sin(node.angle) * length / 2);
  return <group position={[x, r, z]} rotation={[0, -node.angle, 0]} name={`fallen-tree-${node.id}`}>
    <mesh rotation={[0, 0, -Math.PI / 2]} castShadow receiveShadow><capsuleGeometry args={[r, length, 4, 10]} /><meshStandardMaterial {...boundaryFog} color="#78654e" roughness={1} /></mesh>
    <mesh position={[-length / 2 - r * 0.9, 0, 0]} rotation={[0, -Math.PI / 2, 0]}><circleGeometry args={[r * 0.4, 10]} /><meshStandardMaterial {...boundaryFog} color="#c3a779" roughness={1} /></mesh>
  </group>;
}

function contentsLine(items: readonly Item[]) {
  const held = items.filter(i => i.qty > 0);
  return held.length ? held.map(i => `${i.qty} ${itemName(i.kind)}`).join(' · ') : 'Empty';
}
