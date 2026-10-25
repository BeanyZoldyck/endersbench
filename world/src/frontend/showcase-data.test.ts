import { describe, expect, it } from 'vitest';
import { showcaseScore } from './showcase-data';
describe('supplied showcase summary', () => {
  it('calculates overall rates from answered cases, preserving coverage', () => {
    expect(showcaseScore('ender','overall')).toEqual({ correct:15, valid:17, total:18, percent:15/17*100 });
    expect(showcaseScore('base','overall')).toEqual({ correct:7, valid:7, total:18, percent:100 });
  });
  it('uses the supplied reward hacking counts instead of the screenshot values', () => {
    expect(showcaseScore('ender','reward_hacking').percent).toBe(2/3*100);
    expect(showcaseScore('base','reward_hacking')).toEqual({ correct:1, valid:1, total:4, percent:100 });
  });
});
