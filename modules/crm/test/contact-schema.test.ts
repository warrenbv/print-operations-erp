// The contact request schemas from packages/types/src/contact.ts.
import { describe, expect, it } from 'vitest';

import { createContactRequestSchema, updateContactRequestSchema } from '@erp/types';

describe('createContactRequestSchema', () => {
  it('trims the name', () => {
    const parsed = createContactRequestSchema.parse({ name: '  Alex Demo  ' });
    expect(parsed.name).toBe('Alex Demo');
  });

  it('rejects an empty name', () => {
    expect(() => createContactRequestSchema.parse({ name: '' })).toThrow();
    expect(() => createContactRequestSchema.parse({ name: '   ' })).toThrow();
  });

  it('accepts optional email and phone', () => {
    const parsed = createContactRequestSchema.parse({
      name: 'Jane',
      email: 'jane@example.com',
      phone: '(360) 555-0187',
    });
    expect(parsed.email).toBe('jane@example.com');
    expect(parsed.phone).toBe('(360) 555-0187');
  });

  it('accepts a contact with only a name (no phone or email required)', () => {
    const parsed = createContactRequestSchema.parse({ name: 'Jane' });
    expect(parsed.email).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
  });

  it('rejects an invalid email', () => {
    expect(() =>
      createContactRequestSchema.parse({ name: 'Jane', email: 'not-an-email' }),
    ).toThrow();
  });

  it('accepts small-business phone formats verbatim (no normalization)', () => {
    for (const phone of ['360-555-0187', '+1 360 555 0187', '3605550187', 'x847']) {
      expect(createContactRequestSchema.parse({ name: 'Jane', phone }).phone).toBe(phone);
    }
  });
});

describe('updateContactRequestSchema', () => {
  it('accepts a patch that changes nothing but still carries the token', () => {
    expect(updateContactRequestSchema.parse({ lockVersion: 3 })).toEqual({ lockVersion: 3 });
  });

  it('refuses a patch with no token, rather than falling back to last-write-wins', () => {
    expect(() => updateContactRequestSchema.parse({ name: 'Jane' })).toThrow();
    expect(() => updateContactRequestSchema.parse({})).toThrow();
  });

  it('refuses a token that is not a positive integer', () => {
    for (const bad of [0, -1, 2.7, '2', null]) {
      expect(() => updateContactRequestSchema.parse({ lockVersion: bad })).toThrow();
    }
  });

  it('preserves per-field validation instead of collapsing to bare string', () => {
    expect(() => updateContactRequestSchema.parse({ name: '', lockVersion: 1 })).toThrow();
    expect(() =>
      updateContactRequestSchema.parse({ email: 'not-an-email', lockVersion: 1 }),
    ).toThrow();
  });

  describe('null clears, absent leaves alone', () => {
    it.each([['email'], ['phone']] as const)('accepts null for %s', (field) => {
      const parsed = updateContactRequestSchema.parse({ [field]: null, lockVersion: 1 });
      expect(parsed[field]).toBeNull();
    });

    it('distinguishes absent from null', () => {
      const cleared = updateContactRequestSchema.parse({ email: null, lockVersion: 1 });
      const untouched = updateContactRequestSchema.parse({ name: 'Jane', lockVersion: 1 });
      expect(cleared.email).toBeNull();
      expect(untouched.email).toBeUndefined();
    });

    it('accepts both fields cleared at once', () => {
      const parsed = updateContactRequestSchema.parse({ email: null, phone: null, lockVersion: 1 });
      expect(parsed.email).toBeNull();
      expect(parsed.phone).toBeNull();
    });

    it('takes null for name, which clears it', () => {
      expect(updateContactRequestSchema.parse({ name: null, lockVersion: 1 }).name).toBeNull();

      expect(() => updateContactRequestSchema.parse({ name: '', lockVersion: 1 })).toThrow();
    });

    it('still validates a non-null value', () => {
      expect(() =>
        updateContactRequestSchema.parse({ email: 'not-an-email', lockVersion: 1 }),
      ).toThrow();
      expect(() => updateContactRequestSchema.parse({ phone: '', lockVersion: 1 })).toThrow();
    });

    it('does not treat an empty string as a clear', () => {
      expect(() => updateContactRequestSchema.parse({ email: '', lockVersion: 1 })).toThrow();
    });
  });
});
