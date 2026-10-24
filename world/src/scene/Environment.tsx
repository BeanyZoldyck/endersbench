import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { itemColor, type Physics } from './contract';
import type { Agent, Container, Item, ResourceNode, World } from '../module_bindings/types';

export const PALETTE = { forest: '#293f39', moss: '#78866a', grass: '#b5b88b', earth: '#94725e', linen: '#f0e4cc', amber: '#edaa61', winter: '#718899' };
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
    <meshStandardMaterial roughness={1} flatShading />
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
      trunks.push({ position: [x, stump ? 0.25 : h * 0.35, z], scale: [radius, stump ? 0.5 : h * 0.7, radius], color: '#6b5846' });
      if (stump) return;
      for (let c = 0; c < 3; c++) {
        const angle = c * 2.1 + noise(seed) * 2;
        crowns.push({ position: [x + Math.cos(angle) * 1.5, h * (0.9 + c * 0.1), z + Math.sin(angle) * 1.5], scale: decorative ? [3.6 + noise(seed + c), 3.2 + noise(seed + c + 6), 3.5] : [2.25, 2.15, 2.2], color: winter ? ['#72877e', '#8c9b8d', '#a5ae9e'][c] : decorative ? ['#334d40', '#47604a', '#61714f'][c] : ['#6c7e4d', '#8a955d', '#a2a269'][c], rotation: angle });
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
    {nodes.filter(n => n.kind === 'tree' && n.state === 'fallen').map(n => <FallenTree key={String(n.id)} node={n} world={world} physics={physics} />)}
    {containers.map(c => <ContainerProp key={String(c.id)} container={c} world={world} physics={physics} items={inventories.get(c.id) ?? []} owner={agents.find(a => a.id === c.ownerAgentId)} />)}
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

function Box({ position, scale, color, rotation = 0 }: { position: [number, number, number]; scale: [number, number, number]; color: string; rotation?: number; tilt?: number }) {
  return <mesh position={position} scale={scale} rotation={[0, rotation, 0]} castShadow receiveShadow><boxGeometry /><meshStandardMaterial color={color} roughness={0.92} /></mesh>;
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
  const total = items.reduce((n, i) => n + i.qty, 0);
  const wreck = c.kind === 'wreck', chest = c.kind === 'chest';
  const r = physics.chestRadius;
  return <group>
    {wreck && <PlaneWreck world={world} physics={physics} />}
    <group position={[x, 0, z]} onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)}>
      {chest ? <>
        <mesh position={[0, r * 0.55, 0]} castShadow receiveShadow><cylinderGeometry args={[r, r, r * 1.1, 16, 1, true]} /><meshStandardMaterial color="#94725e" roughness={1} side={THREE.DoubleSide} /></mesh>
        <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[r, r, 0.1, 16]} /><meshStandardMaterial color="#725741" roughness={1} /></mesh>
        <mesh position={[0, r * 1.4, -r * 0.5]} rotation={[-0.25, 0, 0]}><circleGeometry args={[r * 0.8, 16]} /><meshStandardMaterial color="#ae8e68" roughness={1} side={THREE.DoubleSide} /></mesh>
        <Box position={[0, r * 0.65, r * 0.95]} scale={[r * 0.4, r * 0.35, r * 0.06]} color={owner?.color ?? PALETTE.linen} />
      </> : <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}><circleGeometry args={[wreck ? 0.65 : 0.45, 16]} /><meshStandardMaterial color={PALETTE.linen} roughness={1} /></mesh>}
      <Cargo items={items} radius={wreck ? 0.7 : r * 0.8} />
      <Html position={[0, wreck ? 3.9 : r * 2.5, 0]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`place-label ${wreck ? 'wreck-label' : ''}`}><strong>{wreck ? 'THE WRECK' : chest ? owner?.name ?? 'Shared chest' : 'Supplies'}</strong>{(wreck || hovered) && <span>{total ? `${total} supplies` : 'Empty'}{wreck ? ' · shared cargo' : ''}</span>}</div>
      </Html>
    </group>
  </group>;
}

function PlaneWreck({ world, physics }: { world: World; physics: Physics }) {
  const f = physics.wreck, r = f.radius, length = f.x2 - f.x1;
  const [x, z] = toScene(world, (f.x1 + f.x2) / 2, f.y1);
  return <group position={[x, 0, z]}>
    {/* The capsule's horizontal silhouette exactly matches the published collider. */}
    <mesh rotation={[0, 0, -Math.PI / 2]} castShadow receiveShadow name="wreck-fuselage">
      <capsuleGeometry args={[r, length, 8, 16]} /><meshStandardMaterial color="#c8c3aa" roughness={1} />
    </mesh>
    <Box position={[0, 0.38, r * 0.96]} scale={[length * 0.95, 0.18, 0.02]} color="#8d6654" />
    {[-0.3, 0, 0.3].map(offset => <mesh key={offset} position={[offset * length, r * 0.63, r * 0.78]}><circleGeometry args={[r * 0.11, 12]} /><meshStandardMaterial color="#485d58" /></mesh>)}
    {/* Cargo door is a hatch on the south side, not the collider's origin. */}
    <Box position={[0, r * 0.45, r * 0.9]} scale={[1.15, r * 0.8, 0.025]} color="#536359" />
    <mesh position={[-length / 2, r * 0.42, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[r * 0.85, 0.06, 5, 16]} /><meshStandardMaterial color="#81897b" /></mesh>
    <Box position={[length * 0.4, r * 1.2, 0]} scale={[1.5, r * 1.5, 0.12]} color="#8d6654" />
    {/* Buried wing fragments are flat paint-like surfaces, never false solid obstacles. */}
    {[-1, 1].map(side => <mesh key={side} position={[0, 0.012, side * r * 1.5]} rotation={[-Math.PI / 2, 0, side * 0.15]}><planeGeometry args={[2.6, r * 2]} /><meshStandardMaterial color="#a8ac96" roughness={1} /></mesh>)}
  </group>;
}

function FallenTree({ node, world, physics }: { node: ResourceNode; world: World; physics: Physics }) {
  const length = physics.fallenTreeLength;
  // Same base-anchored capsule and radius ratio as staticColliders in physics.ts.
  const r = physics.treeRadius * 0.7;
  const [x, z] = toScene(world, node.x + Math.cos(node.angle) * length / 2, node.y + Math.sin(node.angle) * length / 2);
  return <group position={[x, r, z]} rotation={[0, -node.angle, 0]} name={`fallen-tree-${node.id}`}>
    <mesh rotation={[0, 0, -Math.PI / 2]} castShadow receiveShadow><capsuleGeometry args={[r, length, 4, 10]} /><meshStandardMaterial color="#78654e" roughness={1} /></mesh>
    <mesh position={[-length / 2 - r * 0.9, 0, 0]} rotation={[0, -Math.PI / 2, 0]}><circleGeometry args={[r * 0.4, 10]} /><meshStandardMaterial color="#c3a779" roughness={1} /></mesh>
  </group>;
}
