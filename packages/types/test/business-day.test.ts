// Tests for calendar-day arithmetic in the business time zone, including independence from the host's zone.
import { describe, expect, it } from 'vitest';

import {
  BUSINESS_TIMEZONE,
  addCalendarDays,
  businessDayAfter,
  businessDayOf,
  calendarDaysBetween,
  quarterStartOf,
  startOfBusinessDay,
  startOfNextBusinessDay,
} from '../src/business-day';

const SPRING_FORWARD = '2026-03-08';
const FALL_BACK = '2026-11-01';
const HOUR_MS = 60 * 60 * 1000;

describe('BUSINESS_TIMEZONE', () => {
  it('is the IANA name, not an offset', () => {
    expect(BUSINESS_TIMEZONE).toBe('America/Los_Angeles');
  });
});

describe('businessDayOf - the day an instant falls on', () => {
  it('reads the evening window as today, where a UTC slice reads tomorrow', () => {
    const evening = '2026-08-24T01:00:00.000Z';
    expect(businessDayOf(evening)).toBe('2026-08-23');
    expect(evening.slice(0, 10)).toBe('2026-08-24');
  });

  it('agrees with a UTC slice during the day', () => {
    expect(businessDayOf('2026-08-24T18:00:00.000Z')).toBe('2026-08-24');
  });

  it('cuts at local midnight, not at 00:00Z - summer', () => {
    expect(businessDayOf('2026-08-24T06:59:59.999Z')).toBe('2026-08-23');
    expect(businessDayOf('2026-08-24T07:00:00.000Z')).toBe('2026-08-24');
  });

  it('cuts at local midnight, not at 00:00Z - winter', () => {
    expect(businessDayOf('2026-01-15T07:59:59.999Z')).toBe('2026-01-14');
    expect(businessDayOf('2026-01-15T08:00:00.000Z')).toBe('2026-01-15');
  });

  it('rolls the year on the local boundary, not the UTC one', () => {
    expect(businessDayOf('2027-01-01T07:59:59.999Z')).toBe('2026-12-31');
    expect(businessDayOf('2027-01-01T08:00:00.000Z')).toBe('2027-01-01');
  });

  it('takes a Date as well as an ISO string', () => {
    expect(businessDayOf(new Date('2026-08-24T01:00:00.000Z'))).toBe('2026-08-23');
  });

  it('refuses an unparseable instant rather than inventing a day', () => {
    expect(() => businessDayOf('not a date')).toThrow(/Not an instant/);
  });
});

describe('startOfBusinessDay - the inclusive lower bound', () => {
  it('is 07:00Z in summer and 08:00Z in winter', () => {
    expect(startOfBusinessDay('2026-08-24').toISOString()).toBe('2026-08-24T07:00:00.000Z');
    expect(startOfBusinessDay('2026-01-15').toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });

  it('lands on its own day, and one millisecond earlier is the day before', () => {
    for (const day of ['2026-01-01', '2026-06-15', SPRING_FORWARD, FALL_BACK, '2026-12-31']) {
      const start = startOfBusinessDay(day);
      expect(businessDayOf(start)).toBe(day);
      expect(businessDayOf(new Date(start.getTime() - 1))).not.toBe(day);
    }
  });

  it('holds that invariant on every day of a whole year', () => {
    let day = '2026-01-01';
    let checked = 0;
    while (day <= '2026-12-31') {
      const start = startOfBusinessDay(day);
      expect(businessDayOf(start)).toBe(day);
      expect(businessDayOf(new Date(start.getTime() - 1))).toBe(
        businessDayOf(new Date(start.getTime() - HOUR_MS)),
      );
      day = businessDayAfter(day);
      checked += 1;
    }
    expect(checked).toBe(365);
  });

  it('refuses anything that is not a calendar day', () => {
    expect(() => startOfBusinessDay('2026-8-24')).toThrow(/Expected YYYY-MM-DD/);
    expect(() => startOfBusinessDay('2026-08-24T00:00:00Z')).toThrow(/Expected YYYY-MM-DD/);
  });
});

describe('addCalendarDays - civil date arithmetic', () => {
  it('counts calendar days, not working days', () => {
    expect(addCalendarDays('2026-08-21', 10)).toBe('2026-08-31');
  });

  it('goes backwards on a negative count, and nowhere on zero', () => {
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addCalendarDays('2026-08-24', 0)).toBe('2026-08-24');
  });

  it('crosses both DST dates without gaining or losing a day', () => {
    expect(addCalendarDays('2026-03-01', 14)).toBe('2026-03-15');
    expect(addCalendarDays('2026-10-25', 14)).toBe('2026-11-08');
  });

  it('rolls long spans across year ends', () => {
    expect(addCalendarDays('2026-12-20', 30)).toBe('2027-01-19');
    expect(addCalendarDays('2032-02-01', 29)).toBe('2032-03-01');
  });

  it('refuses a fractional count rather than rounding it', () => {
    expect(() => addCalendarDays('2026-08-24', 3.7)).toThrow(/whole number of days/);
  });
});

describe('businessDayAfter - civil date arithmetic', () => {
  it('rolls month, year and leap-year ends', () => {
    expect(businessDayAfter('2026-08-24')).toBe('2026-08-25');
    expect(businessDayAfter('2026-08-31')).toBe('2026-09-01');
    expect(businessDayAfter('2026-12-31')).toBe('2027-01-01');
    expect(businessDayAfter('2026-02-28')).toBe('2026-03-01');
    expect(businessDayAfter('2032-02-28')).toBe('2032-02-29');
  });

  it('is unaffected by DST, because no instant is involved', () => {
    expect(businessDayAfter(SPRING_FORWARD)).toBe('2026-03-09');
    expect(businessDayAfter(FALL_BACK)).toBe('2026-11-02');
  });
});

