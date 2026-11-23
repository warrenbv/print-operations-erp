// Tests the choice between the user list, no matches and an unavailable directory.
import type { AdminUserRow } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { DIRECTORY_UNAVAILABLE_MESSAGE, usersView } from './directory-view';

function row(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    externalId: 'guid-1',
    username: 'demo-sales-a',
    displayName: 'J Demo',
    roles: [],
    disabled: false,
    alreadyProvisioned: true,
    ...overrides,
  };
}

describe('usersView', () => {
  it('reports the directory as unavailable when the read returned null', () => {
    expect(usersView(null)).toEqual({ kind: 'directory-unavailable' });
  });

  it('does not confuse an unavailable directory with an empty one', () => {
    expect(usersView(null).kind).not.toBe(usersView([]).kind);
  });

  it('reports no matches for a search that legitimately found nobody', () => {
    expect(usersView([])).toEqual({ kind: 'no-matches' });
  });

  it('hands the rows back on the list arm, so the page cannot re-check for null', () => {
    expect(usersView([row()])).toEqual({ kind: 'list', rows: [row()] });
  });
});

describe('DIRECTORY_UNAVAILABLE_MESSAGE', () => {
  it('says what is wrong, what to do now, and when to escalate', () => {
    expect(DIRECTORY_UNAVAILABLE_MESSAGE).toContain('directory is unavailable');
    expect(DIRECTORY_UNAVAILABLE_MESSAGE).toContain('Try again');
    expect(DIRECTORY_UNAVAILABLE_MESSAGE).toContain('call IT');
  });

  it('does not put a status code or a protocol in front of the reader', () => {
    expect(DIRECTORY_UNAVAILABLE_MESSAGE).not.toMatch(/503|LDAP|ldap/);
  });
});
