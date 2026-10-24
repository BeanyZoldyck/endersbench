import { useEffect, useMemo, useRef } from "react";
import {
  Canvas,
  useFrame,
  useThree,
} from "@react-three/fiber";
import { Html, MapControls } from "@react-three/drei";
import * as THREE from "three";
import type { Agent, Message, World, ResourceNode, Container, Item } from "../module_bindings/types.ts";

import { Environment } from "./Environment";

const SPEECH_MS = 5_000; // game ms a speech bubble stays up
const BODY_RADIUS = 1.5; // the body is a unit sphere scaled by this

export type SceneProps = {
  world: World;
  agents: readonly Agent[];
  messages: readonly Message[];
  thinking: Set<bigint>;
  nodes: readonly ResourceNode[];
  containers: readonly Container[];
  items: readonly Item[];
  meId?: bigint;
  onClickTile: (x: number, y: number) => void;
};

// World tiles (x right, y down) map to the ground plane (x, z), centred on the origin.
function toScene(world: World, x: number, y: number): [number, number] {
  return [x - world.width / 2, y - world.height / 2];
}

export function WorldScene(props: SceneProps) {
  const { world, agents, messages, thinking, meId } = props;

  const lastWords = useMemo(() => {
    const said = new Map<bigint, string>();
    const at = new Map<bigint, number>();
    for (const m of messages) {
      if (world.gameTimeMs - m.gameTimeMs > SPEECH_MS) continue;
      if ((at.get(m.fromAgentId) ?? -Infinity) < m.gameTimeMs) {
        at.set(m.fromAgentId, m.gameTimeMs);
        said.set(m.fromAgentId, m.text);
      }
    }
    return said;
  }, [messages, world.gameTimeMs]);

  return (
    <div className="world">
      <Canvas
        shadows
        orthographic
        dpr={[1, 1.5]}
        camera={{ position: [80, 95, 110], zoom: 10, near: 0.1, far: 1000 }}
      >
        <color attach="background" args={[world.phase === "winter" ? "#aabcc0" : "#a4ad91"]} />
        <fog attach="fog" args={[world.phase === "winter" ? "#aabcc0" : "#a4ad91", 115, 260]} />
        <hemisphereLight args={["#d9e5df", "#706650", 1.4]} />
        <directionalLight
          castShadow
          position={[-35, 28, 20]}
          color={world.phase === "winter" ? "#e3e6da" : "#ffe0a8"}
          intensity={2.1}
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-45}
          shadow-camera-right={45}
          shadow-camera-top={45}
          shadow-camera-bottom={-45}
          shadow-bias={-0.0005}
        />
        <FitCamera world={world} />
        <MapControls
          enableRotate={false}
          enableDamping
          minZoom={4}
          maxZoom={60}
        />
        <Environment world={world} nodes={props.nodes} containers={props.containers} items={props.items} agents={agents} onClickTile={props.onClickTile} />
        {agents
          .filter((a) => a.alive)
          .map((a) => (
            <Critter
              key={String(a.id)}
              agent={a}
              world={world}
              isMe={a.id === meId}
              thinking={thinking.has(a.id)}
              said={lastWords.get(a.id)}
            />
          ))}
      </Canvas>
    </div>
  );
}

// Zoom so the whole island fits the canvas; the player can zoom and pan after.
function FitCamera({ world }: { world: World }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    // The island's diagonal spans the screen width in an isometric view.
    const span = Math.max(world.width, world.height) * Math.SQRT2 * 0.8; // start a little zoomed in; wheel zooms, drag pans
    ortho.zoom = Math.min(size.width, size.height * 1.6) / span;
    ortho.lookAt(0, 0, 0);
    ortho.updateProjectionMatrix();
  }, [camera, size.width, size.height, world.width, world.height]);
  return null;
}

