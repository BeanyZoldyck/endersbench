// The default camera frame, pure so it is tested without a renderer. A low
// three-quarter view through a long lens: enough perspective for the hills,
// trees and wreck to read as solid, little enough that the far side of the
// clearing stays legible. The supply crate lies straight down the screen from
// the centre, near the bottom edge of the plain frame, so when the world says
// where it is the frame makes room for it.
import * as THREE from 'three';

export const FOV = 30;
export const VIEW = new THREE.Vector3(80, 82, 110).normalize();
export const MIN_DISTANCE = 18, MAX_DISTANCE = 260;

// Screen-down along the ground.
const DOWN = new THREE.Vector3(VIEW.x, 0, VIEW.z).normalize();
// Screen-right along the ground.
const ACROSS = new THREE.Vector3(DOWN.z, 0, -DOWN.x);
// Frame about 88 x 60 tiles around the target; perspective adds the far side for free.
export function baseDistance(aspect: number) {
  const half = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  return THREE.MathUtils.clamp(Math.max(44 / (half * aspect), 30 / half), MIN_DISTANCE, MAX_DISTANCE);
}

// The crate's near corner and the ground a few tiles past it must sit inside the
// bottom of the frame (a little under -1 in screen height).
const CRATE_REACH = 2.2, GROUND_BEYOND = 3, BOTTOM = -0.94;
// Perspective makes ground nearer the camera sprawl across the screen, so the
// crate, 62 tiles down the view, is well past the bottom of the plain frame
// (about 1.6 half-heights below the middle): it takes a good shift south.
const MAX_ZOOM_OUT = 1.15, MAX_SHIFT = 24;

// How far to stand back, and how far to shift the target south (tiles along the
// ground, screen-down), so the whole crate and some ground around it show at the
// bottom of the default view. `crate` is its scene x/z from the map centre. The
// cheapest frame that fits wins: a shift costs less than standing back, since the
// clearing should stay the focus. With no crate, the plain frame.
export function defaultFrame(aspect: number, crate?: { x: number; z: number }) {
  const base = baseDistance(aspect);
  if (!crate) return { distance: base, shift: 0 };
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 1, 900);
  const corner = new THREE.Vector3(crate.x, 0, crate.z).addScaledVector(DOWN, CRATE_REACH + GROUND_BEYOND);
  const lowest = (distance: number, shift: number) => {
    const target = DOWN.clone().multiplyScalar(shift);
    camera.position.copy(target).addScaledVector(VIEW, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return corner.clone().project(camera).y;
  };
  let best = { distance: base, shift: 0, cost: Infinity };
  for (let zoom = 1; zoom <= MAX_ZOOM_OUT + 1e-9; zoom += 0.01) {
    for (let shift = 0; shift <= MAX_SHIFT; shift += 0.5) {
      const distance = Math.min(MAX_DISTANCE, base * zoom);
      if (lowest(distance, shift) < BOTTOM) continue;
      const cost = shift + (zoom - 1) * 40;
      if (cost < best.cost) best = { distance, shift, cost };
      break; // a bigger shift at this zoom only costs more
    }
  }
  return best.cost === Infinity ? { distance: Math.min(MAX_DISTANCE, base * MAX_ZOOM_OUT), shift: MAX_SHIFT } : { distance: best.distance, shift: best.shift };
}

// Where the audience camera settles: on the cast, but never north of the target
// the default frame was fitted for (`shift` tiles south of the centre, along the
// ground), so a cast that has wandered north does not pull the crate out of the
// bottom of the view. Sideways it stays on the cast; a cast further south is
// followed. With no crate (no shift) it is just the cast.
//
// The crate sits off to one side of the view, so sideways the target follows the
// cast only while the crate stays within CRATE_SIDE_SLACK tiles of it.
export const CRATE_SIDE_SLACK = 26;
export function establishingTarget(cast: { x: number; z: number }, shift: number, crate?: { x: number; z: number }) {
  if (shift <= 0) return { x: cast.x, z: cast.z };
  const short = shift - (cast.x * DOWN.x + cast.z * DOWN.z);
  const t = short > 0 ? { x: cast.x + DOWN.x * short, z: cast.z + DOWN.z * short } : { x: cast.x, z: cast.z };
  if (!crate) return t;
  const across = (t.x - crate.x) * ACROSS.x + (t.z - crate.z) * ACROSS.z;
  const over = Math.abs(across) - CRATE_SIDE_SLACK;
  return over > 0 ? { x: t.x - ACROSS.x * Math.sign(across) * over, z: t.z - ACROSS.z * Math.sign(across) * over } : t;
}

// The far forest makes way for the crate. A decorative tree standing between
// the crate and the camera (anywhere outward along the view's ground direction,
// within CRATE_SIGHTLINE tiles of the line) is slid sideways out of that strip,
// to the side it stood on, and never into the playable circle (its canopy stays
// beyond radius + 9). Every other tree stays where it is.
export const CRATE_SIGHTLINE = 8;
export function clearOfCrateView(p: { x: number; z: number }, crate: { x: number; z: number } | undefined, radius: number) {
  if (!crate) return p;
  const dx = p.x - crate.x, dz = p.z - crate.z;
  const along = dx * DOWN.x + dz * DOWN.z, across = dx * ACROSS.x + dz * ACROSS.z;
  if (along <= 0 || Math.abs(across) >= CRATE_SIGHTLINE) return p;
  // Mirror it across the strip's nearer edge: |across| in [0, S) lands in (S, 2S].
  const step = (across < 0 ? -1 : 1) * 2 * (CRATE_SIGHTLINE - Math.abs(across));
  const moved = { x: p.x + ACROSS.x * step, z: p.z + ACROSS.z * step };
  const r = Math.hypot(moved.x, moved.z), floor = radius + 9;
  return r >= floor ? moved : { x: (moved.x / r) * floor, z: (moved.z / r) * floor };
}
