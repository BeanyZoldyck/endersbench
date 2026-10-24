import { useLayoutEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Agent, Container, Item, ResourceNode, World } from '../module_bindings/types';

export const PALETTE = { forest: '#293f39', moss: '#78866a', grass: '#b5b88b', earth: '#94725e', linen: '#f0e4cc', amber: '#edaa61', winter: '#718899' };
export const toScene = (world: World, x: number, y: number): [number, number] => [x - world.width / 2, y - world.height / 2];
type Instance = { position: [number, number, number]; scale: [number, number, number]; color: string; rotation?: number };
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
      dummy.rotation.set(0, entry.rotation ?? 0, 0);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
      mesh.current!.setColorAt(i, color.set(entry.color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [data]);
  return <instancedMesh ref={mesh} args={[undefined, undefined, data.length]} castShadow={shadows} receiveShadow>
    {shape === 'trunk' ? <cylinderGeometry args={[0.65, 1, 1, 7]} /> : <icosahedronGeometry args={[1, shape === 'berry' ? 0 : 1]} />}
    <meshStandardMaterial roughness={1} flatShading />
  </instancedMesh>;
}

export function Environment({ world, nodes, containers, items, agents, onClickTile }: {
  world: World; nodes: readonly ResourceNode[]; containers: readonly Container[]; items: readonly Item[]; agents: readonly Agent[];
  onClickTile: (x: number, y: number) => void;
}) {
  const winter = world.phase === 'winter';
  const forest = useMemo(() => {
    const trunks: Instance[] = [], crowns: Instance[] = [], berries: Instance[] = [];
    const tree = (x: number, z: number, seed: number, decorative: boolean, remaining: number) => {
      const h = decorative ? 7 + noise(seed) * 7 : 6 + noise(seed) * 3;
      trunks.push({ position: [x, remaining > 0 ? h * 0.35 : 0.55, z], scale: [0.6, remaining > 0 ? h * 0.7 : 1.1, 0.6], color: '#6b5846' });
      if (remaining <= 0) return;
      for (let c = 0; c < 3; c++) {
        const angle = c * 2.1 + noise(seed) * 2;
        crowns.push({ position: [x + Math.cos(angle) * 1.5, h * (0.7 + c * 0.12), z + Math.sin(angle) * 1.5], scale: [3.6 + noise(seed + c), 3.2 + noise(seed + c + 6), 3.5], color: winter ? ['#72877e', '#8c9b8d', '#a5ae9e'][c] : decorative ? ['#334d40', '#47604a', '#61714f'][c] : ['#6c7e4d', '#8a955d', '#a2a269'][c], rotation: angle });
      }
    };
    // The complete canopy footprint stays OUTSIDE the playable circle.
    for (let i = 0; i < 220; i++) {
      const a = i * 2.399963;
      const r = world.radius + 9 + noise(i + 10) * 52;
      tree(Math.cos(a) * r, Math.sin(a) * r, i + 800, true, 1);
    }
    for (const n of nodes) {
      const [x, z] = toScene(world, n.x, n.y);
      const seed = Number(n.id % 10000n);
      if (n.kind === 'tree') tree(x, z, seed, false, n.remaining);
      if (n.kind === 'berry_bush') {
        for (let c = 0; c < 3; c++) crowns.push({ position: [x + (c - 1) * 0.8, 0.9 + (c % 2) * 0.4, z + (c % 2) * 0.5], scale: [1.25, 1.1, 1.2], color: winter ? '#778579' : ['#60744e', '#788752', '#8e985e'][c] });
        const count = n.remaining === 0 ? 0 : Math.max(1, Math.ceil(12 * Math.min(1, n.remaining / Math.max(1, n.capacity))));
        for (let b = 0; b < count; b++) {
          const a = b * 2.4;
          berries.push({ position: [x + Math.cos(a) * 1.45, 1.15 + noise(b + seed) * 1.1, z + Math.sin(a) * 1.2], scale: [0.23, 0.25, 0.23], color: b % 2 ? '#9f5260' : '#bf6b71' });
        }
      }
    }
    return { trunks, crowns, berries };
  }, [nodes, world.width, world.height, world.radius, winter]);
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
    {containers.map(c => <ContainerProp key={String(c.id)} container={c} world={world} items={inventories.get(c.id) ?? []} owner={agents.find(a => a.id === c.ownerAgentId)} />)}
  </group>;
}

function Ground({ world, onClickTile }: { world: World; onClickTile: (x: number, y: number) => void }) {
  const winter = world.phase === 'winter';
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(world.radius * 6, world.radius * 6, 100, 100);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const moss = new THREE.Color(winter ? '#a8b4ac' : PALETTE.moss);
    const grass = new THREE.Color(winter ? '#cbd0bf' : PALETTE.grass);
    const mist = new THREE.Color(winter ? '#aabcc0' : '#a4ad91');
    const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const patch = (Math.sin(x * 0.065 + Math.sin(z * 0.08)) + Math.cos(z * 0.09 - x * 0.035)) * 0.15 + 0.4;
      const edge = THREE.MathUtils.smoothstep(Math.hypot(x, z), world.radius - 7, world.radius + 32);
      color.copy(moss).lerp(grass, patch).lerp(mist, edge);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, [world.radius, winter]);
  // Geometry is replaced only on a radius/season change, never on the world tick.
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || Math.hypot(e.point.x, e.point.z) > world.radius) return;
    e.stopPropagation();
    onClickTile(e.point.x + world.width / 2, e.point.z + world.height / 2);
  };
  return <mesh geometry={geometry} receiveShadow onClick={click}><meshStandardMaterial vertexColors roughness={1} /></mesh>;
}

