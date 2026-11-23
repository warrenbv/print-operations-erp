// Tests reading the lead-time form, and checks that what it produces passes the API's request schema.
import { setQuoteLeadTimeRequestSchema } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { collectLeadTime } from './collect-lead-time';

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return form;
}

describe('collectLeadTime', () => {
  it('builds a body the endpoint schema accepts', () => {
    const result = collectLeadTime(formOf({ leadTimeDays: '14', lockVersion: '3' }));

    expect(result.ok).toBe(true);
    expect(setQuoteLeadTimeRequestSchema.safeParse(result).success).toBe(true);
  });

  it('returns numbers, not the strings the form posted', () => {
    const result = collectLeadTime(formOf({ leadTimeDays: '14', lockVersion: '3' }));

    expect(result).toEqual({ ok: true, leadTimeDays: 14, lockVersion: 3 });
  });

  it('accepts zero, and does not confuse it with absent', () => {
    const result = collectLeadTime(formOf({ leadTimeDays: '0', lockVersion: '1' }));

    expect(result).toEqual({ ok: true, leadTimeDays: 0, lockVersion: 1 });
  });

  it('refuses an empty box rather than promising same-day', () => {
    const result = collectLeadTime(formOf({ leadTimeDays: '', lockVersion: '1' }));

    expect(result).toEqual({ ok: false, message: 'Enter a lead time in days.' });
  });

  it('refuses a blank-only box the same way', () => {
    const result = collectLeadTime(formOf({ leadTimeDays: '   ', lockVersion: '1' }));

    expect(result.ok).toBe(false);
  });

  it('refuses a missing box', () => {
    const result = collectLeadTime(formOf({ lockVersion: '1' }));

    expect(result.ok).toBe(false);
  });

  it.each(['-1', '4.5', 'abc', '1e3', '0x10', '12days', ' 1 2 '])(
    'refuses %s as a lead time',
    (leadTimeDays) => {
      const result = collectLeadTime(formOf({ leadTimeDays, lockVersion: '1' }));

      expect(result.ok).toBe(false);
    },
  );

  it('refuses a lead time past the ten-year maximum, and says the number back', () => {
    const result = collectLeadTime(formOf({ leadTimeDays: '4725', lockVersion: '1' }));

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('4725');
  });

  it.each(['', '0', '-2', 'two', undefined])(
    'refuses lockVersion %s and blames the form, not the person',
    (lockVersion) => {
      const result = collectLeadTime(
        formOf({ leadTimeDays: '14', ...(lockVersion === undefined ? {} : { lockVersion }) }),
      );

      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.message).toContain('reload');
    },
  );
});
