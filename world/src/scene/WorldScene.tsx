import { useEffect, useMemo } from "react";
import {
  Canvas,
  useThree,
} from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import type { Agent, Message, World, ResourceNode, Container, Item } from "../module_bindings/types.ts";

import { Critter } from "./Critter";
import { Environment } from "./Environment";

const SPEECH_MS = 5_000; // game ms a speech bubble stays up

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

export function WorldScene(props: SceneProps) {
  const { world, agents, messages, meId } = props;

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
    return new Map([...said].sort((a, b) => (at.get(b[0]) ?? 0) - (at.get(a[0]) ?? 0)).slice(0, 2));
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
          .map((a) => (
            <Critter
              key={String(a.id)}
              agent={a}
              world={world}
              selected={a.id === meId}
              onSelect={() => {}}
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

