import { boundaryFog } from './boundaryFog';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { DbConnection, EventContext } from '../module_bindings';
import type { Agent, Container, HitEvent, Mob, TransferEvent, World, WorldEvent } from '../module_bindings/types';
import { GLOW, glowCategory } from './glow';

// Same colours as the glow key: food, wood, medical, flare.
const fxColor = (item: string) => GLOW[glowCategory(item)].color;

// pop: a label that rises and fades over someone (+1 wood, ate a berry, −12).
// flight: an item token carried from one place to another (into a chest, onto a fire).
export type Moment = { id: number; type: 'hit' | 'transfer' | 'world' | 'pop' | 'flight'; from: [number, number]; to: [number, number]; kind: string; born: number; knockedOut?: boolean; label?: string; item?: string; color?: string };
export type ObservedEvent = WorldEvent & { localId: number; receivedAt: number };
export const momentDuration = (m: Moment) => m.kind === 'flyover' ? 10000 : m.kind === 'flare' ? 4000 : m.type === 'pop' ? 1500 : m.type === 'flight' || m.type === 'transfer' ? 1300 : 1600;
export const momentPriority = (m: Moment) => m.type === 'pop' ? 0 : m.type === 'hit' || ['burn', 'pinned', 'wolf_bite', 'bump'].includes(m.kind) ? 3 : m.type === 'transfer' || ['flyover', 'rescued', 'noticed_loss', 'shelter_done'].includes(m.kind) ? 2 : 1;

const singular = (kind: string) => kind === 'berries' ? 'berry' : kind;
const plural = (kind: string, qty: number) => qty === 1 ? singular(kind) : kind === 'berries' || kind === 'wood' || kind === 'meat' ? kind : `${kind}s`;
// What a viewer reads over the action.
export function popLabel(kind: string, text: string, qty?: number) {
  if (kind === 'gathered') return `+1 ${singular(text)}`;
  if (kind === 'transfer') return `${qty ?? 1} ${plural(text, qty ?? 1)}`;
  if (kind === 'ate') return text === 'meat' ? 'ate some meat' : `ate a ${singular(text)}`;
  if (kind === 'built') return `+${text} wood`;
  if (kind === 'fire_fed' || kind === 'fire_lit') return qty ? `+${qty} wood` : '+wood';
  if (kind === 'hit') return `−${qty ?? 0}`;
  if (kind === 'healed') return 'healed';
  return kind.replace(/_/g, ' ');
}
// Wall panels standing on a shelter that still needs `woodNeeded` of `total` wood.
export function shelterPanels(woodNeeded: number, total: number, panels: number) {
  return Math.floor(((total - Math.max(0, Math.min(total, woodNeeded))) / Math.max(1, total)) * panels);
}
// Events that only animate; they would flood the journal and captions.
const FEEDBACK_ONLY = new Set(['gathered', 'ate', 'built', 'fire_fed']);
export function actorPosition(id: bigint, isMob: boolean, agents: readonly Pick<Agent, 'id' | 'x' | 'y'>[], mobs: readonly Pick<Mob, 'id' | 'x' | 'y'>[]): [number, number] | undefined {
  const row = (isMob ? mobs : agents).find(a => a.id === id);
  return row && [row.x, row.y];
}
export function worldEventPosition(e: Pick<WorldEvent, 'kind' | 'x' | 'y'>, world?: Pick<World, 'width' | 'height'>): [number, number] | undefined {
  // Global rescue and weather events use (0, 0) as a sentinel, not a physical location.
  if (['flyover', 'rescued', 'storm_start', 'storm_end'].includes(e.kind)) return world ? [world.width / 2, world.height / 2] : undefined;
  return [e.x, e.y];
}
type Lookup = {
  agents: readonly Pick<Agent, 'id' | 'x' | 'y'>[];
  containers: readonly Pick<Container, 'id' | 'x' | 'y'>[];
  mobs: readonly Pick<Mob, 'id' | 'x' | 'y'>[];
  world?: Pick<World, 'width' | 'height'>;
};
export type EventTable = 'hit_event' | 'transfer_event' | 'world_event';

