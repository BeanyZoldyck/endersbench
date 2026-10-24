import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import type { OrbitControls as Controls } from 'three-stdlib';
import * as THREE from 'three';
import type { Agent, Message, World, ResourceNode, Container, Item, Structure, Mob, Hazard } from '../module_bindings/types';
import { Environment, toScene } from './Environment';
import { River } from './River';
import { Critter, Grave } from './Critter';
import { EventEffects, momentPriority, type Moment } from './SceneEvents';

import { heldWeapons, type Physics } from './contract';
import { FOV, MAX_DISTANCE, MIN_DISTANCE, VIEW, defaultFrame, establishingTarget } from './framing';
import { useGameClock } from './useGameClock';
import { FrameCounter, PERF, QUALITY, sceneRenders } from './FrameCounter';
import { Atmosphere } from './Atmosphere';
import { Fires, Shelters, Wolves, Storm } from './Survival';
import { CarriedGlows, ContainerGlows, WreckTitle } from './ItemGlow';

export type CameraMode = 'audience' | 'explore' | 'follow';
export type SceneProps = {
  world: World; agents: readonly Agent[]; messages: readonly Message[];
  nodes: readonly ResourceNode[]; containers: readonly Container[]; items: readonly Item[];
  physics: Physics; structures: readonly Structure[]; mobs: readonly Mob[]; hazards: readonly Hazard[]; connected: boolean;
  selectedId?: bigint; mode: CameraMode; moments: Moment[];
  onSelect: (id: bigint) => void; onExplore: () => void;
  onClickTile: (x: number, y: number) => void;
  // The selected survivor's status card, drawn beside them in the scene.
  selectedCard?: ReactNode;
  // Someone who just broke a rule: the audience camera cuts to them.
  spotlitId?: bigint;
};

export function WorldScene(props: SceneProps) {
  const { world, agents, selectedId } = props;
  sceneRenders.count++;
  const fpsText = useRef<HTMLSpanElement>(null);
  const readTime = useGameClock(world, props.connected);
  // One latest utterance per survivor; never more than two prominent bubbles.
  const lastWords = useMemo(() => {
    const latest = new Map<bigint, Message>();
    for (const message of props.messages) {
      const age = world.gameTimeMs - message.gameTimeMs;
      if (age < 0 || age > 7000) continue;
      if ((latest.get(message.fromAgentId)?.gameTimeMs ?? -Infinity) < message.gameTimeMs) latest.set(message.fromAgentId, message);
    }
    return new Map([...latest.values()].sort((a, b) => b.gameTimeMs - a.gameTimeMs).slice(0, 2).map(m => [m.fromAgentId, m]));
  }, [props.messages, world.gameTimeMs]);
  const weapons = useMemo(() => heldWeapons(props.items), [props.items]);
  return <div className="world" aria-label="Live forest world. Drag to explore, scroll to zoom, select a survivor to follow.">
    <Canvas shadows={QUALITY === 'low' ? false : 'soft'} dpr={QUALITY === 'low' ? 1 : [1, 1.5]} camera={{ position: VIEW.clone().multiplyScalar(170).toArray(), fov: FOV, near: 1, far: 900 }} gl={{ antialias: QUALITY !== 'low', powerPreference: 'high-performance' }}>
      <Atmosphere world={world} hazards={props.hazards} readTime={readTime} />
      <CameraRig {...props} />
      <StaticShadows nodes={props.nodes} containers={props.containers} items={props.items} phase={world.phase} />
      <Environment world={world} nodes={props.nodes} containers={props.containers} items={props.items} agents={agents} physics={props.physics} onClickTile={props.onClickTile} />
      {props.physics.river && <River river={props.physics.river} world={world} />}
      {agents.filter(a => !a.alive).map(a => <Grave key={`grave-${a.id}`} agent={a} world={world} />)}
      {agents.filter(a => a.alive).map(a => <Critter key={String(a.id)} agent={a} world={world} selected={a.id === selectedId} radius={props.physics.agentRadius} weapon={weapons.get(a.id)} readTime={readTime} connected={props.connected} card={a.id === selectedId ? props.selectedCard : undefined} said={lastWords.get(a.id)} addressedTo={agents.find(other => other.id === lastWords.get(a.id)?.toAgentId)} onSelect={props.onSelect} />)}
      <ContainerGlows world={world} containers={props.containers} items={props.items} physics={props.physics} />
      <CarriedGlows world={world} agents={agents} items={props.items} physics={props.physics} />
      <WreckTitle world={world} physics={props.physics} />
      <Fires structures={props.structures} world={world} physics={props.physics} />
      <Shelters structures={props.structures} world={world} physics={props.physics} />
      <Wolves mobs={props.mobs} world={world} physics={props.physics} agents={agents} />
      <Storm hazards={props.hazards} readTime={readTime} />
      <EventEffects moments={props.moments} width={world.width} height={world.height} />
      <FrameCounter target={fpsText} />
    </Canvas>
    <span className={`fps-counter ${PERF ? 'perf' : ''}`} ref={fpsText} aria-hidden="true" />
  </div>;
}

