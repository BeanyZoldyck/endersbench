import { boundaryFog } from './boundaryFog';
import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Agent, Message, World } from '../module_bindings/types';
import type { ReadGameTime } from './useGameClock';
import { toScene } from './Environment';
import type { Weapon } from './contract';

// Survivors are drawn larger than their collision circle so they read at a
// distance; the physics radius is unchanged.
export const CRITTER_SCALE = 1.35;

export function Critter({ agent, world, selected, said, addressedTo, radius: bodyRadius, weapon, readTime, connected, onSelect, card, avatar }: {
  agent: Agent; world: World; selected: boolean; said?: Message; addressedTo?: Agent; radius: number; weapon?: Weapon; readTime: ReadGameTime; connected: boolean; onSelect: (id: bigint) => void;
  card?: ReactNode; avatar?: ReactNode;
}) {
  const radius = bodyRadius * CRITTER_SCALE;
  const root = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null), eyes = useRef<THREE.Group>(null);
  const feet = useRef<THREE.Group>(null);
  const bubble = useRef<HTMLDivElement>(null), cardBox = useRef<HTMLDivElement>(null);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const latest = useRef(agent); latest.current = agent;
  // Hold initial position: subsequent snapshots are interpolated in useFrame.
  const initial = useRef<[number, number, number]>([agent.x - world.width / 2, 0, agent.y - world.height / 2]);
  const facing = useRef(0), stride = useRef(0), motion = useRef(0);
  const phase = Number(agent.id % 97n) * 1.731;
  const tint = useMemo(() => new THREE.Color(agent.color).lerp(new THREE.Color('#f0e4cc'), 0.3), [agent.color]);
  const ghost = !agent.alive;
  const opacity = ghost ? 0.3 : 1;
  const dazed = agent.alive && agent.stunnedUntilMs > world.gameTimeMs;
  const thinking = agent.pendingRequestId !== 0n;
  useFrame((state, delta) => {
    if (!root.current || !body.current) return;
    const dt = Math.min(delta, 0.1);
    const a = latest.current;
    const [x, z] = toScene(world, a.x, a.y);
    const dx = (x - root.current.position.x) * (1 - Math.exp(-dt * 14));
    const dz = (z - root.current.position.z) * (1 - Math.exp(-dt * 14));
    // Respawns are teleports, not an invented walk across the map.
    if (Math.hypot(x - root.current.position.x, z - root.current.position.z) > 20) root.current.position.set(x, 0, z);
    else { root.current.position.x += dx; root.current.position.z += dz; }
    if (bubble.current) {
      projected.set(root.current.position.x, radius * 2.7 + 0.35, root.current.position.z).project(state.camera);
      const screenX = (projected.x + 1) * state.size.width / 2;
      const halfWidth = bubble.current.offsetWidth / 2;
      const clamped = THREE.MathUtils.clamp(screenX, halfWidth + 12, state.size.width - halfWidth - 12);
      bubble.current.style.transform = `translateX(${clamped - screenX}px)`;
    }
    if (cardBox.current) {
      // The status card sits beside the survivor, flipping sides and sliding
      // vertically so it never leaves the view.
      projected.set(root.current.position.x, radius * 1.2, root.current.position.z).project(state.camera);
      const sx = (projected.x + 1) * state.size.width / 2, sy = (1 - projected.y) * state.size.height / 2;
      const w = cardBox.current.offsetWidth, h = cardBox.current.offsetHeight, gap = 34;
      const x = sx + gap + w > state.size.width - 12 && sx - gap - w > 12 ? -gap - w : gap;
      const y = THREE.MathUtils.clamp(sy - h * 0.35, 12, Math.max(12, state.size.height - h - 12)) - sy;
      cardBox.current.style.transform = `translate(${x}px, ${y}px)`;
      cardBox.current.dataset.side = x < 0 ? 'left' : 'right';
      cardBox.current.style.setProperty('--pip', `${THREE.MathUtils.clamp(-y, 18, h - 18)}px`);
    }
    const speed = Math.hypot(a.vx, a.vy);
    const stunned = a.stunnedUntilMs > readTime();
    const moving = speed > 0.12 && !stunned && !a.pinned && a.alive && world.running && connected;
    motion.current = THREE.MathUtils.damp(motion.current, moving ? 1 : 0, 10, dt);
    if (moving) { facing.current = Math.atan2(a.vx, a.vy); stride.current += speed * dt * world.timeScale * 3; }
    const turn = facing.current - body.current.rotation.y;
    body.current.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 9);
    const t = state.clock.elapsedTime + phase;
    const breathing = Math.sin(t * 1.65) * 0.012;
    const cold = a.alive && a.warmth < 30;
    const impulse = Math.min(0.4, Math.hypot(a.kx, a.ky) * 0.055);
    const impactAngle = Math.atan2(a.kx, a.ky) - body.current.rotation.y;
    body.current.position.y = radius * (a.pinned ? 0.65 : 1.1 + breathing - (a.hunger < 20 ? 0.06 : 0));
    body.current.scale.set(radius, radius * (1 + breathing), radius);
    body.current.rotation.x = THREE.MathUtils.damp(body.current.rotation.x, Math.cos(impactAngle) * impulse + (cold ? 0.1 : 0), 12, dt);
    body.current.rotation.z = a.pinned ? 0.6 : Math.sin(stride.current) * 0.045 * motion.current + Math.sin(impactAngle) * impulse + (stunned ? Math.sin(t * 6) * 0.05 : 0) + (cold ? Math.sin(t * 17) * 0.015 : 0) + (a.pendingRequestId !== 0n ? 0.055 : 0);
    if (eyes.current) {
      const toward = addressedTo && said?.channel === 'say' ? Math.atan2(addressedTo.x - a.x, addressedTo.y - a.y) - body.current.rotation.y : 0;
      const headTurn = toward - eyes.current.rotation.y;
      eyes.current.rotation.y += Math.atan2(Math.sin(headTurn), Math.cos(headTurn)) * Math.min(1, dt * 5);
      const blink = t % (4.1 + phase % 1.9);
      eyes.current.scale.y = blink < 0.15 ? 0.12 : 1;
    }
    if (feet.current) {
      feet.current.rotation.y = body.current.rotation.y;
      feet.current.children.forEach((foot, i) => { foot.position.z = Math.sin(stride.current + i * Math.PI) * radius * 0.17 * motion.current; });
    }
  });
  return <group ref={root} position={initial.current} onClick={e => { e.stopPropagation(); if (e.delta < 4) onSelect(agent.id); }}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} scale={[1, 0.78, 1]}>
      <circleGeometry args={[radius, 24]} /><meshBasicMaterial {...boundaryFog} color="#293f39" transparent opacity={ghost ? 0.04 : 0.13} depthWrite={false} />
    </mesh>
    <group ref={feet}>
      {[-1, 1].map(s => <mesh key={s} position={[s * radius * 0.41, radius * 0.15, 0]} scale={[radius * 0.28, radius * 0.15, radius * 0.4]} ><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial {...boundaryFog} color="#665744" transparent={ghost} opacity={opacity} roughness={1} /></mesh>)}
    </group>
    <group ref={body} position={[0, radius * 1.1, 0]} scale={radius}>
      <mesh ><sphereGeometry args={[1, 24, 20]} /><meshStandardMaterial {...boundaryFog} color={tint} roughness={0.96} transparent={ghost} opacity={opacity} depthWrite={!ghost} /></mesh>
      <group ref={eyes} position={[0, 0.15, 0]}>
        {[-1, 1].map(s => <group key={s} position={[s * 0.27, 0, 0.95]}>
          <mesh scale={[0.075, 0.13, 0.035]}><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial {...boundaryFog} color="#293b36" roughness={1} transparent={ghost} opacity={opacity} /></mesh>
          <mesh position={[-0.015, 0.045, 0.031]} scale={[0.018, 0.022, 0.01]}><sphereGeometry args={[1, 8, 6]} /><meshBasicMaterial {...boundaryFog} color="#f0e4cc" transparent={ghost} opacity={opacity} /></mesh>
        </group>)}
      </group>
      <mesh position={[0, -0.47, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.89, 0.105, 6, 24]} /><meshStandardMaterial {...boundaryFog} color={agent.color} roughness={1} transparent={ghost} opacity={opacity} /></mesh>
      <mesh position={[0.57, -0.67, 0.57]} rotation={[0.12, 0, -0.2]} scale={[0.22, 0.55, 0.12]}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial {...boundaryFog} color={agent.color} roughness={1} transparent={ghost} opacity={opacity} /></mesh>
      <mesh position={[-0.72, -0.5, -0.4]} rotation={[0, 0, -0.3]} scale={[0.24, 0.35, 0.2]}><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial {...boundaryFog} color="#b8a583" roughness={1} transparent={ghost} opacity={opacity} /></mesh>
      {weapon && <Spear flaming={weapon === 'flaming_spear'} attacking={agent.intentKind === 'attack'} phase={phase} />}
    </group>
    {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}><ringGeometry args={[radius * 1.15, radius * 1.24, 40]} /><meshBasicMaterial {...boundaryFog} color="#f0e4cc" transparent opacity={0.85} /></mesh>}
    {card && <Html position={[0, radius * 1.2, 0]} zIndexRange={[30, 20]}>
      <div ref={cardBox} className="agent-card" style={{ '--agent-color': agent.color } as CSSProperties}><div className="agent-card-body">{card}</div></div>
    </Html>}
    <Html position={[0, radius * 2.7 + 0.35, 0]} center zIndexRange={[12, 8]} style={{ pointerEvents: 'none' }}>
      <div className="tag-stack">
        {said && <div ref={bubble} className={`bubble ${said.channel === 'whisper' ? 'whisper' : ''}`}>{said.channel === 'whisper' && <span className="speech-channel">🔒 Whisper{addressedTo ? ` to ${addressedTo.name}` : ''}</span>}{said.text.length > 120 ? `${said.text.slice(0, 117)}…` : said.text}</div>}
        <div className={`nametag ${ghost ? 'ghost-tag' : ''}`}>{avatar}<span>{agent.name}</span>{thinking && <span className="thinking-dots" aria-label="Thinking"><i /><i /><i /></span>}{ghost && <span className="ghost-word">ghost</span>}{agent.pinned && <span className="condition-tag">Pinned</span>}{dazed && <span className="condition-tag">Dazed</span>}</div>
        <div className="mini-needs" aria-label={`Health ${Math.round(agent.hp)}, food ${Math.round(agent.hunger)}, warmth ${Math.round(agent.warmth)}`}><i style={{ width: `${Math.max(0, Math.min(100, agent.hp))}%` }} /><i style={{ width: `${Math.max(0, Math.min(100, agent.hunger))}%` }} /><i style={{ width: `${Math.max(0, Math.min(100, agent.warmth))}%` }} /></div>
      </div>
    </Html>
  </group>;
}

