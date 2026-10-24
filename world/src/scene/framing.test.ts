import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FOV, VIEW, baseDistance, defaultFrame, establishingTarget } from './framing';

// The module puts the crate 54 tiles from the centre, straight down the default
// view: world (+0.59, +0.81) from the centre, which is the scene's x/z too.
const crate = { x: 54 * 0.5878, z: 54 * 0.809 };
const ASPECTS = [1.5, 1.78, 1.91, 2.2];
const down = new THREE.Vector3(VIEW.x, 0, VIEW.z).normalize();

// Where a ground point lands on screen (NDC: -1 bottom, 1 top) for a frame.
function ndc(frame: { distance: number; shift: number }, aspect: number, point: THREE.Vector3, at?: { x: number; z: number }) {
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 1, 900);
  const target = at ? new THREE.Vector3(at.x, 0, at.z) : down.clone().multiplyScalar(frame.shift);
  camera.position.copy(target).addScaledVector(VIEW, frame.distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return point.clone().project(camera);
}

describe('default frame', () => {
  it('is the old framing when nothing is known of the crate', () => {
    for (const aspect of ASPECTS) expect(defaultFrame(aspect)).toEqual({ distance: baseDistance(aspect), shift: 0 });
  });

  it('shows the whole crate and a little ground around it at the bottom of the default view', () => {
    for (const aspect of ASPECTS) {
      const frame = defaultFrame(aspect, crate);
      const base = new THREE.Vector3(crate.x, 0, crate.z);
      // The near corner, the ground a few tiles beyond it, the top of the open lid, and both flanks.
      const points = [base.clone().addScaledVector(down, 2.2 + 3), base.clone().setY(3.6), base.clone().add(new THREE.Vector3(-2.2, 0, 2.2)), base.clone().add(new THREE.Vector3(2.2, 0, -2.2))];
      for (const p of points) {
        const s = ndc(frame, aspect, p);
        expect(s.y, `aspect ${aspect} y`).toBeGreaterThan(-0.97);
        expect(s.y).toBeLessThan(1);
        expect(Math.abs(s.x)).toBeLessThan(0.9);
      }
    }
  });

  it('keeps the clearing the focus: at most a slight enlargement, the centre and the far side of the clearing still in frame', () => {
    for (const aspect of ASPECTS) {
      const frame = defaultFrame(aspect, crate);
      expect(frame.distance).toBeGreaterThanOrEqual(baseDistance(aspect));
      expect(frame.distance).toBeLessThanOrEqual(baseDistance(aspect) * 1.15 + 1e-9);
      expect(frame.shift).toBeGreaterThanOrEqual(0);
      expect(frame.shift).toBeLessThanOrEqual(24);
      expect(Math.abs(ndc(frame, aspect, new THREE.Vector3(0, 0, 0)).y), `aspect ${aspect} centre`).toBeLessThan(0.45);
      // The shelter, a home on the far side of the ring, and the far edge of the open ground.
      for (const north of [0, 22, 50]) expect(ndc(frame, aspect, down.clone().multiplyScalar(-north)).y, `aspect ${aspect} north ${north}`).toBeLessThan(1);
    }
  });

  it('does not move a frame that already holds the crate', () => {
    const near = { x: 5, z: 7 };
    expect(defaultFrame(1.91, near)).toEqual({ distance: baseDistance(1.91), shift: 0 });
  });
});

describe('establishing target', () => {
  const side = new THREE.Vector3(-down.z, 0, down.x); // screen-right, along the ground
  const at = (along: number, across: number) => { const p = down.clone().multiplyScalar(along).addScaledVector(side, across); return { x: p.x, z: p.z }; };
  const along = (p: { x: number; z: number }) => p.x * down.x + p.z * down.z;
  const across = (p: { x: number; z: number }) => p.x * side.x + p.z * side.z;

  it('is the cast average when there is no crate to hold', () => {
    expect(establishingTarget({ x: 3, z: -9 }, 0)).toEqual({ x: 3, z: -9 });
  });
  it('never lets the cast pull the frame north of the one that holds the crate, nor sideways off the cast', () => {
    const frame = defaultFrame(1.78, crate);
    for (const [a, c] of [[-30, 0], [-10, 12], [0, -15], [frame.shift - 1, 5]]) {
      const t = establishingTarget(at(a, c), frame.shift);
      expect(along(t)).toBeCloseTo(frame.shift);
      expect(across(t)).toBeCloseTo(c);
    }
  });
  it('follows a cast that has wandered south of it', () => {
    const frame = defaultFrame(1.78, crate);
    const south = at(frame.shift + 9, 4);
    expect(establishingTarget(south, frame.shift)).toEqual(south);
  });
  it('keeps the crate in the default view wherever the cast has wandered', () => {
    for (const aspect of ASPECTS) {
      const frame = defaultFrame(aspect, crate);
      for (const a of [-40, -20, 0, 10, 30]) for (const c of [-20, 0, 20]) {
        const t = establishingTarget(at(a, c), frame.shift);
        const corner = new THREE.Vector3(crate.x, 0, crate.z).addScaledVector(down, 2.2 + 3);
        const s = ndc(frame, aspect, corner, t);
        expect(s.y, `aspect ${aspect} cast ${a},${c}`).toBeGreaterThan(-0.97);
        expect(Math.abs(s.x), `aspect ${aspect} cast ${a},${c} x`).toBeLessThan(1);
      }
    }
  });
});