// What the viewer draws for one server event, live or replayed.
export function eventMoments(table: EventTable, e: any, l: Lookup): Omit<Moment, 'id' | 'born'>[] {
  const point = (agentId: bigint, containerId = 0n): [number, number] | undefined => {
    const row = agentId !== 0n ? l.agents.find(a => a.id === agentId) : l.containers.find(c => c.id === containerId);
    return row && [row.x, row.y];
  };
  const out: Omit<Moment, 'id' | 'born'>[] = [];
  if (table === 'hit_event') {
    const from = actorPosition(e.attackerId, e.attackerIsMob, l.agents, l.mobs), to = actorPosition(e.victimId, e.victimIsMob, l.agents, l.mobs);
    if (from && to) out.push({ type: 'hit', from, to, kind: '', knockedOut: e.knockedOut });
    if (to && e.damage > 0) out.push({ type: 'pop', from: to, to, kind: 'hit', label: popLabel('hit', '', e.damage), color: '#bd5a46' });
    return out;
  }
  if (table === 'transfer_event') {
    const from = point(e.fromAgentId, e.fromContainerId), to = point(e.toAgentId, e.toContainerId);
    if (from && to && e.qty > 0) out.push({ type: 'transfer', from, to, kind: e.kind, item: e.kind, label: popLabel('transfer', e.kind, e.qty) });
    return out;
  }
  const position = worldEventPosition(e, l.world);
  if (!position) return out;
  const actor = e.agentId !== 0n ? point(e.agentId) : undefined;
  if (e.kind === 'gathered' || e.kind === 'ate') out.push({ type: 'pop', from: position, to: position, kind: e.kind, item: e.text, label: popLabel(e.kind, e.text) });
  else if (e.kind === 'healed') out.push({ type: 'pop', from: position, to: position, kind: e.kind, label: popLabel('healed', ''), color: '#6f9a6b' });
  // Wood carried from the builder onto the shelter or a fire.
  else if (actor && ['built', 'shelter_done', 'fire_fed', 'fire_lit'].includes(e.kind)) {
    out.push({ type: 'flight', from: actor, to: position, kind: e.kind, item: 'wood', label: e.kind === 'shelter_done' ? 'shelter finished!' : popLabel(e.kind, e.text) });
    if (e.kind === 'fire_lit' || e.kind === 'shelter_done') out.push({ type: 'world', from: position, to: position, kind: e.kind });
  } else out.push({ type: 'world', from: position, to: position, kind: e.kind });
  return out;
}

// Moments expire on their own; callers push new ones.
export function useMomentQueue() {
  const [moments, setMoments] = useState<Moment[]>([]);
  const serial = useRef(0);
  useEffect(() => {
    const timer = window.setInterval(() => setMoments(old => old.some(m => performance.now() - m.born > momentDuration(m)) ? old.filter(m => performance.now() - m.born <= momentDuration(m)) : old), 500);
    return () => clearInterval(timer);
  }, []);
  const push = useCallback((list: Omit<Moment, 'id' | 'born'>[]) => {
    if (list.length) setMoments(old => [...old, ...list.map(m => ({ ...m, id: ++serial.current, born: performance.now() }))].slice(-24));
  }, []);
  return { moments, push, serial };
}

export function useMoments(conn: DbConnection | null, agents: readonly Agent[], containers: readonly Container[], mobs: readonly Mob[], enabled: boolean, world?: World) {
  const { moments, push, serial } = useMomentQueue();
  const [events, setEvents] = useState<ObservedEvent[]>([]);
  const latest = useRef({ agents, containers, mobs, enabled, world }); latest.current = { agents, containers, mobs, enabled, world };
  useEffect(() => {
    if (!conn) return;
    const on = (table: EventTable) => (_ctx: EventContext, e: HitEvent | TransferEvent | WorldEvent) => {
      const l = latest.current;
      if (!l.enabled) return;
      if (table === 'world_event' && !FEEDBACK_ONLY.has((e as WorldEvent).kind)) setEvents(old => [...old.slice(-79), { ...(e as WorldEvent), localId: ++serial.current, receivedAt: performance.now() }]);
      push(eventMoments(table, e, l));
    };
    const hit = on('hit_event'), transfer = on('transfer_event'), worldEvent = on('world_event');
    conn.db.hitEvent.onInsert(hit); conn.db.transferEvent.onInsert(transfer); conn.db.worldEvent.onInsert(worldEvent);
    const subscription = conn.subscriptionBuilder().subscribe(['SELECT * FROM hit_event', 'SELECT * FROM transfer_event', 'SELECT * FROM world_event']);
    return () => {
      subscription.unsubscribe();
      conn.db.hitEvent.removeOnInsert(hit); conn.db.transferEvent.removeOnInsert(transfer); conn.db.worldEvent.removeOnInsert(worldEvent);
    };
  }, [conn, push, serial]);
  return { moments, events };
}

export function EventEffects({ moments, width, height }: { moments: Moment[]; width: number; height: number }) {
  return <group>{moments.map(m => m.kind === 'flyover' ? <Flyover key={m.id} moment={m} width={width} height={height} />
    : m.type === 'pop' ? <Pop key={m.id} moment={m} width={width} height={height} />
    : m.type === 'flight' || m.type === 'transfer' ? <Flight key={m.id} moment={m} width={width} height={height} />
    : <Effect key={m.id} moment={m} width={width} height={height} />)}</group>;
}

