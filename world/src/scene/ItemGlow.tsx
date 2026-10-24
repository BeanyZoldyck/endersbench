import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Agent, Container, Item, World } from '../module_bindings/types';
import type { Physics } from './contract';
import { toScene } from './Environment';
import { boundaryFog } from './boundaryFog';
import { CRITTER_SCALE } from './Critter';
import { GLOW, glowFor, type GlowKind } from './glow';

// Item highlights instead of text labels: anything holding items glows in the
// colour of what it holds, brighter when fuller, not at all when empty.

let haloTexture: THREE.Texture | null = null;
function halo() {
  if (haloTexture) return haloTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  haloTexture = new THREE.CanvasTexture(canvas);
  return haloTexture;
}

// Additive light washes out to white on pale ground, so ground glows blend
// normally (they keep their colour); only the rising plume is additive.
const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const;
const tinted = { transparent: true, depthWrite: false, toneMapped: false } as const;

function Glow({ x, z, radius, height, color, ring, intensity, phase }: {
  x: number; z: number; radius: number; height: number; color: string; ring: string | null; intensity: number; phase: number;
}) {
  const group = useRef<THREE.Group>(null);
  const disc = useMemo(() => new THREE.MeshBasicMaterial({ ...boundaryFog, ...tinted, map: halo(), color, opacity: 0.5 * intensity }), [color, intensity]);
  const outline = useMemo(() => new THREE.MeshBasicMaterial({ ...boundaryFog, ...tinted, color, opacity: 0.6 + 0.35 * intensity, side: THREE.DoubleSide }), [color, intensity]);
  const second = useMemo(() => (ring ? new THREE.MeshBasicMaterial({ ...boundaryFog, ...tinted, color: ring, opacity: 0.5 + 0.3 * intensity, side: THREE.DoubleSide }) : null), [ring, intensity]);
  const plume = useMemo(() => new THREE.SpriteMaterial({ ...additive, map: halo(), color, opacity: 0.28 * intensity }), [color, intensity]);
  useEffect(() => () => [disc, outline, second, plume].forEach(m => m?.dispose()), [disc, outline, second, plume]);
  useFrame(({ clock }) => {
    if (!group.current) return;
    // A slow breath, offset per item so the clearing never pulses in unison.
    const breath = 1 + Math.sin(clock.elapsedTime * 1.4 + phase) * 0.06;
    group.current.scale.set(breath, 1, breath);
  });
  return <group position={[x, 0, z]}>
    <group ref={group}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} scale={radius * 4} material={disc}><planeGeometry args={[1, 1]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]} material={outline}><ringGeometry args={[radius * 1.15, radius * 1.4, 40]} /></mesh>
      {second && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.036, 0]} material={second}><ringGeometry args={[radius * 1.55, radius * 1.68, 40]} /></mesh>}
    </group>
    <sprite position={[0, height, 0]} scale={[radius * 2.4, radius * 3.2, 1]} material={plume} />
  </group>;
}

export function ContainerGlows({ world, containers, items, physics }: { world: World; containers: readonly Container[]; items: readonly Item[]; physics: Physics }) {
  return <group name="item-glows">{containers.map(c => {
    const glow = glowFor(items.filter(i => i.containerId === c.id));
    if (!glow) return null;
    const [x, z] = toScene(world, c.x, c.y);
    const radius = c.kind === 'wreck' ? 0.9 : c.kind === 'chest' ? physics.chestRadius : c.kind === 'crate' ? 2.1 : 0.55;
    const height = c.kind === 'wreck' ? 1.3 : c.kind === 'chest' ? physics.chestRadius * 2.2 : c.kind === 'crate' ? 3 : 0.7;
    return <Glow key={String(c.id)} x={x} z={z} radius={radius} height={height} {...glow} phase={Number(c.id % 97n) * 0.7} />;
  })}</group>;
}

// A soft ring under a survivor carrying something, in the colour of what they carry.
export function CarriedGlows({ world, agents, items, physics }: { world: World; agents: readonly Agent[]; items: readonly Item[]; physics: Physics }) {
  return <group name="carried-glows">{agents.filter(a => a.alive).map(a => {
    const glow = glowFor(items.filter(i => i.agentId === a.id));
    return glow ? <Carried key={String(a.id)} agent={a} world={world} radius={physics.agentRadius * CRITTER_SCALE} color={glow.color} intensity={glow.intensity} /> : null;
  })}</group>;
}

function Carried({ agent, world, radius, color, intensity }: { agent: Agent; world: World; radius: number; color: string; intensity: number }) {
  const root = useRef<THREE.Group>(null);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ ...boundaryFog, ...tinted, color, opacity: 0.45 + 0.35 * intensity, side: THREE.DoubleSide }), [color, intensity]);
  useEffect(() => () => material.dispose(), [material]);
  const initial = useMemo(() => toScene(world, agent.x, agent.y), []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_state, delta) => {
    if (!root.current) return;
    // Same easing as the survivor's own body, so the ring stays underfoot.
    const [x, z] = toScene(world, agent.x, agent.y);
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 14);
    root.current.position.x += (x - root.current.position.x) * k;
    root.current.position.z += (z - root.current.position.z) * k;
  });
  return <group ref={root} position={[initial[0], 0, initial[1]]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} material={material}><ringGeometry args={[radius * 1.3, radius * 1.42, 36]} /></mesh>
  </group>;
}

// The one always-on place name.
export function WreckTitle({ world, physics }: { world: World; physics: Physics }) {
  const f = physics.wreck;
  const [x, z] = toScene(world, (f.x1 + f.x2) / 2, f.y1);
  return <Html position={[x, f.radius * 2 + 1.6, z]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
    <div className="place-label wreck-label"><strong>THE WRECK</strong><span>shared cargo</span></div>
  </Html>;
}

const KINDS: GlowKind[] = ['food', 'wood', 'medical', 'flare'];

// Colour is never the only cue: a key says what each glow means.
export function GlowLegend() {
  const [open, setOpen] = useState(true);
  return <div className={`glow-legend ${open ? 'open' : ''}`}>
    <button aria-expanded={open} onClick={() => setOpen(!open)}>Glow key</button>
    {open && <ul>{KINDS.map(k => <li key={k}><i style={{ background: GLOW[k].color, boxShadow: `0 0 8px ${GLOW[k].color}` }} />{GLOW[k].label}</li>)}</ul>}
  </div>;
}