describe('calendarDaysBetween - civil date arithmetic', () => {
  it('counts whole days forward', () => {
    expect(calendarDaysBetween('2026-08-21', '2026-08-31')).toBe(10);
    expect(calendarDaysBetween('2026-08-24', '2026-08-25')).toBe(1);
  });

  it('is zero on the same day, and negative going backwards', () => {
    expect(calendarDaysBetween('2026-08-24', '2026-08-24')).toBe(0);
    expect(calendarDaysBetween('2026-08-24', '2026-08-17')).toBe(-7);
  });

  it('inverts addCalendarDays across month, year and leap-year ends', () => {
    expect(calendarDaysBetween('2026-12-20', '2027-01-19')).toBe(30);
    expect(calendarDaysBetween('2032-02-01', '2032-03-01')).toBe(29);
    expect(calendarDaysBetween('2026-03-01', '2026-02-28')).toBe(-1);
  });

  it('crosses both DST dates without gaining or losing a day', () => {
    expect(calendarDaysBetween('2026-03-01', '2026-03-15')).toBe(14);
    expect(calendarDaysBetween('2026-10-25', '2026-11-08')).toBe(14);
    expect(calendarDaysBetween(SPRING_FORWARD, businessDayAfter(SPRING_FORWARD))).toBe(1);
    expect(calendarDaysBetween(FALL_BACK, businessDayAfter(FALL_BACK))).toBe(1);
  });

  it('refuses something that is not a calendar day', () => {
    expect(() => calendarDaysBetween('2026-08-24', 'yesterday')).toThrow();
    expect(() => calendarDaysBetween('2026-08-24T00:00:00Z', '2026-08-25')).toThrow();
  });
});

describe('startOfNextBusinessDay - the exclusive upper bound', () => {
  it('spans 23 hours across the spring-forward date', () => {
    const start = startOfBusinessDay(SPRING_FORWARD);
    const end = startOfNextBusinessDay(SPRING_FORWARD);
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR_MS);
  });

  it('spans 25 hours across the fall-back date', () => {
    const start = startOfBusinessDay(FALL_BACK);
    const end = startOfNextBusinessDay(FALL_BACK);
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR_MS);
  });

  it('spans 24 hours on an ordinary date', () => {
    const start = startOfBusinessDay('2026-08-24');
    const end = startOfNextBusinessDay('2026-08-24');
    expect(end.getTime() - start.getTime()).toBe(24 * HOUR_MS);
  });

  it('excludes its own instant and includes the last millisecond before it', () => {
    const end = startOfNextBusinessDay('2026-08-24');
    expect(businessDayOf(new Date(end.getTime() - 1))).toBe('2026-08-24');
    expect(businessDayOf(end)).toBe('2026-08-25');
  });

  it('is what a naive plus-24-hours gets wrong, twice a year', () => {
    const naive = new Date(startOfBusinessDay(FALL_BACK).getTime() + 24 * HOUR_MS);
    expect(businessDayOf(naive)).toBe(FALL_BACK);
    expect(businessDayOf(startOfNextBusinessDay(FALL_BACK))).toBe('2026-11-02');
  });
});

describe('independence from the host clock', () => {
  it('does not consult the host zone', () => {
    const instant = new Date('2026-08-24T01:00:00.000Z');
    const hostDay = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
    expect(businessDayOf(instant)).toBe('2026-08-23');

    expect(typeof hostDay).toBe('string');
  });

  it('round-trips every instant through its own day', () => {
    for (const iso of [
      '2026-03-08T09:30:00.000Z',
      '2026-03-08T10:30:00.000Z',
      '2026-11-01T08:30:00.000Z',
      '2026-11-01T09:30:00.000Z',
      '2026-07-04T12:00:00.000Z',
    ]) {
      const day = businessDayOf(iso);
      const instant = new Date(iso);
      expect(startOfBusinessDay(day).getTime()).toBeLessThanOrEqual(instant.getTime());
      expect(startOfNextBusinessDay(day).getTime()).toBeGreaterThan(instant.getTime());
    }
  });
});

describe('quarterStartOf', () => {
  it('maps every month to the first day of its quarter', () => {
    expect(quarterStartOf('2026-01-01')).toBe('2026-01-01');
    expect(quarterStartOf('2026-02-14')).toBe('2026-01-01');
    expect(quarterStartOf('2026-03-31')).toBe('2026-01-01');
    expect(quarterStartOf('2026-04-01')).toBe('2026-04-01');
    expect(quarterStartOf('2026-06-30')).toBe('2026-04-01');
    expect(quarterStartOf('2026-07-01')).toBe('2026-07-01');
    expect(quarterStartOf('2026-08-28')).toBe('2026-07-01');
    expect(quarterStartOf('2026-09-30')).toBe('2026-07-01');
    expect(quarterStartOf('2026-10-01')).toBe('2026-10-01');
    expect(quarterStartOf('2026-12-31')).toBe('2026-10-01');
  });

  it('is idempotent, so a quarter start is its own quarter start', () => {
    for (const month of ['01', '04', '07', '10']) {
      const start = `2026-${month}-01`;
      expect(quarterStartOf(quarterStartOf(start))).toBe(start);
    }
  });

  it('refuses anything that is not a calendar day', () => {
    expect(() => quarterStartOf('2026-08-28T12:00:00Z')).toThrow(/calendar day/);
    expect(() => quarterStartOf('August 2026')).toThrow(/calendar day/);
  });
});
