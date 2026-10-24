import { boundaryFog } from './boundaryFog';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls } from 'three-stdlib';
import * as THREE from 'three';
import type { Hazard, Mob, Structure, World } from '../module_bindings/types';
import { activeStorm, type Physics } from './contract';
import { toScene } from './Environment';
import type { ReadGameTime } from './useGameClock';

export function Fires({ structures, world, physics }: { structures: readonly Structure[]; world: World; physics: Physics }) {
  return <group>{structures.filter(s => s.kind === 'campfire' || s.kind === 'signal_fire').map(s => <Fire key={String(s.id)} structure={s} world={world} radius={physics.fireRadius} />)}</group>;
}
function Fire({ structure: s, world, radius: r }: { structure: Structure; world: World; radius: number }) {
  const flames = useRef<THREE.Group>(null), light = useRef<THREE.PointLight>(null), smoke = useRef<THREE.InstancedMesh>(null);
  const maxObservedNeed = useRef(s.woodNeeded);
  maxObservedNeed.current = Math.max(maxObservedNeed.current, s.woodNeeded);
  const signal = s.kind === 'signal_fire';
  // Only show wood observed being added; joining mid-build does not invent an initial stock.
  const built = s.woodNeeded === 0 ? 1 : maxObservedNeed.current ? (maxObservedNeed.current - s.woodNeeded) / maxObservedNeed.current : 0;
  const fuel = s.maxFuel > 0 ? THREE.MathUtils.clamp(s.fuel / s.maxFuel, 0, 1) : 0;
  const burning = s.lit && s.fuel > 0 && fuel > 0;
  const [x, z] = toScene(world, s.x, s.y);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (flames.current) {
      const height = (signal ? 5 : 2.5) * r * fuel;
      flames.current.scale.set(r * (0.55 + Math.sin(t * 9) * 0.035), height * (1 + Math.sin(t * 7) * 0.06), r * 0.55);
      flames.current.rotation.z = Math.sin(t * 5) * 0.05;
    }
    if (light.current) light.current.intensity = burning ? (signal ? 60 : 24) * fuel * (1 + Math.sin(t * 7) * 0.04) : 0;
    if (smoke.current && burning) {
      for (let i = 0; i < 10; i++) {
        const h = ((t * 0.2 + i / 10) % 1);
        dummy.position.set(Math.sin(h * 4 + i) * h * 0.6, 2 + h * 13, h * 2);
        dummy.scale.setScalar(0.4 + h * 1.4); dummy.updateMatrix(); smoke.current.setMatrixAt(i, dummy.matrix);
      }
      smoke.current.instanceMatrix.needsUpdate = true;
    }
  });
  const logs = signal ? Math.ceil(built * 9) : Math.ceil(fuel * 6);
  return <group position={[x, 0, z]} name={`structure-${s.id}`}>
    {Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[Math.cos(i * Math.PI / 4) * r * 0.83, r * 0.14, Math.sin(i * Math.PI / 4) * r * 0.83]} scale={[r * 0.17, r * 0.14, r * 0.17]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial {...boundaryFog} color="#8d9180" roughness={1} /></mesh>)}
    {Array.from({ length: logs }, (_, i) => <mesh key={i} position={[0, r * (0.16 + i * 0.11), 0]} rotation={[Math.PI / 2, 0, i * 2.4]}><cylinderGeometry args={[r * 0.12, r * 0.12, r * 1.4, 7]} /><meshStandardMaterial {...boundaryFog} color={s.fuel === 0 && s.woodNeeded === 0 ? '#535346' : '#7c6248'} roughness={1} /></mesh>)}
    {burning && <>
      <group ref={flames} position={[0, r * 0.25, 0]} name="lit-flames">
        <mesh position={[0, 0.5, 0]}><coneGeometry args={[1, 1, 7]} /><meshBasicMaterial {...boundaryFog} color="#edaa61" transparent opacity={0.9} /></mesh>
        <mesh position={[0, 0.32, 0.1]} scale={[0.55, 0.6, 0.55]}><coneGeometry args={[1, 1, 7]} /><meshBasicMaterial {...boundaryFog} color="#f4e3ae" /></mesh>
      </group>
      <pointLight ref={light} color="#edaa61" position={[0, signal ? 2.5 : 1.2, 0]} distance={signal ? 15 : 9} decay={2} />
      {signal && <instancedMesh ref={smoke} args={[undefined, undefined, 10]} frustumCulled={false} name="signal-smoke"><icosahedronGeometry args={[1, 1]} /><meshBasicMaterial {...boundaryFog} color="#93998e" transparent opacity={0.2} depthWrite={false} /></instancedMesh>}
    </>}
  </group>;
}

