// Reads the lead-time form: a whole number of calendar days and the quote's lockVersion.
// The lead time is Production's to enter: docs/product/requirements.md (R5). Calendar days: docs/product/decisions.md.
import { optionalString } from '@erp/utils';

const MAX_LEAD_TIME_DAYS = 3650;

export type LeadTimeResult =
  { ok: true; leadTimeDays: number; lockVersion: number } | { ok: false; message: string };

export function collectLeadTime(formData: FormData): LeadTimeResult {
  const rawDays = optionalString(formData, 'leadTimeDays');
  if (rawDays === undefined) {
    return { ok: false, message: 'Enter a lead time in days.' };
  }
  const leadTimeDays = wholeNumber(rawDays);
  if (leadTimeDays === undefined) {
    return {
      ok: false,
      message: `A lead time is a whole number of days, 0 to ${String(MAX_LEAD_TIME_DAYS)}.`,
    };
  }
  if (leadTimeDays > MAX_LEAD_TIME_DAYS) {
    return {
      ok: false,
      message: `A lead time of ${String(leadTimeDays)} days is longer than the ${String(MAX_LEAD_TIME_DAYS)}-day maximum.`,
    };
  }

  // A form without the version it was drawn at is refused here. The API would refuse it anyway:
  // docs/decisions/006-optimistic-concurrency.md.
  const rawLock = optionalString(formData, 'lockVersion');
  const lockVersion = rawLock === undefined ? undefined : wholeNumber(rawLock);
  if (lockVersion === undefined || lockVersion < 1) {
    return { ok: false, message: 'This form is out of date — reload the quote and try again.' };
  }

  return { ok: true, leadTimeDays, lockVersion };
}

function wholeNumber(value: string): number | undefined {
  return /^\d+$/.test(value) ? Number(value) : undefined;
}
