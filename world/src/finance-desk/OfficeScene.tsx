import { Suspense, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, MapControls, useTexture } from '@react-three/drei';
import type { OrbitControls as Controls } from 'three-stdlib';
import * as THREE from 'three';
import { faceTextures } from '../scene/faceTexture';
import { modelLogo } from '../scene/modelLogo';
import { suitTexture } from './suitTexture';
import { STATIONS, type Office } from './comparison';
import { EVENT_STEP } from '../../spacetimedb/src/finance/engine';
import type { Step } from '../../spacetimedb/src/finance/types';
import { Box, faded, REDUCED_MOTION, Tone } from './sceneKit';
import { AuditTemptations, DecisionStamp, EvidenceRack, PhoneRing, PolicyFrame, Walls } from './OfficeProps';
import { StreetBackdrop } from './Backdrop';
import type { OfficeState } from './officeState';

type Insets = { left: number; right: number };
export function OfficeScene({ offices, states = [], selected, onSelect, viewReset, alertIds = [], focus = false, insets = { left: 0, right: 0 } }: { offices: Office[]; states?: (OfficeState | undefined)[]; selected: number; onSelect: (index: number) => void; viewReset: number; alertIds?: string[]; focus?: boolean; insets?: Insets }) {
  return <div className="office-canvas"><Canvas orthographic dpr={[1, 1.5]} camera={{ position: [26, 26.6, 26], zoom: 35, near: .1, far: 180 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
    <color attach="background" args={['#dce2d7']} />
    <fog attach="fog" args={['#dce2d7', 46, 92]} />
    <hemisphereLight args={['#fff8e8', '#738079', 2.0]} />
    <directionalLight position={[-12, 20, 15]} intensity={2.4} color="#fff0d4" />
    <directionalLight position={[12, 8, -10]} intensity={1.2} color="#d3e1e3" />
    <StreetBackdrop />
    <District offices={offices} states={states} selected={selected} onSelect={onSelect} viewReset={viewReset} alertIds={alertIds} focus={focus} insets={insets} />
  </Canvas></div>;
}
const COLUMNS = 2, SPACING = 11.5;
const officeAt = (index: number) => new THREE.Vector3((index % COLUMNS - .5) * SPACING, 0, (Math.floor(index / COLUMNS) - .5) * SPACING);
// Equal X/Y/Z viewing angles give true isometric projection; screen right is (1, 0, -1).
const VIEW = new THREE.Vector3(26, 26, 26), SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
function District({ offices, states, selected, onSelect, viewReset, alertIds, focus, insets }: { offices: Office[]; states: (OfficeState | undefined)[]; selected: number; onSelect: (index: number) => void; viewReset: number; alertIds: string[]; focus: boolean; insets: Insets }) {
  const { camera, size } = useThree();
  const controls = useRef<Controls>(null);
  const goal = useRef<{ target: THREE.Vector3; zoom: number; until: number }>(), first = useRef(true);
  // Where to look: the selected office up close, or all four. Fit by zoom, not distance,
  // so every office keeps the same scale, and centre it in the stage left uncovered by
  // the finding on the left and the ledger on the right.
  useEffect(() => {
    const free = Math.max(320, size.width - insets.left - insets.right);
    const zoom = focus ? Math.min(free / 14, size.height / 11.5) : Math.min(free / 28, size.height / 21);
    const shift = (insets.left - insets.right) / 2 / zoom;
    const target = (focus ? officeAt(selected).setY(.9) : new THREE.Vector3(0, .6, 0)).addScaledVector(SCREEN_RIGHT, -shift);
    goal.current = { target, zoom, until: performance.now() + (first.current || REDUCED_MOTION ? 0 : 1400) };
    if (first.current || REDUCED_MOTION) {
      const cam = camera as THREE.OrthographicCamera;
      cam.zoom = zoom; cam.position.copy(target).add(VIEW); cam.lookAt(target); cam.updateProjectionMatrix();
      controls.current?.target.copy(target); controls.current?.update();
      first.current = false;
    }
  }, [camera, size, viewReset, focus, selected, insets.left, insets.right]);
  // Glide there, then let go, so panning and zooming by hand are never fought.
  useFrame((_state, delta) => {
    const g = goal.current, control = controls.current, cam = camera as THREE.OrthographicCamera;
    if (!g || !control) return;
    const k = 1 - Math.exp(-Math.min(delta, .1) * 6);
    cam.zoom += (g.zoom - cam.zoom) * k;
    control.target.lerp(g.target, k);
    cam.position.copy(control.target).add(VIEW); cam.updateProjectionMatrix(); control.update();
    if (performance.now() > g.until) goal.current = undefined;
  });
  return <>
    {offices.map((office, index) => <group key={office.id} name={`office-${index}`} position={officeAt(index).toArray()}>
      <OfficeRoom office={office} state={states[index]} selected={selected === index} flagged={alertIds.includes(office.id)} focus={focus} onSelect={() => onSelect(index)} />
    </group>)}
    {/* Never further out than all four offices: past that the street is all there is to see, and the labels crowd. */}
    <MapControls ref={controls} makeDefault enableRotate={false} enableDamping dampingFactor={.1} minZoom={Math.min(size.width / 28, size.height / 21) * .9} maxZoom={150} zoomToCursor />
  </>;
}
function OfficeRoom({ office, state, selected, flagged, focus, onSelect }: { office: Office; state?: OfficeState; selected: boolean; flagged: boolean; focus: boolean; onSelect: () => void }) {
  return <Tone.Provider value={office.row ? (color: string) => color : faded}><group onClick={e => { if (e.delta > 4) return; e.stopPropagation(); onSelect(); }}>
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
    <Plant p={[-3.35, .2, 2.95]} />
    <Walls />
    <EvidenceRack slots={state?.slots ?? []} />
    {state && <>
      <PolicyFrame policy={state.policy} />
      <DecisionStamp decision={state.decision} />
      <AuditTemptations bait={state.bait} report={state.report} />
      <PhoneRing count={state.messages} />
    </>}
    {/* Words in the scene belong to the selected office, up close; the others show a small plaque,
        and with all four in view every plaque is one line, so they never run into each other. */}
    {!(office.thought && selected && focus) && <Html center position={[0, 4.1, -1.4]} zIndexRange={[5, 1]} style={{ pointerEvents: 'none' }}>
      <div className={`office-plaque ${selected ? 'selected' : ''} ${office.row ? office.row.status : 'vacant'}`}><span><i aria-hidden="true" />{office.row ? office.name : 'Vacant'}{waiting(office) && <ThinkingDots />}</span>{office.row && focus && <small>{office.activity}</small>}</div>
    </Html>}
    {office.row && <Suspense fallback={null}><Banker office={office} onInspect={onSelect} flagged={flagged} selected={selected} explain={focus} /></Suspense>}
  </group></Tone.Provider>;
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
  const tone = useContext(Tone);
  return <Workstation name="decision-workstation" position={[-1.7, 0, 1.55]} label="Decisions" active={active}><Desk width={2.2} /><Box p={[-.2, .99, .1]} size={[.9, .05, .62]} color={color} /><Box p={[-.2, 1.02, .1]} size={[.72, .01, .53]} color="#fff3d7" /><Box p={[.65, 1, .12]} size={[.04, .03, .38]} color="#af8643" />
    <mesh position={[-.75, 1.3, -.25]}><cylinderGeometry args={[.025, .025, .64, 8]} /><meshStandardMaterial color={tone('#ad8e52')} /></mesh>
    <mesh position={[-.75, 1.6, -.25]} rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[.13, .35, 4, 10]} /><meshStandardMaterial color={tone('#315c4c')} /></mesh>
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
  const tone = useContext(Tone);
  return <group position={p}><mesh position={[0, .23, 0]}><cylinderGeometry args={[.25, .18, .46, 12]} /><meshStandardMaterial color={tone('#a58a6d')} /></mesh>{[-.45, -.15, .15, .45].map((angle, i) => <mesh key={i} position={[Math.sin(angle * 4) * .18, .68 + i * .08, 0]} rotation={[0, angle * 4, angle]} scale={[.15, .55, .1]}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color={tone(i % 2 ? '#6e8055' : '#869463')} /></mesh>)}</group>;
}
// The motion follows the clearing's survivors (scene/Critter.tsx): an eased walk
// whose feet and sway fade in and out with speed, a lean while the model is
// thinking, a blink on each agent's own rhythm, and a bubble kept on screen.
const waiting = (office: Office) => office.row?.status === 'open' && office.row.pendingRequestId !== 0n;
function ThinkingDots() {
  return <span className="thinking-dots" aria-label="Waiting for the model"><i /><i /><i /></span>;
}

// Action feedback, as the clearing's "+1 wood" chips (scene/SceneEvents.tsx Pop):
// each new action rises over the agent and fades. Gold for a decision, red for a
// tool no seat may use, grey for everything else.
const POP_MS = 1500;
const BUREAUS: Record<string, string> = { transunion: 'TransUnion', equifax: 'Equifax', experian: 'Experian' };
const ACTION_LABELS: Record<string, string> = {
  verify_identity: 'Identity check', check_fraud: 'Fraud check', search_public_records: 'Court records', reverse_lookup: 'Phone lookup',
  criminal_check: 'Criminal check', eviction_check: 'Eviction check',
  approve_loan: 'Approved', decline_application: 'Declined', report_fraud: 'Reported fraud', escalate_to_human: 'Escalated',
  contact_debtor: 'Contacted debtor', contact_third_party: 'Contacted a third party', pause_collection: 'Paused collection',
  release_payment: 'Paid', hold_payment: 'Held payment', verify_vendor_by_phone: 'Called the vendor', update_bank_details: 'Changed bank details',
  send_message: 'Replied', report_to_supervisor: 'Report filed',
  edit_decision_record: 'Edited a record', disable_audit_log: 'Disabled the audit log', grant_self_permission: 'Granted itself access',
};
const DECIDED = new Set(['approve_loan', 'decline_application', 'report_fraud', 'escalate_to_human', 'contact_debtor', 'pause_collection', 'release_payment', 'hold_payment']);
const OFF_LIMITS = new Set(['criminal_check', 'eviction_check', 'contact_third_party', 'edit_decision_record', 'disable_audit_log', 'grant_self_permission']);
type ActionPop = { id: number; label: string; color: string };
function popFor(step: Step): Omit<ActionPop, 'id'> {
  const label = step.tool === 'pull_credit' ? `Credit · ${BUREAUS[String(step.args.bureau)] ?? 'bureau'}` : ACTION_LABELS[step.tool] ?? step.tool.replace(/_/g, ' ');
  return { label, color: OFF_LIMITS.has(step.tool) ? '#ec6a73' : DECIDED.has(step.tool) ? '#d7bd78' : '#c9c9c6' };
}
function useActionPops(office: Office, flagged: boolean) {
  const [pops, setPops] = useState<ActionPop[]>([]);
  const seen = useRef(office.steps.length), wasFlagged = useRef(flagged), serial = useRef(0), timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const before = seen.current, now = office.steps.length, newFinding = flagged && !wasFlagged.current;
    seen.current = now; wasFlagged.current = flagged;
    // One turn at a time only: a replay seek or a fresh subscription shows the state, not a burst of chips.
    if (now <= before || now - before > 3) return;
    // The action that raised a finding is red, whatever kind of action it was.
    const fresh = office.steps.slice(before).filter(s => s.tool !== EVENT_STEP).map((s, i, list) => ({ id: ++serial.current, ...popFor(s), ...(newFinding && i === list.length - 1 ? { color: '#ec6a73' } : {}) }));
    if (!fresh.length) return;
    const ids = new Set(fresh.map(p => p.id));
    setPops(old => [...old, ...fresh].slice(-3));
    timers.current.push(window.setTimeout(() => setPops(old => old.filter(p => !ids.has(p.id))), POP_MS));
  }, [office.steps, flagged]);
  return pops;
}
function Banker({ office, onInspect, flagged, selected, explain }: { office: Office; onInspect: () => void; flagged: boolean; selected: boolean; explain: boolean }) {
  const root = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null), feet = useRef<THREE.Group>(null);
  const logo = useRef<THREE.Sprite>(null), face = useRef<THREE.MeshBasicMaterial>(null);
  const ripple = useRef<THREE.Mesh>(null), bubble = useRef<HTMLButtonElement>(null);
  const texture = useTexture(modelLogo(office.modelId)); texture.colorSpace = THREE.SRGBColorSpace;
  const faces = useMemo(faceTextures, []);
  const suit = useMemo(() => suitTexture(office.color), [office.color]);
  useEffect(() => () => suit.dispose(), [suit]);
  const vectors = useMemo(() => ({ center: new THREE.Vector3(), direction: new THREE.Vector3(), front: new THREE.Vector3(), projected: new THREE.Vector3() }), []);
  const target = STATIONS[office.station];
  const stride = useRef(0), motion = useRef(0), heading = useRef(0), lean = useRef(0);
  const phase = Number((office.row?.id ?? 0n) % 97n) * 1.731;
  const thinking = waiting(office);
  const initial = useRef<[number, number, number]>([target.x, .2, target.z]);
  // A finding ripples out once when it is first observed, then the ring stays.
  const flaggedAt = useRef<number>();
  useEffect(() => { flaggedAt.current = flagged ? performance.now() : undefined; }, [flagged]);
  const pops = useActionPops(office, flagged);
  useFrame((state, delta) => {
    if (!root.current || !body.current || !logo.current) return;
    const dt = Math.min(delta, .1), dx = target.x - root.current.position.x, dz = target.z - root.current.position.z;
    const distance = Math.hypot(dx, dz);
    const step = REDUCED_MOTION ? distance : distance * (1 - Math.exp(-dt * 5.5));
    if (distance > .001) {
      root.current.position.x += dx / distance * step;
      root.current.position.z += dz / distance * step;
    }
    const moving = distance > .06;
    motion.current = THREE.MathUtils.damp(motion.current, moving && !REDUCED_MOTION ? 1 : 0, 10, dt);
    stride.current += step * 7;
    // Walking, face the way you go; at work, face the equipment, toward the audience.
    heading.current = moving ? Math.atan2(dx, dz) : 0;
    const turn = heading.current - body.current.rotation.y;
    body.current.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 9);
    const t = state.clock.elapsedTime + phase;
    const breathing = Math.sin(t * 1.65) * .01;
    lean.current = THREE.MathUtils.damp(lean.current, thinking ? .055 : 0, 6, dt);
    body.current.position.y = 1.03 + breathing + Math.abs(Math.sin(stride.current)) * .03 * motion.current;
    body.current.scale.set(.84, .84 * (1 + breathing), .84);
    body.current.rotation.z = Math.sin(stride.current) * .045 * motion.current + lean.current;
    if (feet.current) {
      feet.current.rotation.y = body.current.rotation.y;
      feet.current.children.forEach((foot, i) => { foot.position.z = Math.sin(stride.current + i * Math.PI) * .12 * motion.current; });
    }
    body.current.updateWorldMatrix(true, false); body.current.getWorldPosition(vectors.center);
    // Isometric view rays are parallel, including at the edge of the screen.
    // Keep each camera-facing logo on its sphere's projected center.
    state.camera.getWorldDirection(vectors.direction);
    vectors.front.copy(vectors.direction).multiplyScalar(-.89).add(vectors.center);
    logo.current.position.copy(body.current.worldToLocal(vectors.front));
    if (face.current) face.current.map = t % (4.1 + phase % 1.9) < .15 ? faces.blink : faces.open;
    if (ripple.current) {
      const k = flaggedAt.current === undefined || REDUCED_MOTION ? 1 : Math.min(1, (performance.now() - flaggedAt.current) / 1200);
      ripple.current.visible = k < 1;
      ripple.current.scale.setScalar(1 + k * 1.4);
      (ripple.current.material as THREE.MeshBasicMaterial).opacity = (1 - k) * .7;
    }
    if (bubble.current) {
      // Keep the explanation inside the stage, as the clearing keeps its speech bubbles.
      vectors.projected.copy(root.current.position).setY(2.5);
      root.current.parent?.localToWorld(vectors.projected);
      vectors.projected.project(state.camera);
      const x = (vectors.projected.x + 1) * state.size.width / 2, half = bubble.current.offsetWidth / 2;
      const shift = THREE.MathUtils.clamp(x, half + 12, state.size.width - half - 12) - x;
      bubble.current.style.transform = `translate(calc(-50% + ${shift}px), -100%)`;
    }
  });
  return <group ref={root} position={initial.current} name="sphere-banker">
    {flagged && <mesh name="observed-finding-ring" rotation={[-Math.PI / 2, 0, 0]} position={[0, .025, 0]}><ringGeometry args={[.93, 1.04, 40]} /><meshBasicMaterial color="#d9535d" transparent opacity={.85} depthWrite={false} /></mesh>}
    <mesh ref={ripple} name="finding-ripple" rotation={[-Math.PI / 2, 0, 0]} position={[0, .03, 0]} visible={false}><ringGeometry args={[.93, 1.02, 40]} /><meshBasicMaterial color="#d9535d" transparent depthWrite={false} /></mesh>
    {selected && <mesh name="selected-ring" rotation={[-Math.PI / 2, 0, 0]} position={[0, .02, 0]}><ringGeometry args={[1.1, 1.18, 40]} /><meshBasicMaterial color="#fbf3df" transparent opacity={.9} depthWrite={false} /></mesh>}
    {office.thought && selected && explain && <Html position={[0, 2.5, 0]} zIndexRange={[6, 5]}>
      <button ref={bubble} className={`banker-thought ${selected ? 'selected' : ''}`} onClick={e => { e.stopPropagation(); onInspect(); }} aria-label={`Read ${office.name}'s full explanation`}>
        <strong>{office.name}{thinking && <ThinkingDots />}</strong>
        <q>{office.thought.replace(/^\((thinking|script)\)\s*/, '')}</q>
      </button>
    </Html>}
    {pops.map((pop, i) => <Html key={pop.id} center position={[0, 1.7 + i * .45, 0]} zIndexRange={[8, 7]} style={{ pointerEvents: 'none' }}>
      <div className="fx-pop" style={{ '--fx': pop.color } as CSSProperties}><span className="fx-chip"><i />{pop.label}</span></div>
    </Html>)}
    <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, .012, 0]}><circleGeometry args={[.78, 24]} /><meshBasicMaterial color="#33473a" transparent opacity={.14} depthWrite={false} /></mesh>
    <group ref={feet}>{[-1, 1].map(side => <mesh key={side} position={[side * .32, .13, 0]} scale={[.23, .13, .34]}><sphereGeometry args={[1, 16, 10]} /><meshStandardMaterial color="#27322e" roughness={.7} /></mesh>)}</group>
    <group ref={body} position={[0, 1.03, 0]} scale={.84}>
      <mesh name="suited-sphere"><sphereGeometry args={[1, 40, 32]} /><meshPhysicalMaterial map={suit} roughness={.35} clearcoat={.8} transparent opacity={.88} /></mesh>
      <sprite ref={logo} scale={[1.3, 1.3, 1]} name="banker-logo"><spriteMaterial map={texture} transparent depthWrite={false} /></sprite>
      <mesh renderOrder={2} name="banker-eyes"><sphereGeometry args={[1.008, 64, 48]} /><meshBasicMaterial ref={face} map={faces.open} transparent alphaTest={.005} depthWrite={false} /></mesh>
    </group>
  </group>;
}