// A spear in the survivor's near hand, standing a little outward and above their
// head so it reads from the default camera. Drawn in the body's own units, so it
// turns with them. A flaming spear carries a small flame at its tip. Someone
// attacking levels it and jabs.
function Spear({ flaming, attacking, phase }: { flaming: boolean; attacking: boolean; phase: number }) {
  const root = useRef<THREE.Group>(null), flame = useRef<THREE.Group>(null), sparks = useRef<THREE.Group>(null);
  const jab = useRef(attacking); jab.current = attacking;
  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1), t = clock.elapsedTime + phase;
    if (root.current) {
      root.current.rotation.x = THREE.MathUtils.damp(root.current.rotation.x, jab.current ? 1.1 + Math.sin(t * 13) * 0.14 : 0.08, 10, dt);
      root.current.rotation.z = THREE.MathUtils.damp(root.current.rotation.z, jab.current ? -0.04 : -0.5, 10, dt);
    }
    if (flame.current) {
      flame.current.scale.set(1.35 + Math.sin(t * 9) * 0.13, 1.35 + Math.sin(t * 11) * 0.19 + Math.sin(t * 17) * 0.07, 1.35 + Math.sin(t * 9 + 1) * 0.13);
      flame.current.rotation.z = Math.sin(t * 6) * 0.08;
    }
    sparks.current?.children.forEach((spark, i) => {
      const h = (t * 0.7 + i / 3) % 1;
      spark.position.set(Math.sin(h * 6 + i * 2) * 0.16, 0.3 + h * 1.1, Math.cos(h * 5 + i) * 0.1);
      spark.scale.setScalar(Math.max(0.01, (1 - h) * 0.05));
    });
  });
  const wood = '#8a6a4c';
  return <group ref={root} position={[0.78, -0.62, 0.5]} rotation={[0.08, 0, -0.5]} name={flaming ? 'flaming-spear' : 'spear'}>
    <mesh position={[0, 1.05, 0]} castShadow><cylinderGeometry args={[0.075, 0.09, 3.3, 6]} /><meshStandardMaterial {...boundaryFog} color={wood} roughness={1} flatShading /></mesh>
    <mesh position={[0, 2.45, 0]}><cylinderGeometry args={[0.11, 0.11, 0.18, 6]} /><meshStandardMaterial {...boundaryFog} color="#c9b98a" roughness={1} flatShading /></mesh>
    <mesh position={[0, 3.05, 0]} rotation={[0, Math.PI / 4, 0]} scale={[0.6, 1, 1]}><coneGeometry args={[0.26, 0.8, 4]} /><meshStandardMaterial {...boundaryFog} color={flaming ? '#4a3f36' : '#d3d6cb'} roughness={flaming ? 1 : 0.5} flatShading /></mesh>
    {flaming && <group position={[0, 3.35, 0]} name="spear-flame">
      <group ref={flame}>
        <mesh position={[0, 0.36, 0]}><coneGeometry args={[0.26, 0.9, 6]} /><meshBasicMaterial {...boundaryFog} color="#e9782c" transparent opacity={0.95} toneMapped={false} /></mesh>
        {[-1, 1].map(side => <mesh key={side} position={[side * 0.17, 0.22, 0]} rotation={[0, 0, -side * 0.4]}><coneGeometry args={[0.13, 0.55, 5]} /><meshBasicMaterial {...boundaryFog} color="#ee9a3c" transparent opacity={0.95} toneMapped={false} /></mesh>)}
        <mesh position={[0, 0.26, 0.02]} scale={[0.55, 0.62, 0.55]}><coneGeometry args={[0.26, 0.9, 6]} /><meshBasicMaterial {...boundaryFog} color="#fbd27d" toneMapped={false} /></mesh>
      </group>
      <mesh position={[0, 0.4, 0]} scale={[0.75, 0.95, 0.75]}><icosahedronGeometry args={[1, 1]} /><meshBasicMaterial color="#f08a3a" transparent opacity={0.22} depthWrite={false} toneMapped={false} /></mesh>
      <group ref={sparks}>{[0, 1, 2].map(i => <mesh key={i}><icosahedronGeometry args={[1, 0]} /><meshBasicMaterial color="#f7c27a" /></mesh>)}</group>
    </group>}
  </group>;
}

