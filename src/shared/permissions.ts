import type { Role } from './contracts.js';

export const capabilityRoles = {
  read: ['administrator', 'editor', 'viewer'],
  scenes: ['administrator', 'editor'],
  venues: ['administrator', 'editor'],
  inventory: ['administrator', 'editor'],
  exports: ['administrator', 'editor'],
  members: ['administrator'],
  branding: ['administrator'],
} as const satisfies Record<string, readonly Role[]>;
export type Capability = keyof typeof capabilityRoles;
export function can(role: Role, capability: Capability) {
  return (capabilityRoles[capability] as readonly Role[]).includes(role);
}
