// Tests the request schema for setting a user's roles, from packages/types, as the Admin page sends it.
import { describe, expect, it } from 'vitest';

import { ERP_ROLES, setRolesRequestSchema } from '@erp/types';

describe('setRolesRequestSchema', () => {
  const validIdentity = {
    externalId: 'ad-guid-1',
    username: 'jsmith',
    displayName: 'Taylor Example',
    email: 'jsmith@example.com',
  };

  it('accepts an empty roles array (revoke everything is a valid operation)', () => {
    const parsed = setRolesRequestSchema.parse({ identity: validIdentity, roles: [] });
    expect(parsed.roles).toEqual([]);
  });

  it('accepts the full role catalog', () => {
    const parsed = setRolesRequestSchema.parse({
      identity: validIdentity,
      roles: [...ERP_ROLES],
    });
    expect(parsed.roles).toHaveLength(ERP_ROLES.length);
  });

  it('rejects a role set larger than the catalog', () => {
    expect(() =>
      setRolesRequestSchema.parse({
        identity: validIdentity,
        roles: [...ERP_ROLES, 'Sales'],
      }),
    ).toThrow();
  });

  it('rejects a role not in the catalog', () => {
    expect(() =>
      setRolesRequestSchema.parse({
        identity: validIdentity,
        roles: ['SuperAdmin'],
      }),
    ).toThrow();
  });

  it('normalizes the identity username (trim + lowercase)', () => {
    const parsed = setRolesRequestSchema.parse({
      identity: { ...validIdentity, username: '  JSmith  ' },
      roles: [],
    });
    expect(parsed.identity.username).toBe('jsmith');
  });

  it('rejects an invalid email in the identity', () => {
    expect(() =>
      setRolesRequestSchema.parse({
        identity: { ...validIdentity, email: 'not-an-email' },
        roles: [],
      }),
    ).toThrow();
  });
});
