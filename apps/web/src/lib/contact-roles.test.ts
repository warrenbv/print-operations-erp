// Tests the contact tag labels and the notice a save shows when it gave tags up.
import { CONTACT_ROLES } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { CONTACT_ROLE_LABELS, orderedRoles, rolesGivenUpNotice } from './contact-roles';

describe('contact role labels', () => {
  it('names every role, so a new one cannot reach a screen unlabelled', () => {
    expect(Object.keys(CONTACT_ROLE_LABELS).sort()).toEqual([...CONTACT_ROLES].sort());
    expect(Object.values(CONTACT_ROLE_LABELS).every((label) => label.length > 0)).toBe(true);
  });

  it('reads them in declaration order whatever order they arrive in', () => {
    expect(orderedRoles(['production', 'quote', 'order_confirmation'])).toEqual([
      'quote',
      'order_confirmation',
      'production',
    ]);
  });
});

describe('the notice a save shows when it took tags away', () => {
  it('names one tag in the singular', () => {
    expect(rolesGivenUpNotice(['production'])).toBe(
      'Saved. The Production tag was given up, because that contact no longer has the details it needs.',
    );
  });

  it('lists several, in declaration order', () => {
    expect(rolesGivenUpNotice(['order_confirmation', 'quote'])).toBe(
      'Saved. The Quote and Order confirmation tags were given up, because that contact no longer has the details they need.',
    );
  });

  it('says nothing about issues, routes or columns', () => {
    expect(rolesGivenUpNotice([...CONTACT_ROLES])).not.toMatch(/#\d|contact_roles|PATCH/);
  });
});
