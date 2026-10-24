import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DbConnection, EventContext } from '../module_bindings';
import type { Agent, Container, HitEvent, Mob, TransferEvent, World, WorldEvent } from '../module_bindings/types';
import { itemColor } from './contract';

export type Moment = { id: number; type: 'hit' | 'transfer' | 'world'; from: [number, number]; to: [number, number]; kind: string; born: number; knockedOut?: boolean };
export type ObservedEvent = WorldEvent & { localId: number; receivedAt: number };
export const momentDuration = (m: Moment) => m.kind === 'flyover' ? 10000 : m.kind === 'flare' ? 4000 : 1600;
export const momentPriority = (m: Moment) => m.type === 'hit' || ['burn', 'pinned', 'wolf_bite', 'bump'].includes(m.kind) ? 3 : m.type === 'transfer' || ['flyover', 'rescued', 'noticed_loss'].includes(m.kind) ? 2 : 1;
export function actorPosition(id: bigint, isMob: boolean, agents: readonly Pick<Agent, 'id' | 'x' | 'y'>[], mobs: readonly Pick<Mob, 'id' | 'x' | 'y'>[]): [number, number] | undefined {
  const row = (isMob ? mobs : agents).find(a => a.id === id);
  return row && [row.x, row.y];
}
export function worldEventPosition(e: Pick<WorldEvent, 'kind' | 'x' | 'y'>, world?: Pick<World, 'width' | 'height'>): [number, number] | undefined {
  // Global rescue and weather events use (0, 0) as a sentinel, not a physical location.
  if (['flyover', 'rescued', 'storm_start', 'storm_end'].includes(e.kind)) return world ? [world.width / 2, world.height / 2] : undefined;
  return [e.x, e.y];
}
export function useMoments(conn: DbConnection | null, agents: readonly Agent[], containers: readonly Container[], mobs: readonly Mob[], enabled: boolean, world?: World) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [events, setEvents] = useState<ObservedEvent[]>([]);
  const latest = useRef({ agents, containers, mobs, enabled, world }); latest.current = { agents, containers, mobs, enabled, world };
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
      const { agents, mobs } = latest.current;
      const from = actorPosition(e.attackerId, e.attackerIsMob, agents, mobs), to = actorPosition(e.victimId, e.victimIsMob, agents, mobs);
      if (from && to) add({ type: 'hit', from, to, kind: '', knockedOut: e.knockedOut });
    };
    const transfer = (_ctx: EventContext, e: TransferEvent) => {
      const from = point(e.fromAgentId, e.fromContainerId), to = point(e.toAgentId, e.toContainerId);
      if (from && to && e.qty > 0) add({ type: 'transfer', from, to, kind: e.kind });
    };
    const worldEvent = (_ctx: EventContext, e: WorldEvent) => {
      if (!latest.current.enabled) return;
      setEvents(old => [...old.slice(-79), { ...e, localId: ++serial.current, receivedAt: performance.now() }]);
      const position = worldEventPosition(e, latest.current.world);
      if (position) add({ type: 'world', from: position, to: position, kind: e.kind });
    };
    conn.db.hitEvent.onInsert(hit); conn.db.transferEvent.onInsert(transfer); conn.db.worldEvent.onInsert(worldEvent);
    const subscription = conn.subscriptionBuilder().subscribe(['SELECT * FROM hit_event', 'SELECT * FROM transfer_event', 'SELECT * FROM world_event']);
    const timer = window.setInterval(() => setMoments(old => old.some(m => performance.now() - m.born > momentDuration(m)) ? old.filter(m => performance.now() - m.born <= momentDuration(m)) : old), 500);
    return () => {
      clearInterval(timer); subscription.unsubscribe();
      conn.db.hitEvent.removeOnInsert(hit); conn.db.transferEvent.removeOnInsert(transfer); conn.db.worldEvent.removeOnInsert(worldEvent);
    };
  }, [conn]);
  return { moments, events };
}

export function EventEffects({ moments, width, height }: { moments: Moment[]; width: number; height: number }) {
  return <group>{moments.map(m => m.kind === 'flyover' ? <Flyover key={m.id} moment={m} width={width} height={height} /> : <Effect key={m.id} moment={m} width={width} height={height} />)}</group>;
}
function Effect({ moment: m, width, height }: { moment: Moment; width: number; height: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const ring = m.type !== 'transfer' && m.kind !== 'flare';
  useFrame(() => {
    if (!mesh.current) return;
    const t = Math.min(1, (performance.now() - m.born) / momentDuration(m));
    mesh.current.visible = t < 1;
    const material = mesh.current.material as THREE.MeshBasicMaterial;
    if (m.type === 'transfer') {
      mesh.current.position.set(THREE.MathUtils.lerp(m.from[0], m.to[0], t) - width / 2, 0.8 + Math.sin(t * Math.PI) * 2, THREE.MathUtils.lerp(m.from[1], m.to[1], t) - height / 2);
      mesh.current.rotation.y = t * 4; material.opacity = Math.min(1, (1 - t) * 5);
    } else if (m.kind === 'flare') {
      mesh.current.position.set(m.to[0] - width / 2 + t * 2, 2 + Math.sin(t * Math.PI * 0.75) * 25, m.to[1] - height / 2);
      material.opacity = Math.min(1, (1 - t) * 4);
    } else {
      mesh.current.position.set(m.to[0] - width / 2, 0.12, m.to[1] - height / 2);
      mesh.current.scale.setScalar(0.7 + t * 2); material.opacity = (1 - t) * 0.6;
    }
  });
  const color = m.type === 'transfer' ? itemColor(m.kind) : ['burn', 'fire_lit', 'flare'].includes(m.kind) ? '#edaa61' : m.type === 'hit' ? '#bd7460' : '#c4d0b1';
  return <mesh ref={mesh} rotation={ring ? [-Math.PI / 2, 0, 0] : [0, 0, 0]} name={`event-${m.kind || m.type}`}>
    {ring ? <ringGeometry args={[0.7, 0.78, 32]} /> : <icosahedronGeometry args={[m.kind === 'flare' ? 0.6 : 0.25, 0]} />}
    <meshBasicMaterial transparent depthWrite={false} color={color} />
  </mesh>;
}
function Flyover({ moment: m, width, height }: { moment: Moment; width: number; height: number }) {
  const root = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!root.current) return;
    const t = (performance.now() - m.born) / momentDuration(m);
    root.current.visible = t < 1;
    root.current.position.set(m.to[0] - width / 2 - 75 + t * 150, 24, m.to[1] - height / 2);
  });
  return <group ref={root} name="rescue-flyover">
    <mesh rotation={[0, 0, Math.PI / 2]}><capsuleGeometry args={[0.6, 5, 4, 10]} /><meshStandardMaterial color="#e5dfc6" roughness={1} /></mesh>
    <mesh><boxGeometry args={[1.4, 0.12, 9]} /><meshStandardMaterial color="#c5c6b1" /></mesh>
    <mesh position={[-2, 0.55, 0]}><boxGeometry args={[1.3, 1.3, 0.12]} /><meshStandardMaterial color="#94725e" /></mesh>
    <mesh position={[-2, 0, 0]}><boxGeometry args={[1, 0.1, 3]} /><meshStandardMaterial color="#c5c6b1" /></mesh>
  </group>;
}
