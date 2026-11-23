// Words for roles nobody holds. A role the system alerts, `NOTIFYING_ROLES` in packages/types/src/roles.ts,
// gets the stronger warning, because its alerts reach nobody.
import { NOTIFYING_ROLES, type ErpRole, type RoleHolders } from '@erp/types';

export function unfilledRoles(catalog: readonly RoleHolders[]): readonly ErpRole[] {
  return catalog.filter((entry) => entry.holders.length === 0).map((entry) => entry.role);
}

export function unfilledDutyRoles(catalog: readonly RoleHolders[]): readonly ErpRole[] {
  return unfilledRoles(catalog).filter((role) =>
    (NOTIFYING_ROLES as readonly ErpRole[]).includes(role),
  );
}

function nameRoles(roles: readonly ErpRole[]): string {
  if (roles.length <= 2) return roles.join(' and ');
  return `${roles.slice(0, -1).join(', ')} and ${roles[roles.length - 1] ?? ''}`;
}

export function unfilledSummary(catalog: readonly RoleHolders[]): string | undefined {
  const unfilled = unfilledRoles(catalog);
  if (unfilled.length === 0) return undefined;

  const duties = unfilledDutyRoles(catalog);
  const rest = unfilled.filter((role) => !duties.includes(role));

  const sentences: string[] = [];
  if (duties.length > 0) {
    const subject = duties.length === 1 ? 'that role receives' : 'those roles receive';
    const pronoun = duties.length === 1 ? 'it' : 'them';
    sentences.push(
      `Nobody holds ${nameRoles(duties)}, so the alerts ${subject} go nowhere. Grant ${pronoun} to somebody who should be told.`,
    );
  }
  if (rest.length > 0) {
    sentences.push(`Nobody holds ${nameRoles(rest)}.`);
  }
  return sentences.join(' ');
}

export function roleGapNote(entry: RoleHolders): string | undefined {
  if (entry.holders.length > 0) return undefined;
  return (NOTIFYING_ROLES as readonly ErpRole[]).includes(entry.role)
    ? 'Nobody holds this role, so its alerts are not delivered to anyone.'
    : 'Nobody holds this role.';
}
