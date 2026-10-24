import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Hazard, World } from '../module_bindings/types';
import { activeStorm, timeOfDay } from './contract';
import type { ReadGameTime } from './useGameClock';

export function Atmosphere({ world, hazards, readTime }: { world: World; hazards: readonly Hazard[]; readTime: ReadGameTime }) {
  const sun = useRef<THREE.DirectionalLight>(null), fill = useRef<THREE.HemisphereLight>(null);
  const { scene, gl } = useThree();
  const lastShadow = useRef(-Infinity);
  const palette = useMemo(() => ({ night: new THREE.Color('#485d76'), day: new THREE.Color(world.phase === 'winter' ? '#aabcc0' : '#a4ad91'), storm: new THREE.Color('#657983'), moon: new THREE.Color('#aec3dc'), sun: new THREE.Color('#ffe0a8'), dusk: new THREE.Color('#dfa57e'), sky: new THREE.Color('#d9e5df') }), [world.phase]);
  useFrame(() => {
    if (!sun.current || !fill.current) return;
    const ms = readTime(), day = timeOfDay(ms, world.dayLengthMs, world.dayOffsetMs);
    const elevation = -Math.cos(day * Math.PI * 2);
    const daylight = THREE.MathUtils.smoothstep(elevation, -0.15, 0.4);
    const storm = activeStorm(hazards, ms);
    (scene.background as THREE.Color).copy(palette.night).lerp(palette.day, daylight).lerp(palette.storm, storm ? 0.6 : 0);
    (scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color);
    fill.current.color.copy(palette.moon).lerp(palette.sky, daylight);
    fill.current.intensity = (0.85 + daylight * 0.45) * (storm ? 0.8 : 1);
    sun.current.color.copy(palette.moon).lerp(palette.dusk, Math.sin(daylight * Math.PI)).lerp(palette.sun, daylight);
    sun.current.intensity = (0.25 + daylight * (world.phase === 'winter' ? 1.25 : 1.8)) * (storm ? 0.5 : 1);
    sun.current.position.set(Math.sin(day * Math.PI * 2) * 40, 22 + Math.max(0, elevation) * 24, 20);
    if (Math.abs(ms - lastShadow.current) > 1000) { gl.shadowMap.needsUpdate = true; lastShadow.current = ms; }
  });
  return <>
    <color attach="background" args={['#a4ad91']} /><fog attach="fog" args={['#a4ad91', Math.max(0, world.radius - 6), world.radius + 36]} />
    <hemisphereLight ref={fill} args={['#d9e5df', '#706650', 1.3]} />
    <directionalLight ref={sun} castShadow position={[-35, 28, 20]} intensity={2}
      shadow-mapSize={[1024, 1024]} shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={60} shadow-camera-bottom={-60} shadow-camera-far={180} shadow-normalBias={0.08} shadow-bias={-0.0002} />
  </>;
}
