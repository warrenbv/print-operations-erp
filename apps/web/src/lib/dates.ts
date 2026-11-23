// Dates and times as the pages print them, always in the business time zone whatever the server's own zone is.
// Ages count calendar days, as lead times do: docs/product/decisions.md. The day arithmetic is packages/types/src/business-day.ts.
import { BUSINESS_TIMEZONE, businessDayOf, calendarDaysBetween } from '@erp/types';

export function formatTimestamp(iso: string): string {
  return `${businessDayOf(iso)} ${formatClock(iso)}`;
}

export function formatClock(iso: string): string {
  const parts = timestampParts(iso);
  return `${parts.hour}:${parts.minute} ${parts.zone}`;
}

// An instant at or before the Unix epoch stands for a timestamp that was never set.
export function isUnsetTimestamp(iso: string): boolean {
  return Date.parse(iso) <= 0;
}

export function formatDay(iso: string): string {
  return businessDayOf(iso);
}

export const LATE_AFTER_DAYS = 7;

function ageInDays(iso: string, now: Date): number {
  return Math.max(0, calendarDaysBetween(businessDayOf(iso), businessDayOf(now)));
}

export function formatAge(iso: string, now: Date): string {
  const days = ageInDays(iso, now);
  return days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
}

export function isLate(iso: string, now: Date, days: number = LATE_AFTER_DAYS): boolean {
  return ageInDays(iso, now) > days;
}

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

function timestampParts(iso: string): { hour: string; minute: string; zone: string } {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Not an instant: ${iso}`);
  }
  const parts = new Map<string, string>(
    TIMESTAMP_FORMAT.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const hour = parts.get('hour') ?? '00';
  return {
    // Some engines print midnight as hour 24 under `hour12: false`.
    hour: hour === '24' ? '00' : hour,
    minute: parts.get('minute') ?? '00',
    zone: parts.get('timeZoneName') ?? BUSINESS_TIMEZONE,
  };
}
