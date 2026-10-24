import { ROLES, type Role } from './rules';

const NOBODY: Role = { role: '', backstory: '', items: {}, woodGather: 1, berryGather: 1, food: 1, fuel: 1, speed: 1 };

export function roleFor(index: number): Role {
  return ROLES[index % ROLES.length];
}

export function skills(role: string): Role {
  return ROLES.find(r => r.role === role) ?? NOBODY;
}