// A chip that rises over the actor and fades; the motion is CSS so it costs no frames.
function Pop({ moment: m, width, height }: { moment: Moment; width: number; height: number }) {
  const color = m.color ?? (m.item ? fxColor(m.item) : '#c4d0b1');
  return <Html position={[m.to[0] - width / 2, 2.4, m.to[1] - height / 2]} center zIndexRange={[18, 14]} style={{ pointerEvents: 'none' }}>
    <div className="fx-pop" style={{ '--fx': color } as CSSProperties}><span className="fx-chip"><i />{m.label}</span></div>
  </Html>;
}

// The item itself, labelled, arcing from giver to receiver; a ring marks where it lands.
function Flight({ moment: m, width, height }: { moment: Moment; width: number; height: number }) {
  const token = useRef<THREE.Group>(null), landing = useRef<THREE.Mesh>(null);
  const item = m.item ?? m.kind;
  const color = fxColor(item);
  const lift = Math.min(4, 1.5 + Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]) * 0.25);
  useFrame(() => {
    const t = Math.min(1, (performance.now() - m.born) / momentDuration(m));
    const travel = Math.min(1, t / 0.75), ease = travel * travel * (3 - 2 * travel);
    if (token.current) {
      token.current.visible = travel < 1;
      token.current.position.set(THREE.MathUtils.lerp(m.from[0], m.to[0], ease) - width / 2, 1.4 + Math.sin(ease * Math.PI) * lift, THREE.MathUtils.lerp(m.from[1], m.to[1], ease) - height / 2);
      token.current.rotation.y = t * 6;
    }
    if (landing.current) {
      const k = Math.max(0, (t - 0.72) / 0.28);
      landing.current.visible = k > 0 && k < 1;
      landing.current.scale.setScalar(0.6 + k * 1.6);
      (landing.current.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
    }
  });
  return <group name={`flight-${m.kind}`}>
    <group ref={token}>
      <mesh castShadow={false}><icosahedronGeometry args={[0.42, 0]} /><meshBasicMaterial {...boundaryFog} color={color} /></mesh>
      <Html position={[0, 0.9, 0]} center zIndexRange={[18, 14]} style={{ pointerEvents: 'none' }}><span className="fx-chip" style={{ '--fx': color } as CSSProperties}><i />{m.label}</span></Html>
    </group>
    <mesh ref={landing} rotation={[-Math.PI / 2, 0, 0]} position={[m.to[0] - width / 2, 0.08, m.to[1] - height / 2]} visible={false}>
      <ringGeometry args={[0.7, 0.85, 32]} /><meshBasicMaterial {...boundaryFog} transparent depthWrite={false} color={color} />
    </mesh>
  </group>;
}
function Effect({ moment: m, width, height }: { moment: Moment; width: number; height: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const ring = m.kind !== 'flare';
  useFrame(() => {
    if (!mesh.current) return;
    const t = Math.min(1, (performance.now() - m.born) / momentDuration(m));
    mesh.current.visible = t < 1;
    const material = mesh.current.material as THREE.MeshBasicMaterial;
    if (m.kind === 'flare') {
      mesh.current.position.set(m.to[0] - width / 2 + t * 2, 2 + Math.sin(t * Math.PI * 0.75) * 25, m.to[1] - height / 2);
      material.opacity = Math.min(1, (1 - t) * 4);
    } else {
      mesh.current.position.set(m.to[0] - width / 2, 0.12, m.to[1] - height / 2);
      mesh.current.scale.setScalar(0.7 + t * 2); material.opacity = (1 - t) * 0.6;
    }
  });
  const color = ['burn', 'fire_lit', 'flare'].includes(m.kind) ? '#edaa61' : m.kind === 'shelter_done' ? '#c99a5b' : m.type === 'hit' ? '#bd7460' : '#c4d0b1';
  return <mesh ref={mesh} rotation={ring ? [-Math.PI / 2, 0, 0] : [0, 0, 0]} name={`event-${m.kind || m.type}`}>
    {ring ? <ringGeometry args={[0.7, 0.78, 32]} /> : <icosahedronGeometry args={[m.kind === 'flare' ? 0.6 : 0.25, 0]} />}
    <meshBasicMaterial {...boundaryFog} transparent depthWrite={false} color={color} />
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
    <mesh rotation={[0, 0, Math.PI / 2]}><capsuleGeometry args={[0.6, 5, 4, 10]} /><meshStandardMaterial {...boundaryFog} color="#e5dfc6" roughness={1} /></mesh>
    <mesh><boxGeometry args={[1.4, 0.12, 9]} /><meshStandardMaterial {...boundaryFog} color="#c5c6b1" /></mesh>
    <mesh position={[-2, 0.55, 0]}><boxGeometry args={[1.3, 1.3, 0.12]} /><meshStandardMaterial {...boundaryFog} color="#94725e" /></mesh>
    <mesh position={[-2, 0, 0]}><boxGeometry args={[1, 0.1, 3]} /><meshStandardMaterial {...boundaryFog} color="#c5c6b1" /></mesh>
  </group>;
}
