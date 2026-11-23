// Converts a percent a person types into the ratio the API stores, and a stored ratio back into a percent.
// Both directions work on decimal strings through `Decimal`, never a float: docs/decisions/003-decimal-arithmetic.md.
import { toDecimal, toRate } from '@erp/types';

export type CollectedPercent = { ok: true; ratio: string } | { ok: false; message: string };

const PERCENT_TEXT = /^\d+(\.\d+)?$/;

export const PERCENT_PATTERN = '[0-9]+(\\.[0-9]+)?';

/**
 * Reads a typed percent and returns the ratio serialised at the rate scale by `toRate` (packages/types/src/decimal.ts).
 * Refuses text that is not a plain non-negative number, and a ratio at or above `maxExclusive`,
 * with a message that names `subject`.
 */
export function percentToRatio(
  percent: string,
  { subject, maxExclusive }: { subject: string; maxExclusive?: string },
): CollectedPercent {
  if (!PERCENT_TEXT.test(percent)) {
    return {
      ok: false,
      message: `${subject} must be a number of percent, such as 12. You entered "${percent}".`,
    };
  }
  const ratio = toDecimal(percent).div('100');

  if (maxExclusive !== undefined && ratio.gte(maxExclusive)) {
    const limit = toDecimal(maxExclusive).times('100').toString();
    return { ok: false, message: `${subject} must be under ${limit}%. You entered ${percent}%.` };
  }
  return { ok: true, ratio: toRate(ratio) };
}

export function ratioToPercent(ratio: string): string {
  return toDecimal(ratio).times('100').toString();
}
