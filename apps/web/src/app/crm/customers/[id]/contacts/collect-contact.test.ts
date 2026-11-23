// Tests reading the add, edit and remove contact forms.
import { CONTACT_NEEDS_NAME_OR_EMAIL } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  CONTACT_ROLES_FIELD,
  collectCreate,
  collectDelete,
  collectUpdate,
} from './collect-contact';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe('collectCreate', () => {
  it('builds the minimum valid contact', () => {
    const result = collectCreate(form({ name: 'Taylor Demo' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toEqual({ name: 'Taylor Demo' });
  });

  it('omits blank optional fields rather than sending empty strings', () => {
    const result = collectCreate(form({ name: 'Taylor Demo', email: '', phone: '   ' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).not.toHaveProperty('email');
    expect(result.request).not.toHaveProperty('phone');
  });

  it('carries email and phone when they are filled', () => {
    const result = collectCreate(
      form({ name: 'Taylor Demo', email: 'fixture-26@example.test', phone: '(425) 555-0187' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.email).toBe('fixture-26@example.test');

    expect(result.request.phone).toBe('(425) 555-0187');
  });

  it('trims what it keeps', () => {
    const result = collectCreate(form({ name: '  Taylor Demo  ' }));
    expect(result.ok && result.request.name).toBe('Taylor Demo');
  });

  it('accepts a blank name with an email address, sending no name', () => {
    const result = collectCreate(form({ name: '  ', email: 'fixture-08@example.test' }));
    expect(result).toEqual({ ok: true, request: { email: 'fixture-08@example.test' } });
  });

  it('refuses a blank name and a blank email address, in one sentence', () => {
    expect(collectCreate(form({ name: '', email: ' ', phone: '360-555-0162' }))).toEqual({
      ok: false,
      message: CONTACT_NEEDS_NAME_OR_EMAIL,
    });
    expect(CONTACT_NEEDS_NAME_OR_EMAIL).toBe('a contact needs a name or an email address.');
  });

  it('refuses an invalid email, naming the field', () => {
    const result = collectCreate(form({ name: 'Taylor Demo', email: 'not-an-email' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('email');
  });
});

describe('collectUpdate', () => {
  it('sends null for a blank optional field, which clears it', () => {
    const result = collectUpdate(form({ name: 'Taylor Demo', lockVersion: '1' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.email).toBeNull();
    expect(result.request.phone).toBeNull();
  });

  it('sends the value when the field is filled', () => {
    const result = collectUpdate(
      form({
        name: 'Taylor Demo',
        email: 'fixture-26@example.test',
        phone: '360-555-0162',
        lockVersion: '1',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.email).toBe('fixture-26@example.test');
    expect(result.request.phone).toBe('360-555-0162');
  });

  it('clears one field while keeping the other', () => {
    const result = collectUpdate(
      form({ name: 'Taylor Demo', email: '', phone: '360-555-0162', lockVersion: '1' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.email).toBeNull();
    expect(result.request.phone).toBe('360-555-0162');
  });

  it('sends null for a blank name when there is an email address', () => {
    const result = collectUpdate(
      form({ name: '   ', email: 'fixture-08@example.test', lockVersion: '1' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.name).toBeNull();
    expect(result.request.email).toBe('fixture-08@example.test');
  });

  it('refuses a blank name and a blank email address, in one sentence', () => {
    const result = collectUpdate(form({ name: '', email: '', phone: '1', lockVersion: '1' }));
    expect(result).toEqual({ ok: false, message: CONTACT_NEEDS_NAME_OR_EMAIL });
  });

  it('still saves a name alone', () => {
    const result = collectUpdate(form({ name: 'Taylor Demo', lockVersion: '1' }));
    expect(result.ok && result.request.name).toBe('Taylor Demo');
  });

  it('refuses an invalid email rather than clearing it', () => {
    const result = collectUpdate(
      form({ name: 'Taylor Demo', email: 'not-an-email', lockVersion: '1' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('email');
  });
});

describe('collectDelete', () => {
  it('reads the generation the confirm page was rendered with', () => {
    const result = collectDelete(form({ lockVersion: '4' }));
    expect(result).toEqual({ ok: true, request: { lockVersion: 4 } });
  });

  it('refuses a form with no token rather than deleting last-write-wins', () => {
    expect(collectDelete(form({})).ok).toBe(false);
  });

  it('refuses a token that is not a positive integer', () => {
    for (const bad of ['0', '-1', '9.5', 'two', '']) {
      expect(collectDelete(form({ lockVersion: bad })).ok).toBe(false);
    }
  });
});

describe('collectUpdate carries the token', () => {
  it('parses the hidden field into the number the contract wants', () => {
    const result = collectUpdate(form({ name: 'Taylor Demo', lockVersion: '7' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.lockVersion).toBe(7);
    }
  });

  it('refuses a form with no token', () => {
    expect(collectUpdate(form({ name: 'Taylor Demo' })).ok).toBe(false);
  });
});

describe('the role checkboxes', () => {
  function withRoles(fields: Record<string, string>, roles: readonly string[]): FormData {
    const data = form(fields);
    for (const role of roles) {
      data.append(CONTACT_ROLES_FIELD, role);
    }
    return data;
  }

  it('sends every ticked box, as a full replacement of the set', () => {
    const result = collectUpdate(
      withRoles({ name: 'Jane', email: 'fixture-27@example.test', lockVersion: '3' }, [
        'quote',
        'production',
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.roles).toEqual(['quote', 'production']);
  });

  it('sends an empty array when nothing is ticked, never an absent field', () => {
    const result = collectUpdate(form({ name: 'Jane', lockVersion: '3' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.roles).toEqual([]);
  });

  it('refuses a role outside the closed list', () => {
    const result = collectUpdate(
      withRoles({ name: 'Jane', email: 'fixture-27@example.test', lockVersion: '3' }, ['shipping']),
    );
    expect(result.ok).toBe(false);
  });
});
