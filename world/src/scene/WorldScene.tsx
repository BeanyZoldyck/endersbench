import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import type { OrbitControls as Controls } from 'three-stdlib';
import * as THREE from 'three';
import type { Agent, Message, World, ResourceNode, Container, Item } from '../module_bindings/types';
import { Environment } from './Environment';
import { Critter } from './Critter';
import { EventEffects, type Moment } from './SceneEvents';

export type CameraMode = 'audience' | 'explore' | 'follow';
export type SceneProps = {
  world: World; agents: readonly Agent[]; messages: readonly Message[];
  nodes: readonly ResourceNode[]; containers: readonly Container[]; items: readonly Item[];
  selectedId?: bigint; mode: CameraMode; moments: Moment[];
  onSelect: (id: bigint) => void; onExplore: () => void;
  onClickTile: (x: number, y: number) => void;
};

export function WorldScene(props: SceneProps) {
  const { world, agents, selectedId } = props;
  const winter = world.phase === 'winter';
  // One latest utterance per survivor; never more than two prominent bubbles.
  const lastWords = useMemo(() => {
    const latest = new Map<bigint, Message>();
    for (const message of props.messages) {
      const age = world.gameTimeMs - message.gameTimeMs;
      if (age < 0 || age > 7000) continue;
      if ((latest.get(message.fromAgentId)?.gameTimeMs ?? -Infinity) < message.gameTimeMs) latest.set(message.fromAgentId, message);
    }
    return new Map([...latest.values()].sort((a, b) => b.gameTimeMs - a.gameTimeMs).slice(0, 2).map(m => [m.fromAgentId, m.text]));
  }, [props.messages, world.gameTimeMs]);
  return <div className="world" aria-label="Live forest world. Drag to explore, scroll to zoom, select a survivor to follow.">
    <Canvas shadows orthographic dpr={[1, 1.5]} camera={{ position: [80, 95, 110], zoom: 9, near: 0.1, far: 500 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <color attach="background" args={[winter ? '#aabcc0' : '#a4ad91']} />
      <fog attach="fog" args={[winter ? '#aabcc0' : '#a4ad91', 115, 255]} />
      <hemisphereLight args={['#d9e5df', '#706650', 1.3]} />
      <directionalLight castShadow position={[-35, 28, 20]} color={winter ? '#e3e6da' : '#ffe0a8'} intensity={winter ? 1.5 : 2.1}
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-55} shadow-camera-right={55} shadow-camera-top={55} shadow-camera-bottom={-55} shadow-camera-far={180} shadow-normalBias={0.08} shadow-bias={-0.0002} />
      <CameraRig {...props} />
      <StaticShadows nodes={props.nodes} containers={props.containers} items={props.items} phase={world.phase} />
      <Environment world={world} nodes={props.nodes} containers={props.containers} items={props.items} agents={agents} onClickTile={props.onClickTile} />
      {agents.map(a => <Critter key={String(a.id)} agent={a} world={world} selected={a.id === selectedId} said={lastWords.get(a.id)} onSelect={props.onSelect} />)}
      <EventEffects moments={props.moments} width={world.width} height={world.height} />
    </Canvas>
  </div>;
}

function CameraRig({ world, agents, containers, mode, selectedId, moments, onExplore }: SceneProps) {
  const controls = useRef<Controls>(null);
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3());
  const offset = useMemo(() => new THREE.Vector3(), []);
  const shot = useRef({ at: -Infinity, eventId: 0, priority: 0 });
  const lastMode = useRef(mode);
  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    ortho.zoom = Math.max(3, Math.min(size.width / 108, size.height / 78));
    ortho.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
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
    const following = mode === 'follow' && agents.find(a => a.id === selectedId);
    if (following) target.current.set(following.x - world.width / 2, 0, following.y - world.height / 2);
    else {
      const now = performance.now();
      const recent = [...moments].sort((a, b) => (b.type === 'hit' ? 2 : 1) - (a.type === 'hit' ? 2 : 1) || b.born - a.born)[0];
      const priority = recent?.type === 'hit' ? 2 : 1;
      if (recent && recent.id !== shot.current.eventId && (now - shot.current.at > 6500 || (priority > shot.current.priority && now - shot.current.at > 3500))) {
        target.current.set((recent.from[0] + recent.to[0]) / 2 - world.width / 2, 0, (recent.from[1] + recent.to[1]) / 2 - world.height / 2);
        shot.current = { at: now, eventId: recent.id, priority };
      } else if (now - shot.current.at > 14000) {
        // Stable establishing shot around the real cast, or the real wreck when empty.
        const wreck = containers.find(c => c.kind === 'wreck');
        const x = agents.length ? agents.reduce((n, a) => n + a.x, 0) / agents.length : wreck?.x ?? world.width / 2;
        const y = agents.length ? agents.reduce((n, a) => n + a.y, 0) / agents.length : wreck?.y ?? world.height / 2;
        target.current.set(x - world.width / 2, 0, y - world.height / 2);
        shot.current.at = now; shot.current.priority = 0;
      }
    }
    offset.copy(target.current).sub(control.target).multiplyScalar(1 - Math.exp(-Math.min(delta, 0.1) * (following ? 2 : 0.65)));
    control.target.add(offset); camera.position.add(offset); control.update();
  });
  return <MapControls ref={controls} makeDefault enableRotate={false} enableDamping dampingFactor={0.08} minZoom={3} maxZoom={38} onStart={onExplore} />;
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
