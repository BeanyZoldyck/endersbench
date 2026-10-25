import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

// A vacant office keeps its furniture but fades toward the scene's ground, so the
// occupied offices carry the colour.
export const Tone = createContext((color: string) => color);
const VACANT_GROUND = new THREE.Color('#cfd4ca');
export const faded = (color: string) => `#${new THREE.Color(color).lerp(VACANT_GROUND, .6).getHexString()}`;
export const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Box({ p, size, color, roughness = .8, rotation }: { p: [number, number, number]; size: [number, number, number]; color: string; roughness?: number; rotation?: [number, number, number] }) {
  const tone = useContext(Tone);
  return <mesh position={p} rotation={rotation}><boxGeometry args={size} /><meshStandardMaterial color={tone(color)} roughness={roughness} /></mesh>;
}

// Something arriving in the room: it grows in with a small overshoot, the way the
// clearing's chips land. Reduced motion shows it at once.
export function Appear({ children, position, rotation }: { children: ReactNode; position?: [number, number, number]; rotation?: [number, number, number] }) {
  const group = useRef<THREE.Group>(null), born = useRef(performance.now());
  useFrame(() => {
    if (!group.current) return;
    const t = REDUCED_MOTION ? 1 : Math.min(1, (performance.now() - born.current) / 320);
    const s = t >= 1 ? 1 : 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2); // ease-out-back
    group.current.scale.setScalar(Math.max(.001, s));
  });
  return <group ref={group} position={position} rotation={rotation} scale={REDUCED_MOTION ? 1 : .001}>{children}</group>;
}

// Hover any prop for what it holds, as the clearing's containers list their contents.
export function Hover({ title, lines, at, children }: { title: string; lines: string[]; at: [number, number, number]; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return <group onPointerOver={e => { e.stopPropagation(); setHovered(true); }} onPointerOut={() => setHovered(false)}>
    {children}
    {hovered && <Html center position={at} zIndexRange={[9, 8]} style={{ pointerEvents: 'none' }}>
      <div className="prop-label" role="tooltip"><strong>{title}</strong>{lines.map((line, i) => <span key={i}>{line}</span>)}</div>
    </Html>}
  </group>;
}
