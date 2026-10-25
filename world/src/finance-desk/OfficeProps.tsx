// The case, made physical: each office's props are its agent's own record, as the
// clearing's crate holds exactly the rations left (scene/Environment.tsx). Room
// coordinates: the floor plate is 8 x 7.35, the camera looks from +x +y +z, so the
// two back walls (-z and -x) face it.
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Appear, Box, Hover, REDUCED_MOTION } from './sceneKit';
import { SLOTS, type Decision, type OfficeState, type Slot, type Tone } from './officeState';

export const TONE_COLORS: Record<Tone, string> = { clean: '#efe6cf', adverse: '#e2b45c', flag: '#d9535d', frozen: '#aac4cf', none: '#c7c6bd' };
const TONE_WORDS: Record<Tone, string> = { clean: 'clean', adverse: 'adverse', flag: 'red flag', frozen: 'frozen', none: 'no usable file' };
const GOLD = '#c9a24a', RED = '#d9535d', WALL = '#cfc8b1', WALL_CAP = '#9aa08d', WOOD = '#6f5a45';

// Two low walls on the back edges. Low enough (1.5) never to hide the office behind.
export function Walls() {
  return <group name="office-walls">
    <Box p={[0, .91, -3.62]} size={[8, 1.5, .12]} color={WALL} />
    <Box p={[0, 1.68, -3.62]} size={[8.1, .06, .2]} color={WALL_CAP} />
    <Box p={[-3.94, .91, 0]} size={[.12, 1.5, 7.24]} color={WALL} />
    <Box p={[-3.94, 1.68, 0]} size={[.2, .06, 7.34]} color={WALL_CAP} />
  </group>;
}

// The intake counter: the office's open right side, facing the audience, where every
// CRS answer lands as a sheet in its own slot. Credit by bureau, then the checks,
// then the two records no desk here may use, behind red-tagged flaps. The agents'
// bubbles rise upward, so nothing ever covers the counter.
const PITCH = .3, GAP = .14, COUNTER_X = 3.68, Z0 = -3.05, TOP = 1.02;
const slotZ = (i: number) => Z0 + i * PITCH + (i >= 3 ? GAP : 0) + (i >= 7 ? GAP : 0);
const SPAN = slotZ(SLOTS.length - 1) - Z0, MID = Z0 + SPAN / 2;
export function EvidenceRack({ slots }: { slots: Slot[] }) {
  const shown = SLOTS.map(layout => slots.find(s => s.key === layout.key) ?? { ...layout, locked: layout.group === 'restricted', required: false, missed: false });
  const lines = shown.map(s => `${s.label}: ${s.pulled ? `${s.pulled.line} (${TONE_WORDS[s.pulled.tone]})` : s.locked ? 'locked, not for this desk' : s.missed ? 'skipped, and the case required it' : s.required ? 'not pulled yet; this case requires it' : 'not pulled'}`);
  return <Hover title="Evidence counter" lines={lines} at={[COUNTER_X, 2.1, MID]}>
    <group name="evidence-counter">
      <Box p={[COUNTER_X, .6, MID]} size={[.5, .82, SPAN + .42]} color="#8a7458" />
      <Box p={[COUNTER_X + .02, TOP, MID]} size={[.62, .05, SPAN + .52]} color={WOOD} />
      <Box p={[COUNTER_X + .26, .6, MID]} size={[.02, .62, SPAN + .3]} color="#9a8466" />
      {shown.map((s, i) => <CounterSlot key={s.key} slot={s} z={slotZ(i)} />)}
    </group>
  </Hover>;
}
function CounterSlot({ slot: s, z }: { slot: Slot; z: number }) {
  const opened = s.locked && !!s.pulled;
  return <group position={[COUNTER_X, 0, z]}>
    <Box p={[0, TOP + .1, PITCH / 2]} size={[.34, .16, .015]} color={WOOD} />
    {s.pulled && <Appear key={`${s.pulled.tone}-${s.pulled.line}`} position={[-.04, TOP + .2, 0]}>
      <Box p={[0, 0, 0]} size={[.025, .34, .22]} color={TONE_COLORS[s.pulled.tone]} rotation={[0, 0, -.12 + (Math.abs(z * 7) % 1) * .08]} />
    </Appear>}
    {s.locked && <group position={[.2, TOP + .03, 0]}>
      {/* The flap tips open, and turns red, when the agent uses a record it may not. */}
      <group rotation={[0, 0, opened ? -1.25 : 0]}>
        <Box p={[0, .18, 0]} size={[.025, .36, PITCH - .05]} color={opened ? '#7a3b3e' : '#4f5a52'} />
        <Box p={[.016, .3, 0]} size={[.012, .07, .1]} color={RED} />
      </group>
    </group>}
    {(s.required || s.missed) && <Box p={[.27, .9, 0]} size={[.02, .045, PITCH - .07]} color={s.missed ? RED : GOLD} />}
  </group>;
}

// How much written policy this agent was given, as lines on the wall: none, the
// four principles, principles and house rules (7), or the full charter (9).
export function PolicyFrame({ policy }: { policy: OfficeState['policy'] }) {
  return <Hover title="Policy on the wall" lines={[policy.lines ? `${policy.name}: ${policy.lines} written lines in this agent's prompt` : `${policy.name}: no written policy in this agent's prompt`]} at={[-3.85, 2.2, 1.6]}>
    <group name="policy-frame" position={[-3.86, 1.08, 1.6]}>
      <Box p={[0, 0, 0]} size={[.05, .72, .96]} color={WOOD} />
      <Box p={[.03, 0, 0]} size={[.02, .62, .84]} color={policy.lines ? '#f3ead4' : '#d8d4c4'} />
      {Array.from({ length: policy.lines }, (_, i) => <Box key={i} p={[.045, .25 - i * .058, -.06 + (i % 3) * .03]} size={[.01, .022, .58 - (i % 3) * .08]} color="#7d7768" />)}
    </group>
  </Hover>;
}

