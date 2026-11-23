// Tests for contact tags, the contact update and recipient selection: docs/product/requirements.md (R1).
import { describe, expect, it } from 'vitest';

import {
  CONTACT_NEEDS_NAME_OR_EMAIL,
  CONTACT_ROLES,
  MAIL_CONTACT_ROLES,
  contactLabel,
  contactRoleAssignmentSchema,
  contactRoleSchema,
  contactSchema,
  createContactRequestSchema,
  isMailContactRole,
  recipientAddressesFor,
  updateContactRequestSchema,
  updateContactResponseSchema,
  type Contact,
  type ContactRole,
} from '../src/contact';

describe('the closed list of contact roles', () => {
  it('is exactly the role names this edition keeps', () => {
    expect([...CONTACT_ROLES]).toEqual(['quote', 'order_confirmation', 'production']);
  });

  it('refuses anything else', () => {
    expect(contactRoleSchema.safeParse('shipping').success).toBe(false);
    expect(contactRoleSchema.safeParse('Quote').success).toBe(false);
  });

  it('names the two that mail, and production is not one of them', () => {
    expect([...MAIL_CONTACT_ROLES]).toEqual(['quote', 'order_confirmation']);
    expect(isMailContactRole('production')).toBe(false);
    expect(MAIL_CONTACT_ROLES.every((role) => CONTACT_ROLES.includes(role))).toBe(true);
  });
});

describe('a role assignment', () => {
  it('carries the role, who set it and when, all required', () => {
    const parsed = contactRoleAssignmentSchema.safeParse({
      role: 'order_confirmation',
      setBy: 'dev-sales',
      setAt: '2026-09-21T16:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a blank actor, the rule contact_roles_set_by_check holds in SQL', () => {
    expect(
      contactRoleAssignmentSchema.safeParse({
        role: 'order_confirmation',
        setBy: '   ',
        setAt: '2026-09-21T16:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('has no provenance to omit - both fields are always present', () => {
    expect(
      contactRoleAssignmentSchema.safeParse({ role: 'order_confirmation', setBy: 'dev-sales' })
        .success,
    ).toBe(false);
  });
});

describe('the contact PATCH', () => {
  it('takes role NAMES, because the service stamps the provenance', () => {
    const parsed = updateContactRequestSchema.safeParse({
      roles: ['quote', 'production'],
      lockVersion: 1,
    });
    expect(parsed.success && parsed.data.roles).toEqual(['quote', 'production']);
  });

  it('tells an absent role set from an empty one', () => {
    const absent = updateContactRequestSchema.safeParse({ lockVersion: 1 });
    expect(absent.success && absent.data.roles).toBeUndefined();
    const empty = updateContactRequestSchema.safeParse({ roles: [], lockVersion: 1 });
    expect(empty.success && empty.data.roles).toEqual([]);
  });

  it('answers with the contact plus the roles the save took away', () => {
    const parsed = updateContactResponseSchema.safeParse({
      id: 'c1',
      customerId: 'cu1',
      name: 'Jane',
      phone: '555-0173',
      createdAt: '2026-09-21T16:00:00.000Z',
      updatedAt: '2026-09-21T16:00:00.000Z',
      lockVersion: 2,
      roles: [],
      rolesGivenUp: ['quote', 'order_confirmation'],
    });
    expect(parsed.success && parsed.data.rolesGivenUp).toEqual(['quote', 'order_confirmation']);
  });
});

describe('recipientAddressesFor', () => {
  const contact = (
    id: string,
    email: string | undefined,
    roles: readonly ContactRole[],
  ): Contact => ({
    id,
    customerId: 'cu1',
    name: id,
    ...(email === undefined ? {} : { email }),
    createdAt: '2026-09-21T16:00:00.000Z',
    updatedAt: '2026-09-21T16:00:00.000Z',
    lockVersion: 1,
    roles: roles.map((role) => ({ role, setBy: 'dev-sales', setAt: '2026-09-21T16:00:00.000Z' })),
  });

  it('answers everyone tagged for the role, not just the first', () => {
    expect(
      recipientAddressesFor(
        [
          contact('buyer', 'Buyer@example.test', ['quote']),
          contact('clerk', 'ap@example.test', ['quote', 'order_confirmation']),
        ],
        'quote',
      ),
    ).toEqual(['ap@example.test', 'buyer@example.test']);
  });

  it('ignores contacts tagged for a different document', () => {
    expect(
      recipientAddressesFor([contact('clerk', 'ap@example.test', ['order_confirmation'])], 'quote'),
    ).toEqual([]);
  });

  it('treats two spellings of one mailbox as one recipient', () => {
    expect(
      recipientAddressesFor(
        [
          contact('pat', 'Pat@example.test', ['order_confirmation']),
          contact('patricia', 'pat@example.test', ['order_confirmation']),
        ],
        'order_confirmation',
      ),
    ).toEqual(['pat@example.test']);
  });

  it('is sorted, so the screen and the To line agree on an order', () => {
    expect(
      recipientAddressesFor(
        [
          contact('z', 'zoe@example.test', ['order_confirmation']),
          contact('a', 'abe@example.test', ['order_confirmation']),
        ],
        'order_confirmation',
      ),
    ).toEqual(['abe@example.test', 'zoe@example.test']);
  });

  it('skips a tagged contact with no address', () => {
    expect(recipientAddressesFor([contact('nobody', undefined, ['quote'])], 'quote')).toEqual([]);
  });
});

describe('a contact with no name', () => {
  const base = {
    id: 'c1',
    customerId: 'cu1',
    createdAt: '2026-10-30T16:00:00.000Z',
    updatedAt: '2026-10-30T16:00:00.000Z',
    lockVersion: 1,
    roles: [],
  };

  it('is a valid contact, its name null', () => {
    const parsed = contactSchema.safeParse({ ...base, name: null, email: 'ap@example.test' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.name).toBeNull();
  });

  it('is added with an email address and no name', () => {
    const parsed = createContactRequestSchema.safeParse({ email: 'ap@example.test' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).not.toHaveProperty('name');
  });

  it('is refused with neither a name nor an email address, in one sentence', () => {
    const parsed = createContactRequestSchema.safeParse({ phone: '307 555 0162' });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toEqual([
      CONTACT_NEEDS_NAME_OR_EMAIL,
    ]);
  });

  it('is still added by name alone', () => {
    expect(createContactRequestSchema.safeParse({ name: 'Pat Example' }).success).toBe(true);
  });

  it('has its name cleared by a PATCH null, the same three states as email', () => {
    const parsed = updateContactRequestSchema.safeParse({ name: null, lockVersion: 1 });
    expect(parsed.success && parsed.data.name).toBeNull();

    const absent = updateContactRequestSchema.safeParse({ lockVersion: 1 });
    expect(absent.success && absent.data).not.toHaveProperty('name');
  });

  it('is labelled by its address, and a named contact by its name', () => {
    expect(contactLabel({ name: null, email: 'ap@example.test' })).toBe('ap@example.test');
    expect(contactLabel({ name: 'Pat Example', email: 'pat@example.test' })).toBe('Pat Example');
    expect(contactLabel({ name: 'Pat Example' })).toBe('Pat Example');
  });
});
