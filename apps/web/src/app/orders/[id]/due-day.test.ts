// Tests the due day.
import { describe, expect, it } from 'vitest';

import { dueDay } from './due-day';

describe('dueDay', () => {
  it('counts the committed lead time from the Pacific day of confirmation', () => {
    expect(dueDay({ confirmedAt: '2026-10-02T02:00:00.000Z', confirmedLeadTimeDays: 7 })).toBe(
      '2026-10-08',
    );
  });

  it('is undefined without a confirmation or a lead time', () => {
    expect(dueDay({ confirmedLeadTimeDays: 7 })).toBeUndefined();
    expect(dueDay({ confirmedAt: '2026-10-02T16:00:00.000Z' })).toBeUndefined();
  });
});
