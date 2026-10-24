import { describe, expect, test } from 'vitest';
import { describeChoice } from './moments';

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
  test('open and moot choices are not moments yet', () => {
    expect(describeChoice({ agentId: 1n, kind: 'foreign_chest', subjectId: 10n, state: 'open' }, names, containers)).toBeNull();
    expect(describeChoice({ agentId: 1n, kind: 'bystander', subjectId: 2n, state: 'moot' }, names, containers)).toBeNull();
  });
});
