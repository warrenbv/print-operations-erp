// Calendar-day arithmetic in the business's own time zone.
// A business day here is a calendar day, not a working day. Lead times count calendar days, so there is no
// working calendar: docs/product/decisions.md. Due days are computed with it in apps/web/src/app/orders/[id]/due-day.ts.
export const BUSINESS_TIMEZONE = 'America/Los_Angeles';

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

const CIVIL_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

interface CivilTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function civilTimeIn(instant: Date): CivilTime {
  const parts = new Map<string, string>(
    CIVIL_TIME_FORMAT.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const read = (type: string): number => {
    const value = parts.get(type);
    if (value === undefined) {
      throw new Error(`Intl gave no ${type} for ${instant.toISOString()}`);
    }
    return Number(value);
  };
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),

    // Some engines write midnight as hour 24 when hour12 is off.
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

function offsetMsAt(instant: Date): number {
  const civil = civilTimeIn(instant);
  const asIfUtc = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  );

  // The formatter gives whole seconds, so the instant is floored to the second before the two are compared.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function assertCalendarDay(day: string): void {
  if (!CALENDAR_DAY.test(day)) {
    throw new Error(`Not a calendar day: ${day}. Expected YYYY-MM-DD.`);
  }
}

function toInstant(instant: Date | string): Date {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Not an instant: ${String(instant)}`);
  }
  return date;
}

/** The calendar day an instant falls on in the business time zone, whatever the host's own zone. */
export function businessDayOf(instant: Date | string): string {
  const civil = civilTimeIn(toInstant(instant));
  return `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}`;
}

/**
 * The first instant of `day` in the business time zone, the inclusive lower bound of that day.
 * Throws when the zone has no midnight on that day.
 */
export function startOfBusinessDay(day: string): Date {
  assertCalendarDay(day);
  const midnightAsIfUtc = new Date(`${day}T00:00:00.000Z`).getTime();
  if (Number.isNaN(midnightAsIfUtc)) {
    throw new Error(`Not a calendar day: ${day}.`);
  }
  // The offset can change between UTC midnight and local midnight on a daylight-saving day,
  // so it is read twice and the result checked.
  const firstPass = new Date(midnightAsIfUtc - offsetMsAt(new Date(midnightAsIfUtc)));
  const settled = new Date(midnightAsIfUtc - offsetMsAt(firstPass));
  if (businessDayOf(settled) !== day) {
    throw new Error(`No midnight on ${day} in ${BUSINESS_TIMEZONE}.`);
  }
  return settled;
}

export function addCalendarDays(day: string, count: number): string {
  assertCalendarDay(day);
  if (!Number.isInteger(count)) {
    throw new Error(`Not a whole number of days: ${String(count)}`);
  }
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, date + count));
  if (Number.isNaN(shifted.getTime())) {
    throw new Error(`Not a calendar day: ${day}.`);
  }
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}-${pad(shifted.getUTCDate(), 2)}`;
}

export function businessDayAfter(day: string): string {
  return addCalendarDays(day, 1);
}

export function calendarDaysBetween(from: string, to: string): number {
  assertCalendarDay(from);
  assertCalendarDay(to);
  return Math.round((utcEpochOf(to) - utcEpochOf(from)) / MS_PER_DAY);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcEpochOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, date);
}

/** The exclusive upper bound of `day`. */
export function startOfNextBusinessDay(day: string): Date {
  return startOfBusinessDay(businessDayAfter(day));
}

export function quarterStartOf(day: string): string {
  assertCalendarDay(day);
  const [year, month] = day.split('-').map(Number) as [number, number, number];
  return `${pad(year, 4)}-${pad(month - ((month - 1) % 3), 2)}-01`;
}
