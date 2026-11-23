// Finds users who hold a role the system alerts but have no email address, so those alerts reach nobody.
// The alerted roles are `NOTIFYING_ROLES` in packages/types/src/roles.ts.
import { NOTIFYING_ROLES, type ErpRole } from '@erp/types';

export interface RoleHolder {
  username: string;
  email?: string;
  roles: readonly ErpRole[];
}

export function unreachableDuties(user: RoleHolder): readonly ErpRole[] {
  if (user.email !== undefined && user.email !== '') {
    return [];
  }
  return NOTIFYING_ROLES.filter((role) => user.roles.includes(role));
}

export function hasNotificationGap(user: RoleHolder): boolean {
  return unreachableDuties(user).length > 0;
}

export function gapMessage(user: RoleHolder): string | undefined {
  const duties = unreachableDuties(user);
  if (duties.length === 0) return undefined;
  const roles = duties.join(' and ');
  return `No email address on record, so this user receives no ${roles} alerts.`;
}

export function gapSummary(users: readonly RoleHolder[]): string | undefined {
  const affected = users.filter(hasNotificationGap);
  if (affected.length === 0) return undefined;
  const who =
    affected.length === 1
      ? `${affected[0]?.username ?? 'One user'} holds`
      : `${affected.length} users hold`;
  return `${who} a role that sends alerts but ${affected.length === 1 ? 'has' : 'have'} no email address on record, so those alerts go nowhere. Marked below.`;
}
