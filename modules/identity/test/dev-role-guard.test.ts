// Tests modules/identity/src/domain/dev-role-guard.ts: when role seeding is allowed and every refusal.
import { describe, expect, it } from 'vitest';

import { resolveDevRoleSeeding } from '../src/domain/dev-role-guard';

describe('resolveDevRoleSeeding', () => {
  it('is off when the flag is unset', () => {
    expect(resolveDevRoleSeeding(undefined, 'local', 'memory', 'development')).toBe(false);
  });

  it('is off when the flag is empty (an unset variable in a compose file)', () => {
    expect(resolveDevRoleSeeding('', 'local', 'memory', 'development')).toBe(false);
  });

  it('is on for local + memory outside production', () => {
    expect(resolveDevRoleSeeding('true', 'local', 'memory', 'development')).toBe(true);
    expect(resolveDevRoleSeeding('true', 'local', 'memory', 'test')).toBe(true);
  });

  it.each([['1'], ['yes'], ['TRUE'], ['on']])(
    'refuses a truthy-looking value that is not "true" (%s)',
    (flag) => {
      expect(() => resolveDevRoleSeeding(flag, 'local', 'memory', 'development')).toThrow(
        /is not valid/,
      );
    },
  );

  it('refuses production, whatever else is configured', () => {
    expect(() => resolveDevRoleSeeding('true', 'local', 'memory', 'production')).toThrow(
      /NODE_ENV is "production"/,
    );
  });

  it('refuses the LDAP provider — a seeded row nobody can log in as still holds a role', () => {
    expect(() => resolveDevRoleSeeding('true', 'ldap', 'memory', 'development')).toThrow(
      /AUTH_PROVIDER is "ldap"/,
    );
  });

  it('refuses Postgres — it would keep the grants after the process exits', () => {
    expect(() => resolveDevRoleSeeding('true', 'local', 'postgres', 'development')).toThrow(
      /DATA_PERSISTENCE is "postgres"/,
    );
  });

  it('names the condition that failed, not just that something did', () => {
    expect(() => resolveDevRoleSeeding('true', 'ldap', 'postgres', 'development')).toThrow(
      /DEV_SEED_ROLES is "true" but AUTH_PROVIDER is "ldap"/,
    );
  });
});
