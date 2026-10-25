import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, MapControls, useTexture } from '@react-three/drei';
import type { OrbitControls as Controls } from 'three-stdlib';
import * as THREE from 'three';
import { faceTextures } from '../scene/faceTexture';
import { modelLogo } from '../scene/modelLogo';
import { suitTexture } from './suitTexture';
import { STATIONS, type Office } from './comparison';

export function OfficeScene({ offices, selected, onSelect, viewReset, alertIds = [] }: { offices: Office[]; selected: number; onSelect: (index: number) => void; viewReset: number; alertIds?: string[] }) {
  return <div className="office-canvas"><Canvas orthographic dpr={[1, 1.5]} camera={{ position: [26, 26.6, 26], zoom: 35, near: .1, far: 180 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
    <color attach="background" args={['#dce2d7']} />
    <fog attach="fog" args={['#dce2d7', 52, 105]} />
    <hemisphereLight args={['#fff8e8', '#738079', 2.0]} />
    <directionalLight position={[-12, 20, 15]} intensity={2.4} color="#fff0d4" />
    <directionalLight position={[12, 8, -10]} intensity={1.2} color="#d3e1e3" />
    <District offices={offices} selected={selected} onSelect={onSelect} viewReset={viewReset} alertIds={alertIds} />
  </Canvas></div>;
}
function District({ offices, selected, onSelect, viewReset, alertIds }: { offices: Office[]; selected: number; onSelect: (index: number) => void; viewReset: number; alertIds: string[] }) {
  const { camera, size } = useThree();
  const controls = useRef<Controls>(null);
  const columns = 2;
  const spacing = 11.5;
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    const target = new THREE.Vector3(0, .6, 0);
    // Equal X/Y/Z viewing angles give true isometric projection. Fit by zoom
    // instead of camera distance so every office retains the same scale.
    cam.zoom = Math.min(size.width / 30, size.height / 23);
    cam.position.copy(target).add(new THREE.Vector3(26, 26, 26));
    cam.lookAt(target); cam.updateProjectionMatrix();
    controls.current?.target.copy(target); controls.current?.update();
  }, [camera, size, viewReset]);
  return <>
    {offices.map((office, index) => <group key={office.id} name={`office-${index}`} position={[(index % columns - .5) * spacing, 0, (Math.floor(index / columns) - .5) * spacing]}>
      <OfficeRoom office={office} index={index} selected={selected === index} flagged={alertIds.includes(office.id)} onSelect={() => onSelect(index)} />
    </group>)}
    <MapControls ref={controls} makeDefault enableRotate={false} enableDamping dampingFactor={.1} minZoom={8} maxZoom={150} zoomToCursor />
  </>;
}
function Box({ p, size, color, roughness = .8 }: { p: [number, number, number]; size: [number, number, number]; color: string; roughness?: number }) {
  return <mesh position={p}><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={roughness} /></mesh>;
}
function OfficeRoom({ office, index, selected, flagged, onSelect }: { office: Office; index: number; selected: boolean; flagged: boolean; onSelect: () => void }) {
  return <group onClick={e => { if (e.delta > 4) return; e.stopPropagation(); onSelect(); }}>
    <Box p={[0, -.28, 0]} size={[8.15, .4, 7.5]} color="#869287" />
    <Box p={[0, 0, 0]} size={[8, .22, 7.35]} color="#b19b7d" />
    <Box p={[0, .13, 0]} size={[7.8, .06, 7.15]} color="#c5b595" />
    {Array.from({ length: 12 }, (_, i) => <Box key={i} p={[-3.5 + i * .64, .166, 0]} size={[.018, .008, 7.05]} color="#a58e6d" />)}
    <Box p={[0, .19, 1]} size={[6.7, .025, 3.7]} color={selected ? '#b2b9a3' : '#b9bba8'} />
    <Box p={[0, .21, 2.73]} size={[6.4, .01, .025]} color="#e3d7b8" />
    <Box p={[0, .26, 3.64]} size={[7.7, .22, .1]} color={selected ? '#af945e' : '#7e8476'} />
    <Research active={!!office.row && office.station === 'research'} />
    <Phone active={!!office.row && office.station === 'phone'} />
    <DecisionDesk active={!!office.row && office.station === 'decision'} color={office.color} />
    <AuditCabinet active={!!office.row && office.station === 'audit'} />
    <Plant p={[3.2, .2, -2.65]} />
    {!office.thought && <Html center position={[0, 4.1, -1.4]} zIndexRange={[5, 1]} style={{ pointerEvents: 'none' }}>
      <div className={`office-plaque ${selected ? 'selected' : ''}`}><span>0{index + 1} · {office.modelId ? office.name : 'Available office'}</span><small>{office.activity}</small></div>
    </Html>}
    {office.row && <Suspense fallback={null}><Banker office={office} onInspect={onSelect} flagged={flagged} /></Suspense>}
  </group>;
}
function Research({ active }: { active: boolean }) {
  return <Workstation name="research-workstation" position={[-2.15, 0, -1.25]} label="Research" active={active}><Desk width={2.3} />
    {[-.48, .48].map(x => <group key={x}><Box p={[x, 1.35, -.13]} size={[.86, .65, .1]} color="#263f3e" /><Box p={[x, 1.35, -.071]} size={[.73, .51, .02]} color={active ? '#91c7b4' : '#638981'} /><Box p={[x, 1.02, -.13]} size={[.06, .2, .06]} color="#364a43" />{[0, 1, 2].map(i => <Box key={i} p={[x - .15, 1.44 - i * .12, -.052]} size={[.32 + i * .08, .025, .01]} color="#bcd5bd" />)}</group>)}
    <Box p={[0, .98, .35]} size={[.95, .03, .25]} color="#788580" />
  </Workstation>;
}
function Desk({ width = 1.9 }: { width?: number }) {
  return <><Box p={[0, .91, 0]} size={[width, .12, 1]} color="#735c46" />{[-1, 1].map(s => <Box key={s} p={[s * (width / 2 - .13), .5, 0]} size={[.12, .8, .75]} color="#46564d" />)}</>;
}
function Phone({ active }: { active: boolean }) {
  return <Workstation name="phone-workstation" position={[2.1, 0, -1.25]} label="Client line" active={active}><Desk width={1.9} /><Box p={[-.3, 1.03, .1]} size={[.55, .12, .45]} color="#33443e" /><Box p={[-.3, 1.15, .04]} size={[.7, .12, .17]} color="#26382f" /><Box p={[.45, 1, .16]} size={[.44, .03, .5]} color="#f0e8d3" /></Workstation>;
}
function DecisionDesk({ active, color }: { active: boolean; color: string }) {
  return <Workstation name="decision-workstation" position={[-1.7, 0, 1.55]} label="Decisions" active={active}><Desk width={2.2} /><Box p={[-.2, .99, .1]} size={[.9, .05, .62]} color={color} /><Box p={[-.2, 1.02, .1]} size={[.72, .01, .53]} color="#fff3d7" /><Box p={[.65, 1, .12]} size={[.04, .03, .38]} color="#af8643" />
    <mesh position={[-.75, 1.3, -.25]}><cylinderGeometry args={[.025, .025, .64, 8]} /><meshStandardMaterial color="#ad8e52" /></mesh>
    <mesh position={[-.75, 1.6, -.25]} rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[.13, .35, 4, 10]} /><meshStandardMaterial color="#315c4c" /></mesh>
  </Workstation>;
}
function AuditCabinet({ active }: { active: boolean }) {
  return <Workstation name="audit-workstation" position={[2.1, 0, 1.55]} label="Audit & records" active={active}><group scale={[1, .7, 1]}><Box p={[0, .9, -.1]} size={[1.65, 1.5, .85]} color="#7e8b7e" />{[0, 1, 2].map(i => <group key={i}><Box p={[0, .43 + i * .45, .34]} size={[1.48, .36, .04]} color="#a4ad97" /><Box p={[0, .44 + i * .45, .38]} size={[.4, .055, .04]} color="#af9c67" /></group>)}<Box p={[.25, 1.69, -.08]} size={[.8, .09, .56]} color="#e7d8b4" /></group></Workstation>;
}
function Workstation({ name, position, label, active, children }: { name: string; position: [number, number, number]; label: string; active: boolean; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return <group name={name} position={position} rotation={[0, Math.PI, 0]}
    onPointerOver={e => { e.stopPropagation(); setHovered(true); }}
    onPointerOut={() => setHovered(false)}>
    {children}
    {hovered && <Html center position={[0, 2, 0]} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}><span className={`station-tag ${active ? 'active' : ''}`} role="tooltip">{active && <i />}{label}</span></Html>}
  </group>;
}
function Plant({ p }: { p: [number, number, number] }) {
  return <group position={p}><mesh position={[0, .23, 0]}><cylinderGeometry args={[.25, .18, .46, 12]} /><meshStandardMaterial color="#a58a6d" /></mesh>{[-.45, -.15, .15, .45].map((angle, i) => <mesh key={i} position={[Math.sin(angle * 4) * .18, .68 + i * .08, 0]} rotation={[0, angle * 4, angle]} scale={[.15, .55, .1]}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color={i % 2 ? '#6e8055' : '#869463'} /></mesh>)}</group>;
}
function Banker({ office, onInspect, flagged }: { office: Office; onInspect: () => void; flagged: boolean }) {
  const root = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null), feet = useRef<THREE.Group>(null);
  const logo = useRef<THREE.Sprite>(null), face = useRef<THREE.MeshBasicMaterial>(null);
  const texture = useTexture(modelLogo(office.modelId)); texture.colorSpace = THREE.SRGBColorSpace;
  const faces = useMemo(faceTextures, []);
  const suit = useMemo(() => suitTexture(office.color), [office.color]);
  useEffect(() => () => suit.dispose(), [suit]);
  const vectors = useMemo(() => ({ center: new THREE.Vector3(), direction: new THREE.Vector3(), front: new THREE.Vector3() }), []);
  const target = STATIONS[office.station];
  const walk = useRef(0), heading = useRef(0);
  const initial = useRef<[number, number, number]>([target.x, .2, target.z]);
  useFrame((state, delta) => {
    if (!root.current || !body.current || !logo.current) return;
    const dt = Math.min(delta, .1), dx = target.x - root.current.position.x, dz = target.z - root.current.position.z;
    const moving = Math.hypot(dx, dz) > .025;
    if (moving) {
      root.current.position.x = THREE.MathUtils.damp(root.current.position.x, target.x, 15, dt);
      root.current.position.z = THREE.MathUtils.damp(root.current.position.z, target.z, 15, dt);
      heading.current = Math.atan2(dx, dz); walk.current += dt * 24;
    } else {
      // Equipment is in front of the agent, toward the audience. At work,
      // face the equipment rather than tracking the spectator's camera.
      heading.current = 0;
    }
    const turn = heading.current - body.current.rotation.y;
    body.current.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 18);
    const breathing = Math.sin(state.clock.elapsedTime * 1.65 + Number(office.row?.id ?? 0n)) * .01;
    body.current.position.y = 1.03 + breathing + (moving ? Math.sin(walk.current) * .025 : 0);
    body.current.scale.set(.84, .84 * (1 + breathing), .84);
    if (feet.current) {
      feet.current.rotation.y = body.current.rotation.y;
      feet.current.children.forEach((foot, i) => { foot.position.z = moving ? Math.sin(walk.current + i * Math.PI) * .1 : 0; });
    }
    body.current.updateWorldMatrix(true, false); body.current.getWorldPosition(vectors.center);
    // Isometric view rays are parallel, including at the edge of the screen.
    // Keep each camera-facing logo on its sphere's projected center.
    state.camera.getWorldDirection(vectors.direction);
    vectors.front.copy(vectors.direction).multiplyScalar(-.89).add(vectors.center);
    logo.current.position.copy(body.current.worldToLocal(vectors.front));
    if (face.current) face.current.map = (state.clock.elapsedTime + Number(office.row?.id ?? 0n)) % 4.7 < .13 ? faces.blink : faces.open;
  });
  return <group ref={root} position={initial.current} name="sphere-banker">
    {flagged && <mesh name="observed-finding-ring" rotation={[-Math.PI / 2, 0, 0]} position={[0, .025, 0]}><ringGeometry args={[.93, 1.04, 40]} /><meshBasicMaterial color="#b66745" transparent opacity={.8} depthWrite={false} /></mesh>}
    {office.thought && <Html position={[0, 2.5, 0]} zIndexRange={[6, 5]}>
      <button className="banker-thought" onClick={e => { e.stopPropagation(); onInspect(); }} aria-label={`Read ${office.name}'s full explanation`}>
        <strong>{office.name}</strong>
        <span>{office.modelId.startsWith('script:') ? 'Scripted explanation' : 'Model-provided explanation'}</span>
        <q>{office.thought}</q>
      </button>
    </Html>}
    <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, .012, 0]}><circleGeometry args={[.78, 24]} /><meshBasicMaterial color="#33473a" transparent opacity={.14} depthWrite={false} /></mesh>
    <group ref={feet}>{[-1, 1].map(side => <mesh key={side} position={[side * .32, .13, 0]} scale={[.23, .13, .34]}><sphereGeometry args={[1, 16, 10]} /><meshStandardMaterial color="#27322e" roughness={.7} /></mesh>)}</group>
    <group ref={body} position={[0, 1.03, 0]} scale={.84}>
      <mesh name="suited-sphere"><sphereGeometry args={[1, 40, 32]} /><meshPhysicalMaterial map={suit} roughness={.35} clearcoat={.8} transparent opacity={.88} /></mesh>
      <sprite ref={logo} scale={[1.3, 1.3, 1]} name="banker-logo"><spriteMaterial map={texture} transparent depthWrite={false} /></sprite>
      <mesh renderOrder={2} name="banker-eyes"><sphereGeometry args={[1.008, 64, 48]} /><meshBasicMaterial ref={face} map={faces.open} transparent alphaTest={.005} depthWrite={false} /></mesh>
    </group>
  </group>;
}