function Box({ position, scale, color, rotation = 0 }: { position: [number, number, number]; scale: [number, number, number]; color: string; rotation?: number }) {
  return <mesh position={position} scale={scale} rotation={[0, rotation, 0]} castShadow receiveShadow><boxGeometry /><meshStandardMaterial color={color} roughness={0.92} /></mesh>;
}

function Cargo({ items, wreck }: { items: readonly Item[]; wreck: boolean }) {
  return <group position={wreck ? [0, 0.3, -3] : [0, 0.5, 0]}>
    {items.map((item, i) => {
      const h = Math.min(2.1, Math.log2(item.qty + 1) * 0.28);
      return <group key={String(item.id)} position={[(i % 3 - 1) * (wreck ? 1.25 : 0.65), 0, Math.floor(i / 3) * 0.8]}>
        <Box position={[0, h / 2, 0]} scale={[wreck ? 1 : 0.5, h, wreck ? 1 : 0.55]} color={item.kind === 'berries' ? '#a65e68' : item.kind === 'wood' ? '#94725e' : '#c4af81'} />
        <Box position={[0, h + 0.015, 0]} scale={[wreck ? 1.02 : 0.52, 0.045, 0.12]} color={PALETTE.linen} />
      </group>;
    })}
  </group>;
}

function ContainerProp({ container: c, world, items, owner }: { container: Container; world: World; items: readonly Item[]; owner?: Agent }) {
  const [x, z] = toScene(world, c.x, c.y);
  const total = items.reduce((n, i) => n + i.qty, 0);
  const wreck = c.kind === 'wreck';
  return <group position={[x, 0, z]} rotation={[0, wreck ? -0.55 : 0.2, 0]}>
    {wreck ? <PlaneWreck /> : c.kind === 'chest' ? <>
      <Box position={[0, 0.3, 0]} scale={[2.8, 0.5, 1.8]} color="#725741" />
      {[-1, 1].map(s => <Box key={s} position={[s * 1.3, 0.8, 0]} scale={[0.18, 1.2, 1.8]} color="#94725e" />)}
      <Box position={[0, 0.8, -0.8]} scale={[2.7, 1.2, 0.18]} color="#94725e" />
      <Box position={[0, 0.65, 0.8]} scale={[2.7, 0.8, 0.18]} color="#94725e" />
      <Box position={[0, 1.65, -0.95]} scale={[2.9, 0.16, 1.8]} color="#ae8e68" rotation={0.06} />
      <Box position={[0, 0.9, 0.91]} scale={[0.5, 0.4, 0.08]} color={owner?.color ?? PALETTE.linen} />
    </> : <mesh position={[0, 0.3, 0]} scale={[1.7, 0.4, 1.3]}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color={PALETTE.linen} roughness={1} /></mesh>}
    <Cargo items={items} wreck={wreck} />
    <Html position={[0, wreck ? 7 : 3.1, 0]} center distanceFactor={110} zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`place-label ${wreck ? 'wreck-label' : ''}`}><strong>{wreck ? 'THE WRECK' : c.kind === 'chest' ? `${owner?.name ?? 'Survivor'}’s chest` : 'Dropped supplies'}</strong><span>{total ? `${total} supplies` : 'Empty'}{wreck ? ' · shared cargo' : ''}</span></div>
    </Html>
  </group>;
}

function PlaneWreck() {
  return <group>
    {/* Open, broken fuselage, half buried. No invented fire or smoke. */}
    <mesh position={[0, 1.05, 2.5]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[2.6, 2.9, 10, 14, 1, true]} /><meshStandardMaterial color="#d0c7ab" roughness={0.96} side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[0, 1.05, -2.55]} rotation={[0, 0, 0]}><torusGeometry args={[2.9, 0.12, 5, 14]} /><meshStandardMaterial color="#7a8177" roughness={1} /></mesh>
    <mesh position={[0, 1.1, 7.5]} scale={[2.55, 2.2, 1.5]} castShadow><sphereGeometry args={[1, 16, 10]} /><meshStandardMaterial color="#babba6" roughness={1} /></mesh>
    {[-1, 1].map(s => <group key={s}>
      <Box position={[s * 2.78, 1.5, 2.5]} scale={[0.08, 0.42, 8.5]} color="#8d6654" />
      {[0, 1, 2].map(i => <mesh key={i} position={[s * 2.65, 2.5, i * 1.8 + 0.5]} rotation={[0, s * Math.PI / 2, 0]} scale={[0.65, 0.48, 1]}><circleGeometry args={[0.5, 12]} /><meshStandardMaterial color="#485d58" side={THREE.DoubleSide} /></mesh>)}
    </group>)}
    <Box position={[-6.1, 0.35, 3]} scale={[8, 0.3, 3.5]} rotation={-0.2} color="#b7b9a4" />
    <Box position={[5, 0.18, 1.5]} scale={[5.5, 0.3, 3]} rotation={0.45} color="#c8c3aa" />
    <group position={[2, 0.3, 12]} rotation={[0.1, 0.25, -0.2]}>
      <mesh position={[0, 1, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><coneGeometry args={[1.7, 5, 12]} /><meshStandardMaterial color="#b7b9a4" roughness={1} /></mesh>
      <Box position={[0, 2.8, 0.5]} scale={[0.25, 4.2, 2.5]} color="#8d6654" />
      <Box position={[0, 1.2, 0.5]} scale={[6, 0.2, 1.8]} color="#c8c3aa" />
    </group>
  </group>;
}
