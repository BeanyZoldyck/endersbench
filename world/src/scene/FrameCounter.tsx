import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { afterWindow, qualityMode } from './quality';

// Frames per second, measured where the scene renders, written straight to a
// DOM node twice a second so the counter itself causes no React re-renders.
// With ?perf it also shows draw calls, triangles and how often the scene
// re-rendered (React) in that time: the evidence for where a frame goes.
export const PERF = new URLSearchParams(window.location.search).has('perf');
export const QUALITY = qualityMode(window.location.search);
export const sceneRenders = { count: 0 };

// Shadows off and pixel ratio 1: what a weak GPU can't afford.
function lowerQuality(gl: THREE.WebGLRenderer, scene: THREE.Scene, setDpr: (dpr: number) => void) {
  gl.shadowMap.enabled = false;
  scene.traverse(object => {
    const material = (object as THREE.Mesh).material;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true;
  });
  setDpr(1);
}

export function FrameCounter({ target }: { target: React.RefObject<HTMLSpanElement> }) {
  const gl = useThree(s => s.gl), scene = useThree(s => s.scene), setDpr = useThree(s => s.setDpr);
  const window_ = useRef({ start: performance.now(), frames: 0, worst: 0, last: performance.now(), renders: sceneRenders.count });
  const quality = useRef({ slow: 0, lowered: QUALITY === 'low' });
  useEffect(() => { if (QUALITY === 'low') lowerQuality(gl, scene, setDpr); }, [gl, scene, setDpr]);
  useFrame(() => {
    const now = performance.now(), w = window_.current;
    w.worst = Math.max(w.worst, now - w.last);
    w.last = now;
    w.frames++;
    const elapsed = now - w.start;
    if (elapsed < 500 || !target.current) return;
    const fps = (w.frames * 1000) / elapsed;
    const q = quality.current;
    if (QUALITY === 'auto' && !q.lowered) {
      const next = afterWindow(q.slow, fps);
      q.slow = next.slow;
      if (next.lower) { lowerQuality(gl, scene, setDpr); q.lowered = true; }
    }
    const info = gl.info.render;
    const note = q.lowered ? ' · low quality' : '';
    target.current.textContent = PERF
      ? `${fps.toFixed(0)} fps${note} · worst ${w.worst.toFixed(0)} ms · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ${(((sceneRenders.count - w.renders) * 1000) / elapsed).toFixed(0)} scene renders/s`
      : `${fps.toFixed(0)} fps${note}`;
    target.current.dataset.fps = fps.toFixed(1);
    window_.current = { start: now, frames: 0, worst: 0, last: now, renders: sceneRenders.count };
  });
  return null;
}
