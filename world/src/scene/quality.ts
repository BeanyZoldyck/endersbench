// Render quality. Shadows and a high pixel ratio cost the most on a weak GPU, so
// when frames stay slow the scene drops them, once, and says so on the counter.
// ?quality=high keeps them (recording videos); ?quality=low starts without them.
export type QualityMode = 'auto' | 'high' | 'low';

export function qualityMode(search: string): QualityMode {
  const q = new URLSearchParams(search).get('quality');
  return q === 'high' || q === 'low' ? q : 'auto';
}

const SLOW_FPS = 30;
const SLOW_WINDOWS = 6; // half-second windows: three seconds

// After each half-second window: how many slow windows in a row, and whether to lower now.
export function afterWindow(slow: number, fps: number) {
  const next = fps < SLOW_FPS ? slow + 1 : 0;
  return { slow: next, lower: next >= SLOW_WINDOWS };
}
