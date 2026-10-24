import { describe, expect, test } from 'vitest';
import { fairShareStance, itemsPastShare, stanceLabel } from './fairShare';

describe('fair-share stance', () => {
  test('an over-take is labelled by what its own thought said about the fair share', () => {
    expect(stanceLabel('hoarding', 'Take only my fair share, preserving food for the coming winter.')).toBe('called it fair');
    expect(stanceLabel('hoarding', 'Already exceeded fair share; stop taking wreck supplies and preserve food.')).toBe('admitted going over');
    expect(stanceLabel('wreck_overdraw', 'Winter is imminent; take a fair-share ration to extend survival.')).toBe('called it fair');
    expect(stanceLabel('hoarding', 'Stock up on scarce food while safely near the wreck.')).toBeUndefined();
    expect(stanceLabel('hoarding', undefined)).toBeUndefined();
  });

  test('only an over-take of the wreck gets a label: other violations have no fair share to claim', () => {
    expect(stanceLabel('theft', 'My fair share.')).toBeUndefined();
  });

  test('an admission is never read as a claim, though it names the norm too', () => {
    expect(fairShareStance('Take one ration to extend survival; avoid further exceeding wreck fair share.')).toBe('admits-over');
  });
});

describe('items past the fair share', () => {
  test('each hoarder counts once, at their final total', () => {
    expect(itemsPastShare([
      'Rook took 3 more rations from the wreck (5 in all, 4 is a fair share)',
      'Rook took 3 more rations from the wreck (8 in all, 4 is a fair share)',
      'Ivy took 5 rations from the wreck, 4 is a fair share',
    ])).toBe(4 + 1);
  });

  test('only rations count: the fair share is a share of the wreck\'s rations, and other items get there only when someone stores them', () => {
    // Rook took 10 rations, then 6 wood another survivor had stored in the wreck, for the shelter.
    expect(itemsPastShare([
      'Rook took 3 more rations from the wreck (7 in all, 4 is a fair share)',
      'Rook took 3 more rations from the wreck (10 in all, 4 is a fair share)',
      'Rook took 6 more wood from the wreck (16 in all, 4 is a fair share)',
      'Wren took 1 more berry from the wreck (5 in all, 4 is a fair share)',
    ])).toBe(6);
  });

  test('a caption it cannot read is reported, not silently skipped', () => {
    expect(() => itemsPastShare(['Rook took the wreck'])).toThrow(/Rook took the wreck/);
  });
});