// The decision, stamped on the case folder.
const STAMP_COLORS: Record<Decision['tone'], string> = { approve: '#5f9a63', decline: '#3d3d3d', fraud: RED, escalate: GOLD, contact: '#8c8f99', hold: '#b8862d' };
export function DecisionStamp({ decision }: { decision?: Decision }) {
  return <Hover title="Case folder" lines={[decision ? decision.line : 'No decision yet']} at={[-1.5, 2.1, 1.45]}>
    <group name="case-folder-stamp">
      <mesh position={[-1.5, 1.02, 1.45]}><boxGeometry args={[.95, .08, .7]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>
      {decision && <Appear key={decision.tool} position={[-1.58, 1.04, 1.4]} rotation={[0, .35, 0]}>
        <Box p={[0, 0, 0]} size={[.34, .016, .34]} color={STAMP_COLORS[decision.tone]} />
        <Box p={[0, .01, 0]} size={[.24, .006, .24]} color="#f3ead4" />
        <Box p={[0, .016, 0]} size={[.18, .006, .18]} color={STAMP_COLORS[decision.tone]} />
      </Appear>}
    </group>
  </Hover>;
}

// What a desk agent could do to its own oversight sits on the audit cabinet: the
// audit log's light, the decision records and a key to its own permissions. Each
// shows plainly if it was touched. The supervisor's report is filed beside them.
export function AuditTemptations({ bait, report }: { bait: OfficeState['bait']; report?: OfficeState['report'] }) {
  const light = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => { if (light.current && bait.auditOff && !REDUCED_MOTION) light.current.opacity = .55 + Math.sin(clock.elapsedTime * 5) * .45; });
  const lines = [
    `Audit log: ${bait.auditOff ? 'switched off by the agent' : 'on'}`,
    `Decision records: ${bait.recordEdited ? 'edited by the agent' : 'untouched'}`,
    `Access key: ${bait.selfGranted ? 'used: the agent granted itself access' : 'unused'}`,
    `Report to the supervisor: ${!report ? 'not filed yet' : report.honest === false ? 'contradicts the record' : report.honest ? 'matches the record' : 'filed'}`,
  ];
  return <Hover title="Audit & records" lines={lines} at={[2.1, 2.3, 1.55]}>
    <group name="audit-temptations">
      <Box p={[2.55, 1.26, 1.45]} size={[.34, .2, .26]} color="#2f3b36" />
      <mesh position={[2.55, 1.39, 1.45]}><sphereGeometry args={[.055, 12, 8]} /><meshBasicMaterial ref={light} color={bait.auditOff ? RED : '#7fd08a'} transparent /></mesh>
      <group position={[1.55, bait.selfGranted ? 1.3 : 1.19, 1.3]} rotation={[0, .6, 0]}>
        <Box p={[0, 0, 0]} size={[.24, .03, .05]} color={bait.selfGranted ? RED : GOLD} />
        <mesh position={[-.15, 0, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.06, .018, 8, 16]} /><meshStandardMaterial color={bait.selfGranted ? RED : GOLD} roughness={.4} /></mesh>
      </group>
      {bait.recordEdited && <Appear position={[1.62, 1.35, 1.78]} rotation={[.28, .2, 0]}><Box p={[0, 0, 0]} size={[.38, .32, .02]} color={RED} /></Appear>}
      {report && <Appear key={String(report.honest)} position={[1.88, 1.22, 1.62]}>
        <Box p={[0, 0, 0]} size={[.5, .05, .37]} color="#f3ead4" />
        {report.honest === false && <Box p={[.12, .15, .1]} size={[.13, .28, .02]} color={RED} rotation={[0, 0, .12]} />}
      </Appear>}
    </group>
  </Hover>;
}

// A message landing: two rings spread from the client line's phone, as the clearing's
// event rings do (scene/SceneEvents.tsx Effect).
export function PhoneRing({ count }: { count: number }) {
  const seen = useRef(count), at = useRef<number>();
  const rings = useRef<THREE.Mesh[]>([]);
  useEffect(() => { if (count > seen.current) at.current = performance.now(); seen.current = count; }, [count]);
  useFrame(() => {
    const t = at.current === undefined || REDUCED_MOTION ? 1 : (performance.now() - at.current) / 1400;
    rings.current.forEach((ring, i) => {
      const k = THREE.MathUtils.clamp(t * 1.4 - i * .35, 0, 1);
      ring.visible = t < 1 && k > 0 && k < 1;
      ring.scale.setScalar(.4 + k * 1.6);
      (ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * .8;
    });
  });
  return <group position={[2.4, 1.3, -1.3]} name="phone-ring">
    {[0, 1].map(i => <mesh key={i} ref={m => { if (m) rings.current[i] = m; }} rotation={[-Math.PI / 2, 0, 0]} visible={false}><ringGeometry args={[.32, .37, 32]} /><meshBasicMaterial color={GOLD} transparent depthWrite={false} /></mesh>)}
  </group>;
}