// The view itself (angle, lens, how far back, where the audience camera settles) lives in framing.ts.
function CameraRig({ world, agents, containers, physics, mode, selectedId, spotlitId, moments, onExplore }: SceneProps) {
  const controls = useRef<Controls>(null);
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3());
  const offset = useMemo(() => new THREE.Vector3(), []);
  const shot = useRef({ at: -Infinity, eventId: 0, priority: 0 });
  const lastMode = useRef(mode);
  // The default frame holds the supply crate at the bottom when the world says where it is.
  const crateAt = physics.crate ? toScene(world, physics.crate.x, physics.crate.y) : undefined;
  const crateX = crateAt?.[0], crateZ = crateAt?.[1];
  const frame = useMemo(() => defaultFrame(size.width / Math.max(1, size.height), crateX === undefined || crateZ === undefined ? undefined : { x: crateX, z: crateZ }), [size.width, size.height, crateX, crateZ]);
  useEffect(() => {
    camera.position.copy(controls.current?.target ?? target.current).addScaledVector(VIEW, frame.distance);
    camera.updateProjectionMatrix();
  }, [camera, frame]);
  useFrame((_state, delta) => {
    const control = controls.current;
    if (!control) return;
    // Bound panning to the world, preserving the camera offset.
    if (mode === 'explore') {
      const distance = Math.hypot(control.target.x, control.target.z);
      if (distance > world.radius + 10) {
        offset.copy(control.target);
        control.target.multiplyScalar((world.radius + 10) / distance);
        offset.sub(control.target);
        camera.position.sub(offset);
      }
      lastMode.current = mode;
      return;
    }
    if (lastMode.current !== mode) { shot.current.at = -Infinity; lastMode.current = mode; }
    const following = (mode === 'follow' && agents.find(a => a.id === selectedId)) || (mode === 'audience' && spotlitId !== undefined && agents.find(a => a.id === spotlitId));
    if (following) target.current.set(following.x - world.width / 2, 0, following.y - world.height / 2);
    else {
      const now = performance.now();
      const recent = moments.filter(m => momentPriority(m) > 0).sort((a, b) => momentPriority(b) - momentPriority(a) || b.born - a.born)[0];
      const priority = recent ? momentPriority(recent) : 0;
      if (recent && recent.id !== shot.current.eventId && (now - shot.current.at > 6500 || (priority > shot.current.priority && now - shot.current.at > 3500))) {
        target.current.set((recent.from[0] + recent.to[0]) / 2 - world.width / 2, 0, (recent.from[1] + recent.to[1]) / 2 - world.height / 2);
        shot.current = { at: now, eventId: recent.id, priority };
      } else if (now - shot.current.at > 14000) {
        // Stable establishing shot around the real cast, or the real wreck when empty.
        const wreck = containers.find(c => c.kind === 'wreck');
        const x = agents.length ? agents.reduce((n, a) => n + a.x, 0) / agents.length : wreck?.x ?? world.width / 2;
        const y = agents.length ? agents.reduce((n, a) => n + a.y, 0) / agents.length : wreck?.y ?? world.height / 2;
        const settle = establishingTarget({ x: x - world.width / 2, z: y - world.height / 2 }, frame.shift, crateX === undefined || crateZ === undefined ? undefined : { x: crateX, z: crateZ });
        target.current.set(settle.x, 0, settle.z);
        shot.current.at = now; shot.current.priority = 0;
      }
    }
    offset.copy(target.current).sub(control.target).multiplyScalar(1 - Math.exp(-Math.min(delta, 0.1) * (following ? 2 : 0.65)));
    control.target.add(offset); camera.position.add(offset); control.update();
  });
  return <MapControls ref={controls} makeDefault enableRotate={false} enableDamping dampingFactor={0.08} minDistance={MIN_DISTANCE} maxDistance={MAX_DISTANCE} zoomToCursor onStart={onExplore} />;
}

// Vegetation and props are static between table updates. Characters use cheap
// contact discs, so the sun's shadow map need not be rendered every frame.
function StaticShadows({ nodes, containers, items, phase }: Pick<SceneProps, 'nodes' | 'containers' | 'items'> & { phase: string }) {
  const gl = useThree(state => state.gl);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => { gl.shadowMap.autoUpdate = true; };
  }, [gl, nodes, containers, items, phase]);
  return null;
}
