import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DbConnection, EventContext } from '../module_bindings';
import type { Agent, Container, HitEvent, TransferEvent } from '../module_bindings/types';

export type Moment = { id: number; type: 'hit' | 'transfer'; from: [number, number]; to: [number, number]; kind: string; born: number; knockedOut?: boolean };
export function useMoments(conn: DbConnection | null, agents: readonly Agent[], containers: readonly Container[], enabled: boolean) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const latest = useRef({ agents, containers, enabled }); latest.current = { agents, containers, enabled };
  const serial = useRef(0);
  useEffect(() => {
    if (!conn) return;
    const point = (agentId: bigint, containerId = 0n): [number, number] | undefined => {
      const row = agentId !== 0n ? latest.current.agents.find(a => a.id === agentId) : latest.current.containers.find(c => c.id === containerId);
      return row && [row.x, row.y];
    };
    const add = (m: Omit<Moment, 'id' | 'born'>) => {
      if (latest.current.enabled) setMoments(old => [...old.slice(-11), { ...m, id: ++serial.current, born: performance.now() }]);
    };
    const hit = (_ctx: EventContext, e: HitEvent) => {
      const from = point(e.attackerId), to = point(e.victimId);
      if (from && to) add({ type: 'hit', from, to, kind: '', knockedOut: e.knockedOut });
    };
    const transfer = (_ctx: EventContext, e: TransferEvent) => {
      const from = point(e.fromAgentId, e.fromContainerId), to = point(e.toAgentId, e.toContainerId);
      if (from && to && e.qty > 0) add({ type: 'transfer', from, to, kind: e.kind });
    };
    conn.db.hitEvent.onInsert(hit);
    conn.db.transferEvent.onInsert(transfer);
    const subscription = conn.subscriptionBuilder().subscribe(['SELECT * FROM hit_event', 'SELECT * FROM transfer_event']);
    const timer = window.setInterval(() => setMoments(old => old.some(m => performance.now() - m.born > 1600) ? old.filter(m => performance.now() - m.born <= 1600) : old), 500);
    return () => { clearInterval(timer); subscription.unsubscribe(); conn.db.hitEvent.removeOnInsert(hit); conn.db.transferEvent.removeOnInsert(transfer); };
  }, [conn]);
  return moments;
}

export function EventEffects({ moments, width, height }: { moments: Moment[]; width: number; height: number }) {
  return <group>{moments.map(m => <Effect key={m.id} moment={m} width={width} height={height} />)}</group>;
}
function Effect({ moment: m, width, height }: { moment: Moment; width: number; height: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!mesh.current) return;
    const t = Math.min(1, (performance.now() - m.born) / 1200);
    mesh.current.visible = t < 1;
    const material = mesh.current.material as THREE.MeshBasicMaterial;
    if (m.type === 'transfer') {
      mesh.current.position.set(THREE.MathUtils.lerp(m.from[0], m.to[0], t) - width / 2, 1.5 + Math.sin(t * Math.PI) * 3.5, THREE.MathUtils.lerp(m.from[1], m.to[1], t) - height / 2);
      mesh.current.rotation.y = t * 4;
      material.opacity = Math.min(1, (1 - t) * 5);
    } else {
      mesh.current.position.set(m.to[0] - width / 2, 0.12, m.to[1] - height / 2);
      mesh.current.scale.setScalar(1 + t * 3);
      material.opacity = (1 - t) * 0.7;
    }
  });
  return <mesh ref={mesh} rotation={m.type === 'hit' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
    {m.type === 'hit' ? <ringGeometry args={[1, 1.12, 32]} /> : <icosahedronGeometry args={[0.45, 0]} />}
    <meshBasicMaterial transparent depthWrite={false} color={m.type === 'hit' ? '#bd7460' : m.kind === 'berries' ? '#af6171' : m.kind === 'wood' ? '#94725e' : '#edd6a2'} />
  </mesh>;
}
