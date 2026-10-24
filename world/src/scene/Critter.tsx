import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Agent, World } from '../module_bindings/types';
import { toScene } from './Environment';

export function Critter({ agent, world, selected, said, onSelect }: {
  agent: Agent; world: World; selected: boolean; said?: string; onSelect: (id: bigint) => void;
}) {
  const root = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null), eyes = useRef<THREE.Group>(null);
  const feet = useRef<THREE.Group>(null);
  const latest = useRef(agent); latest.current = agent;
  // Hold initial position: subsequent snapshots are interpolated in useFrame.
  const initial = useRef<[number, number, number]>([agent.x - world.width / 2, 0, agent.y - world.height / 2]);
  const facing = useRef(0), stride = useRef(0), motion = useRef(0);
  const phase = Number(agent.id % 97n) * 1.731;
  const tint = useMemo(() => new THREE.Color(agent.color).lerp(new THREE.Color('#f0e4cc'), 0.3), [agent.color]);
  const ghost = !agent.alive;
  const opacity = ghost ? 0.3 : 1;
  const thinking = agent.pendingRequestId !== 0n;
  useFrame((state, delta) => {
    if (!root.current || !body.current) return;
    const dt = Math.min(delta, 0.1);
    const a = latest.current;
    const [x, z] = toScene(world, a.x, a.y);
    const dx = (x - root.current.position.x) * (1 - Math.exp(-dt * 14));
    const dz = (z - root.current.position.z) * (1 - Math.exp(-dt * 14));
    const distance = Math.hypot(dx, dz);
    // Respawns are teleports, not an invented walk across the map.
    if (Math.hypot(x - root.current.position.x, z - root.current.position.z) > 20) root.current.position.set(x, 0, z);
    else { root.current.position.x += dx; root.current.position.z += dz; }
    const moving = distance / Math.max(dt, 0.001) > 0.15;
    motion.current = THREE.MathUtils.damp(motion.current, moving && a.alive ? 1 : 0, 10, dt);
    if (moving) { facing.current = Math.atan2(dx, dz); stride.current += distance * 2.4; }
    const turn = facing.current - body.current.rotation.y;
    body.current.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 9);
    const t = state.clock.elapsedTime + phase;
    const breathing = Math.sin(t * 1.65) * 0.012;
    body.current.position.y = 1.65 + breathing - (a.hunger < 20 ? 0.12 : 0);
    body.current.scale.set(1.5, 1.5 * (1 + breathing), 1.5);
    body.current.rotation.z = Math.sin(stride.current) * 0.045 * motion.current + (a.pendingRequestId !== 0n ? 0.055 : 0);
    if (eyes.current) {
      const blink = t % (4.1 + phase % 1.9);
      eyes.current.scale.y = blink < 0.15 ? 0.12 : 1;
    }
    if (feet.current) {
      feet.current.rotation.y = body.current.rotation.y;
      feet.current.children.forEach((foot, i) => { foot.position.z = Math.sin(stride.current + i * Math.PI) * 0.26 * motion.current; });
    }
  });
  return <group ref={root} position={initial.current} onClick={e => { e.stopPropagation(); if (e.delta < 4) onSelect(agent.id); }}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} scale={[1, 0.78, 1]}>
      <circleGeometry args={[1.65, 24]} /><meshBasicMaterial color="#293f39" transparent opacity={ghost ? 0.04 : 0.13} depthWrite={false} />
    </mesh>
    <group ref={feet}>
      {[-1, 1].map(s => <mesh key={s} position={[s * 0.62, 0.22, 0]} scale={[0.43, 0.22, 0.6]} ><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color="#665744" transparent={ghost} opacity={opacity} roughness={1} /></mesh>)}
    </group>
    <group ref={body} position={[0, 1.65, 0]} scale={1.5}>
      <mesh ><sphereGeometry args={[1, 24, 20]} /><meshStandardMaterial color={tint} roughness={0.96} transparent={ghost} opacity={opacity} depthWrite={!ghost} /></mesh>
      <group ref={eyes} position={[0, 0.15, 0]}>
        {[-1, 1].map(s => <group key={s} position={[s * 0.27, 0, 0.95]}>
          <mesh scale={[0.075, 0.13, 0.035]}><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color="#293b36" roughness={1} transparent={ghost} opacity={opacity} /></mesh>
          <mesh position={[-0.015, 0.045, 0.031]} scale={[0.018, 0.022, 0.01]}><sphereGeometry args={[1, 8, 6]} /><meshBasicMaterial color="#f0e4cc" transparent={ghost} opacity={opacity} /></mesh>
        </group>)}
      </group>
      <mesh position={[0, -0.47, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.89, 0.105, 6, 24]} /><meshStandardMaterial color={agent.color} roughness={1} transparent={ghost} opacity={opacity} /></mesh>
      <mesh position={[0.57, -0.67, 0.57]} rotation={[0.12, 0, -0.2]} scale={[0.22, 0.55, 0.12]}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color={agent.color} roughness={1} transparent={ghost} opacity={opacity} /></mesh>
      <mesh position={[-0.72, -0.5, -0.4]} rotation={[0, 0, -0.3]} scale={[0.3, 0.4, 0.25]}><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color="#b8a583" roughness={1} transparent={ghost} opacity={opacity} /></mesh>
    </group>
    {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}><ringGeometry args={[1.9, 2.03, 40]} /><meshBasicMaterial color="#f0e4cc" transparent opacity={0.85} /></mesh>}
    <Html position={[0, 4.15, 0]} center zIndexRange={[12, 8]} style={{ pointerEvents: 'none' }}>
      <div className="tag-stack">
        {said && <div className="bubble">{said.length > 120 ? `${said.slice(0, 117)}…` : said}</div>}
        <div className={`nametag ${ghost ? 'ghost-tag' : ''}`}><span>{agent.name}</span>{thinking && <span className="thinking-dots" aria-label="Thinking"><i /><i /><i /></span>}{ghost && <span className="ghost-word">ghost</span>}</div>
        <div className="mini-needs" aria-label={`Health ${Math.round(agent.hp)}, food ${Math.round(agent.hunger)}`}><i style={{ width: `${Math.max(0, Math.min(100, agent.hp))}%` }} /><i style={{ width: `${Math.max(0, Math.min(100, agent.hunger))}%` }} /></div>
      </div>
    </Html>
  </group>;
}