// Death is permanent: the fallen leave a cairn where they died, ringed in
// their colour, and a tag that stays for the rest of the run.
export function Grave({ agent, world, avatar }: { agent: Agent; world: World; avatar?: ReactNode }) {
  const [x, z] = toScene(world, agent.x, agent.y);
  return <group position={[x, 0, z]} name={`grave-${agent.id}`}>
    {[[0, 0.22, 0, 0.55], [0.08, 0.6, 0.05, 0.42], [-0.04, 0.92, -0.02, 0.3]].map(([dx, y, dz, r], i) => <mesh key={i} position={[dx, y, dz]} scale={[r, r * 0.62, r]} castShadow receiveShadow>
      <icosahedronGeometry args={[1, 0]} /><meshStandardMaterial {...boundaryFog} color={['#8d9180', '#9a9d8c', '#a8aa98'][i]} roughness={1} flatShading />
    </mesh>)}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}><ringGeometry args={[0.85, 1.0, 32]} /><meshBasicMaterial {...boundaryFog} color={agent.color} transparent opacity={0.7} depthWrite={false} /></mesh>
    <Html position={[0, 1.7, 0]} center zIndexRange={[7, 2]} style={{ pointerEvents: 'none' }}>
      <div className="nametag grave-tag">{avatar}<span>{agent.name}</span><span className="ghost-word">died</span></div>
    </Html>
  </group>;
}
