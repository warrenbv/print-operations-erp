// Tests the credit hold button and reading its form.
import { describe, expect, it } from 'vitest';

import { collectSetCreditHold, creditHoldAct } from './credit-hold';

function formOf(entries: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

describe('creditHoldAct', () => {
  it('offers the hold to an account that is clear', () => {
    expect(creditHoldAct(false)).toEqual({ nextHeld: true, label: 'Place on hold' });
  });

  it('offers the lift to an account that is held', () => {
    expect(creditHoldAct(true)).toEqual({ nextHeld: false, label: 'Lift hold' });
  });

  it('never offers both, which is what keeps a re-affirm off the screen', () => {
    for (const held of [true, false]) {
      expect(Object.keys(creditHoldAct(held))).toEqual(['nextHeld', 'label']);
    }
  });
});

describe('collectSetCreditHold', () => {
  it('collects a hold', () => {
    const collected = collectSetCreditHold(
      formOf({ customerId: 'cus-1', held: 'true', lockVersion: '3' }),
    );
    expect(collected).toEqual({
      ok: true,
      customerId: 'cus-1',
      request: { held: true, lockVersion: 3 },
    });
  });

  it('collects a lift', () => {
    const collected = collectSetCreditHold(
      formOf({ customerId: 'cus-1', held: 'false', lockVersion: '12' }),
    );
    expect(collected).toEqual({
      ok: true,
      customerId: 'cus-1',
      request: { held: false, lockVersion: 12 },
    });
  });

  it('sends lockVersion as a number, because the schema takes no string', () => {
    const collected = collectSetCreditHold(
      formOf({ customerId: 'cus-1', held: 'true', lockVersion: '7' }),
    );
    expect(collected.ok && typeof collected.request.lockVersion).toBe('number');
  });

  it('refuses a form with no customer', () => {
    const collected = collectSetCreditHold(formOf({ held: 'true', lockVersion: '1' }));
    expect(collected).toEqual({ ok: false, message: 'That form did not say which customer.' });
  });

  it('refuses a form that does not say which way the act goes', () => {
    const collected = collectSetCreditHold(
      formOf({ customerId: 'cus-1', held: 'on', lockVersion: '1' }),
    );
    expect(collected).toEqual({
      ok: false,
      message: 'That form did not say whether to place or lift the hold.',
    });
  });

  it('refuses a missing lock version rather than sending one the edge invents', () => {
    const collected = collectSetCreditHold(formOf({ customerId: 'cus-1', held: 'true' }));
    expect(collected.ok).toBe(false);
    expect(!collected.ok && collected.message).toContain('lockVersion');
  });

  it('refuses a lock version that is not a number', () => {
    const collected = collectSetCreditHold(
      formOf({ customerId: 'cus-1', held: 'true', lockVersion: 'v3' }),
    );
    expect(collected.ok).toBe(false);
    expect(!collected.ok && collected.message).toContain('lockVersion');
  });
});
