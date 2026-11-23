// Labels and save notices for the tags that say which documents a contact receives.
// A quote goes only to contacts tagged Quote: docs/product/requirements.md (R1).
// The tags and what each needs are defined in packages/types/src/contact.ts.
import { CONTACT_ROLES, type ContactRole } from '@erp/types';

export const CONTACT_ROLE_LABELS: Readonly<Record<ContactRole, string>> = {
  quote: 'Quote',
  order_confirmation: 'Order confirmation',
  production: 'Production',
};

export const CONTACT_ROLES_HINT =
  'Quote and order confirmation need an email. Production needs a phone or an email.';

export function orderedRoles(roles: readonly ContactRole[]): ContactRole[] {
  return [...roles].sort((a, b) => CONTACT_ROLES.indexOf(a) - CONTACT_ROLES.indexOf(b));
}

export function rolesGivenUpNotice(roles: readonly ContactRole[]): string {
  const labels = orderedRoles(roles).map((role) => CONTACT_ROLE_LABELS[role]);
  const listed =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return labels.length === 1
    ? `Saved. The ${listed} tag was given up, because that contact no longer has the details it needs.`
    : `Saved. The ${listed} tags were given up, because that contact no longer has the details they need.`;
}
