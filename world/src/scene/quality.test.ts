import { describe, expect, test } from 'vitest';
import { afterWindow, qualityMode } from './quality';

describe('render quality', () => {
  test('?quality=high or low forces it; otherwise it adapts', () => {
    expect(qualityMode('?quality=high')).toBe('high');
    expect(qualityMode('?replay=/demo/x.json.gz&quality=low')).toBe('low');
    expect(qualityMode('')).toBe('auto');
    expect(qualityMode('?quality=ultra')).toBe('auto');
  });

  test('three seconds of frames under 30 fps lowers the quality, once', () => {
    let slow = 0, lower = false;
    for (const fps of [25, 22, 28, 20, 24]) ({ slow, lower } = afterWindow(slow, fps));
    expect(lower).toBe(false);
    ({ slow, lower } = afterWindow(slow, 26));
    expect(lower).toBe(true);
  });

  test('a single fast window resets the count: a hiccup is not a slow machine', () => {
    let slow = 0, lower = false;
    for (const fps of [20, 20, 20, 20, 20, 55, 20]) ({ slow, lower } = afterWindow(slow, fps));
    expect(slow).toBe(1);
    expect(lower).toBe(false);
  });
});
