// Pure helpers for contact roles and the reach each role needs.
// A mail role (quote, order_confirmation) needs an email address. production needs an email
// address or a phone. The database holds the same rule in contact_roles_reachable_check:
// infra/db/migrations/crm/0000_baseline.sql.
import {
  CONTACT_ROLES,
  isMailContactRole,
  type ContactRole,
  type ContactRoleAssignment,
} from '@erp/types';

export type ContactReach = 'both' | 'email' | 'phone' | 'none';

/** The same derivation as the generated `contact_reach` column in modules/crm/src/data/schema.ts. */
export function reachOf(
  email: string | null | undefined,
  phone: string | null | undefined,
): ContactReach {
  const hasEmail = email !== null && email !== undefined;
  const hasPhone = phone !== null && phone !== undefined;
  if (hasEmail && hasPhone) return 'both';
  if (hasEmail) return 'email';
  if (hasPhone) return 'phone';
  return 'none';
}

export function supportsRole(reach: ContactReach, role: ContactRole): boolean {
  return isMailContactRole(role) ? reach === 'email' || reach === 'both' : reach !== 'none';
}

// Roles are listed in CONTACT_ROLES order so both adapters return them identically.
function sortRoles<T extends { role: ContactRole }>(assignments: readonly T[]): T[] {
  return [...assignments].sort(
    (a, b) => CONTACT_ROLES.indexOf(a.role) - CONTACT_ROLES.indexOf(b.role),
  );
}

export function sortRoleNames(roles: readonly ContactRole[]): ContactRole[] {
  return [...roles].sort((a, b) => CONTACT_ROLES.indexOf(a) - CONTACT_ROLES.indexOf(b));
}

export interface HeldRole {
  contactId: string;
  role: ContactRole;
  setBy: string;
  setAt: Date;
}

export function assignmentsFor(
  held: readonly HeldRole[],
  contactId: string,
): ContactRoleAssignment[] {
  return sortRoles(held.filter((row) => row.contactId === contactId)).map((row) => ({
    role: row.role,
    setBy: row.setBy,
    setAt: row.setAt.toISOString(),
  }));
}