export function Wolves({ mobs, world, physics }: { mobs: readonly Mob[]; world: World; physics: Physics }) {
  return <group>{mobs.filter(m => m.kind === 'wolf').map(m => <Wolf key={String(m.id)} mob={m} world={world} radius={physics.wolfRadius} />)}</group>;
}
function Wolf({ mob: m, world, radius: r }: { mob: Mob; world: World; radius: number }) {
  const root = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null);
  const initial = useRef<[number, number, number]>([m.x - world.width / 2, 0, m.y - world.height / 2]);
  const gait = useRef(0);
  useFrame((_state, delta) => {
    if (!root.current || !body.current) return;
    const dt = Math.min(delta, 0.1), [x, z] = toScene(world, m.x, m.y);
    const k = 1 - Math.exp(-dt * 14);
    root.current.position.x += (x - root.current.position.x) * k;
    root.current.position.z += (z - root.current.position.z) * k;
    const speed = world.running && m.hp > 0 ? Math.hypot(m.vx, m.vy) : 0;
    if (speed > 0.1) {
      const turn = Math.atan2(m.vx, m.vy) - body.current.rotation.y;
      body.current.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 10);
      gait.current += speed * dt * world.timeScale * 4;
    }
    body.current.rotation.z = m.hp <= 0 ? Math.PI / 2 : Math.sin(gait.current) * Math.min(0.035, speed * 0.01);
    body.current.rotation.x = Math.min(0.2, Math.hypot(m.kx, m.ky) * 0.03);
  });
  return <group ref={root} position={initial.current} name={`wolf-${m.id}`}>
    <group ref={body} position={[0, r * 0.55, 0]}>
      <mesh scale={[r * 0.65, r * 0.55, r * 0.9]}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial {...boundaryFog} color="#7c827e" roughness={1} /></mesh>
      <mesh position={[0, r * 0.25, r * 0.55]} scale={[r * 0.43, r * 0.43, r * 0.45]}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial {...boundaryFog} color="#999d8b" roughness={1} /></mesh>
      {[-1, 1].map(side => <group key={side}>
        <mesh position={[side * r * 0.3, r * 0.68, r * 0.48]}><coneGeometry args={[r * 0.2, r * 0.45, 4]} /><meshStandardMaterial {...boundaryFog} color="#717971" roughness={1} /></mesh>
        <mesh position={[side * r * 0.2, r * 0.35, r * 0.91]}><sphereGeometry args={[r * 0.045, 8, 6]} /><meshBasicMaterial {...boundaryFog} color="#293f39" /></mesh>
      </group>)}
    </group>
  </group>;
}

export function Storm({ hazards, readTime }: { hazards: readonly Hazard[]; readTime: ReadGameTime }) {
  const lines = useRef<THREE.LineSegments>(null);
  const controls = useThree(state => state.controls) as OrbitControls | null;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(160 * 6), 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ clock }) => {
    if (!lines.current) return;
    lines.current.visible = activeStorm(hazards, readTime());
    if (!lines.current.visible) return;
    const positions = geometry.attributes.position;
    const t = clock.elapsedTime;
    for (let i = 0; i < 160; i++) {
      const y = 18 - ((t * 13 + i * 7.13) % 18);
      const x = ((i * 13.77) % 50) - 25 + y * 0.2;
      const z = ((i * 19.13) % 50) - 25;
      positions.setXYZ(i * 2, x, y, z); positions.setXYZ(i * 2 + 1, x - 0.25, y - 1.2, z);
    }
    positions.needsUpdate = true;
    if (controls) lines.current.position.set(controls.target.x, 0, controls.target.z);
  });
  return <lineSegments ref={lines} geometry={geometry} frustumCulled={false} visible={false} name="storm-rain"><lineBasicMaterial {...boundaryFog} color="#b0c3ce" transparent opacity={0.38} depthWrite={false} /></lineSegments>;
}
