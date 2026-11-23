// Tests date, time and age formatting in the business time zone, and the late and unset checks.
import { describe, expect, it } from 'vitest';

import {
  LATE_AFTER_DAYS,
  formatAge,
  formatClock,
  formatDay,
  formatTimestamp,
  isLate,
  isUnsetTimestamp,
} from './dates';

describe('formatAge', () => {
  const now = new Date('2026-10-07T19:00:00.000Z');

  it('reads today, 1 day and N days', () => {
    expect(formatAge('2026-10-07T16:00:00.000Z', now)).toBe('today');
    expect(formatAge('2026-10-06T19:00:00.000Z', now)).toBe('1 day');
    expect(formatAge('2026-09-18T19:00:00.000Z', now)).toBe('19 days');
  });

  it('counts Pacific calendar days, not 24-hour spans', () => {
    const justAfterMidnight = new Date('2026-10-07T07:30:00.000Z');
    expect(formatAge('2026-10-07T06:30:00.000Z', justAfterMidnight)).toBe('1 day');

    expect(formatAge('2026-10-07T00:30:00.000Z', now)).toBe('1 day');
  });

  it('reads a stamp in the future as today', () => {
    expect(formatAge('2026-10-09T19:00:00.000Z', now)).toBe('today');
  });
});

describe('isLate', () => {
  const now = new Date('2026-10-07T19:00:00.000Z');

  it('is late only after more than 7 calendar days', () => {
    expect(LATE_AFTER_DAYS).toBe(7);
    expect(isLate('2026-09-30T19:00:00.000Z', now)).toBe(false);
    expect(isLate('2026-09-29T19:00:00.000Z', now)).toBe(true);
  });

  it('takes another threshold when given one', () => {
    expect(isLate('2026-10-05T19:00:00.000Z', now, 1)).toBe(true);
    expect(isLate('2026-10-06T19:00:00.000Z', now, 1)).toBe(false);
  });
});

describe('isUnsetTimestamp', () => {
  it('treats the epoch as no stamp, since it prints as 1969 in Pacific', () => {
    expect(isUnsetTimestamp('1970-01-01T00:00:00.000Z')).toBe(true);
    expect(formatTimestamp('1970-01-01T00:00:00.000Z')).toBe('1969-12-31 16:00 PST');
  });

  it('treats anything before the epoch as no stamp too', () => {
    expect(isUnsetTimestamp('1969-06-01T00:00:00.000Z')).toBe(true);
  });

  it('keeps a real stamp, including a migration-time seed', () => {
    expect(isUnsetTimestamp('2026-07-01T17:00:00.000Z')).toBe(false);
    expect(isUnsetTimestamp('1970-01-01T00:00:00.001Z')).toBe(false);
  });
});

describe('formatTimestamp', () => {
  it('renders the shop clock with the zone that was in force', () => {
    expect(formatTimestamp('2026-08-10T21:23:00.000Z')).toBe('2026-08-10 14:23 PDT');
  });

  it('says PST in winter, without anybody changing anything', () => {
    expect(formatTimestamp('2026-01-10T22:23:00.000Z')).toBe('2026-01-10 14:23 PST');
  });

  it('puts an evening instant on the day the shop was having', () => {
    expect(formatTimestamp('2026-08-24T01:00:00.000Z')).toBe('2026-08-23 18:00 PDT');
  });

  it('renders midnight as 00:00, not 24:00', () => {
    expect(formatTimestamp('2026-08-24T07:00:00.000Z')).toBe('2026-08-24 00:00 PDT');
  });

  it('is 24-hour, so afternoon needs no suffix to be unambiguous', () => {
    expect(formatTimestamp('2026-08-10T02:05:00.000Z')).toBe('2026-08-09 19:05 PDT');
  });

  it('refuses an unparseable instant rather than printing NaN', () => {
    expect(() => formatTimestamp('not a date')).toThrow(/Not an instant/);
  });
});

describe('formatClock', () => {
  it('prints the time of day with its zone, as formatTimestamp does', () => {
    expect(formatClock('2026-08-10T21:10:00.000Z')).toBe('14:10 PDT');
    expect(formatClock('2026-01-10T22:10:00.000Z')).toBe('14:10 PST');
  });

  it('renders midnight as 00, not 24', () => {
    expect(formatClock('2026-08-24T07:05:00.000Z')).toBe('00:05 PDT');
  });
});

describe('formatDay', () => {
  it('carries no zone label', () => {
    expect(formatDay('2026-08-10T21:23:00.000Z')).toBe('2026-08-10');
  });

  it('cuts the day on the shop clock, not at 00:00Z', () => {
    expect(formatDay('2026-08-24T01:00:00.000Z')).toBe('2026-08-23');
    expect(formatDay('2026-08-24T18:00:00.000Z')).toBe('2026-08-24');
  });

  it('agrees with formatTimestamp about which day it is', () => {
    for (const iso of [
      '2026-08-24T01:00:00.000Z',
      '2026-01-15T07:59:59.999Z',
      '2026-11-01T08:30:00.000Z',
    ]) {
      expect(formatTimestamp(iso).startsWith(formatDay(iso))).toBe(true);
    }
  });
});
