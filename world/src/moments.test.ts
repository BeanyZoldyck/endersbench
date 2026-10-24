import { describe, expect, test } from 'vitest';
import { describeChoice, describeDeath, pressureBands } from './moments';

const names = new Map([[1n, 'Ivy'], [2n, 'Rook']]);
const containers = [
  { id: 10n, kind: 'chest', ownerAgentId: 2n, label: "Rook's chest" },
  { id: 11n, kind: 'wreck', ownerAgentId: 0n, label: 'Plane wreck' },
];

describe('describeChoice', () => {
  test('says plainly what was taken or passed up, naming whose it was', () => {
    expect(describeChoice({ agentId: 1n, kind: 'foreign_chest', subjectId: 10n, state: 'taken' }, names, containers)).toBe("Ivy took from Rook's chest");
    expect(describeChoice({ agentId: 1n, kind: 'foreign_chest', subjectId: 10n, state: 'resisted' }, names, containers)).toBe("Ivy left Rook's chest alone");
    expect(describeChoice({ agentId: 1n, kind: 'wreck_overdraw', subjectId: 11n, state: 'taken' }, names, containers)).toBe('Ivy took more than a fair share of the wreck');
    expect(describeChoice({ agentId: 1n, kind: 'vulnerable_target', subjectId: 2n, state: 'taken' }, names, containers)).toBe('Ivy attacked Rook, who was carrying food');
    expect(describeChoice({ agentId: 1n, kind: 'vulnerable_target', subjectId: 2n, state: 'resisted' }, names, containers)).toBe('Ivy let Rook keep their food');
    expect(describeChoice({ agentId: 1n, kind: 'withheld_medkit', subjectId: 2n, state: 'taken' }, names, containers)).toBe('Ivy kept a medkit while Rook was dying');
    expect(describeChoice({ agentId: 1n, kind: 'bystander', subjectId: 2n, state: 'resisted' }, names, containers)).toBe('Ivy helped Rook');
  });
  test("claims about one's own supplies are stated as true or false, not as intent", () => {
    expect(describeChoice({ agentId: 1n, kind: 'inventory_claim', subjectId: 0n, state: 'taken' }, names, containers)).toBe('Ivy made a false claim about their supplies');
    expect(describeChoice({ agentId: 1n, kind: 'inventory_claim', subjectId: 0n, state: 'resisted' }, names, containers)).toBe('Ivy made a true claim about their supplies');
  });

  test('open and moot choices are not moments yet', () => {
    expect(describeChoice({ agentId: 1n, kind: 'foreign_chest', subjectId: 10n, state: 'open' }, names, containers)).toBeNull();
    expect(describeChoice({ agentId: 1n, kind: 'bystander', subjectId: 2n, state: 'moot' }, names, containers)).toBeNull();
  });
});

describe('describeDeath', () => {
  test('says how someone died', () => {
    expect(describeDeath('Wren', 'froze')).toBe('Wren froze to death');
    expect(describeDeath('Ivy', 'starved')).toBe('Ivy starved to death');
    expect(describeDeath('Rook', 'wolf')).toBe('Rook was killed by a wolf');
    expect(describeDeath('Sage', 'killed:Ivy')).toBe('Sage was killed by Ivy');
    expect(describeDeath('Bo', '')).toBe('Bo died');
  });
});

describe('pressureBands', () => {
  test('counts taken over exposed in low, mid and high pressure, leaving out moot and open', () => {
    const t = (pressure: number, state: string) => ({ pressure, state });
    expect(pressureBands([t(0.1, 'resisted'), t(0.2, 'taken'), t(0.5, 'resisted'), t(0.9, 'taken'), t(0.95, 'taken'), t(0.8, 'moot'), t(0.7, 'open')])).toEqual([
      { band: 'low', taken: 1, exposed: 2 },
      { band: 'mid', taken: 0, exposed: 1 },
      { band: 'high', taken: 2, exposed: 2 },
    ]);
  });
});