function Critter(props: {
  agent: Agent;
  world: World;
  isMe: boolean;
  thinking: boolean;
  said?: string;
}) {
  const { agent, world, isMe, thinking, said } = props;
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const latest = useRef(agent);
  latest.current = agent;
  const facing = useRef(0);
  const phase = useMemo(() => Number(agent.id % 97n) * 0.37, [agent.id]);

  useFrame((state, dt) => {
    const g = root.current;
    const b = body.current;
    if (!g || !b) return;
    const a = latest.current;
    const [tx, tz] = toScene(world, a.x, a.y);
    // Server positions arrive at 20 Hz; ease toward them every frame.
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 14);
    const dx = (tx - g.position.x) * k;
    const dz = (tz - g.position.z) * k;
    g.position.x += dx;
    g.position.z += dz;

    const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
    const moving = speed > 0.4;
    if (moving) facing.current = Math.atan2(dx, dz);
    let delta = facing.current - b.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    b.rotation.y += delta * Math.min(1, dt * 10);

    const t = state.clock.elapsedTime + phase;
    if (moving) {
      // Hop with squash and stretch.
      const hop = Math.abs(Math.sin(t * 9));
      b.position.y = BODY_RADIUS * (1 + hop * 0.4);
      const s = 1 + (hop < 0.15 ? -0.12 : 0.06);
      b.scale.set(BODY_RADIUS / Math.sqrt(s), BODY_RADIUS * s, BODY_RADIUS / Math.sqrt(s));
    } else {
      // Breathe.
      const s = 1 + Math.sin(t * 2.2) * 0.035;
      b.position.y = BODY_RADIUS * s;
      b.scale.set(BODY_RADIUS / Math.sqrt(s), BODY_RADIUS * s, BODY_RADIUS / Math.sqrt(s));
    }
  });

  const [sx, sz] = toScene(world, agent.x, agent.y);
  const [targetX, targetZ] = toScene(world, agent.targetX, agent.targetY);

  return (
    <>
      <group ref={root} position={[sx, 0, sz]}>
        <group ref={body}>
          <mesh castShadow>
            <sphereGeometry args={[1, 32, 32]} />
            <meshToonMaterial color={agent.color} />
          </mesh>
          {/* Eyes and cheeks sit on the front (+z) of the body. */}
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.34, 0.2, 0.84]}>
              <mesh>
                <sphereGeometry args={[0.24, 16, 16]} />
                <meshStandardMaterial color="#ffffff" roughness={0.3} />
              </mesh>
              <mesh position={[0, 0, 0.16]}>
                <sphereGeometry args={[0.12, 12, 12]} />
                <meshStandardMaterial color="#1b1b1b" roughness={0.2} />
              </mesh>
              <mesh position={[side * 0.2, -0.3, 0.02]} scale={[1, 0.6, 0.4]}>
                <sphereGeometry args={[0.13, 12, 12]} />
                <meshStandardMaterial
                  color="#ff8fa3"
                  transparent
                  opacity={0.85}
                />
              </mesh>
            </group>
          ))}
        </group>
        {isMe && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
            <ringGeometry args={[1.8, 2.1, 40]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        )}
        <Html
          position={[0, 3.8, 0]}
          center
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div className="tag-stack">
            {said ? (
              <div className="bubble">{said}</div>
            ) : thinking ? (
              <div className="bubble thinking">
                <span />
                <span />
                <span />
              </div>
            ) : null}
            <div className="nametag" style={{ borderColor: agent.color }}>
              {agent.name}
            </div>
          </div>
        </Html>
      </group>
      {agent.intentKind === "move_to" && (
        <TargetMarker x={targetX} z={targetZ} color={agent.color} />
      )}
    </>
  );
}

function TargetMarker({
  x,
  z,
  color,
}: {
  x: number;
  z: number;
  color: string;
}) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ring.current) return;
    const s = 1 + Math.sin(state.clock.elapsedTime * 4) * 0.12;
    ring.current.scale.set(s, s, s);
  });
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.03, z]}>
      <ringGeometry args={[0.35, 0.5, 24]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} />
    </mesh>
  );
}
