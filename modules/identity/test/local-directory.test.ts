// Tests modules/identity/src/providers/local-directory.ts, the Admin page's search in local mode.
import { describe, expect, it } from 'vitest';

import { LocalLdapDirectory } from '../src/providers/local-directory';
import { DEV_USERNAMES, devEmailFor } from '../src/providers/local-auth-provider';

describe('LocalLdapDirectory', () => {
  it('returns the full fixture on an empty query, up to the cap', () => {
    const dir = new LocalLdapDirectory();
    return dir.searchUsers('', 100).then((rows) => {
      expect(rows.map((u) => u.username)).toEqual([...DEV_USERNAMES]);
    });
  });

  it('caps results at the limit', async () => {
    const dir = new LocalLdapDirectory();
    const rows = await dir.searchUsers('', 2);
    expect(rows).toHaveLength(2);
  });

  it('filters by case-insensitive substring on username', async () => {
    const dir = new LocalLdapDirectory();
    const rows = await dir.searchUsers('SALES', 50);
    expect(rows.map((u) => u.username)).toEqual(['dev-sales']);
  });

  it('mints externalIds matching LocalAuthProvider so a login and an assignment target the same row', async () => {
    const dir = new LocalLdapDirectory();
    const rows = await dir.searchUsers('dev-billing', 50);
    expect(rows[0]?.externalId).toBe('local:dev-billing');
  });

  it('carries the address a login provisions, so the two admin screens agree', async () => {
    const dir = new LocalLdapDirectory();
    const rows = await dir.searchUsers('', 50);

    expect(rows.every((u) => u.email !== undefined)).toBe(true);
    for (const row of rows) {
      expect(row.email).toBe(devEmailFor(row.username));
    }
  });

  it('finds a user by their address, which the filter always claimed to support', async () => {
    const dir = new LocalLdapDirectory();
    const rows = await dir.searchUsers('dev-billing@example.test', 50);
    expect(rows.map((u) => u.username)).toEqual(['dev-billing']);
  });

  it('reports all fixture users as enabled — dev has no disabled state to model', async () => {
    const dir = new LocalLdapDirectory();
    const rows = await dir.searchUsers('', 50);
    expect(rows.every((u) => u.disabled === false)).toBe(true);
  });
});
