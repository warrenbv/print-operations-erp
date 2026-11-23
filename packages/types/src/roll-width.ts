// Roll widths: whole inches or sixteenths of an inch.
// A width stays a JavaScript number because a sixteenth is exact in binary floating point. The roll_width_in
// columns are `numeric(8, 4)` with matching sixteenths checks in the baselines under infra/db/migrations/.
import { z } from 'zod';

export const ROLL_WIDTH_MIN_IN = 1;

export const ROLL_WIDTH_MAX_IN = 1000;

export const ROLL_WIDTH_PARTS_PER_INCH = 16;

export const ROLL_WIDTH_REFUSAL =
  'a width is whole inches or sixteenths of an inch, from 1 to 1000 (11 5/16 is 11.3125)';

export const CUSTOM_WIDTH_REFUSAL = `a custom width is a whole number of inches from ${String(
  ROLL_WIDTH_MIN_IN,
)} to ${String(ROLL_WIDTH_MAX_IN)}.`;

export function isRollWidth(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= ROLL_WIDTH_MIN_IN &&
    value <= ROLL_WIDTH_MAX_IN &&
    Number.isInteger(value * ROLL_WIDTH_PARTS_PER_INCH)
  );
}

// An infinite number is refused before the refinement runs, so it is given the same refusal here.
export const rollWidthSchema = z
  .number({
    error: (issue) =>
      typeof issue.input === 'number' && !Number.isNaN(issue.input)
        ? ROLL_WIDTH_REFUSAL
        : undefined,
  })
  .refine(isRollWidth, { error: ROLL_WIDTH_REFUSAL });

/** A custom width is whole inches, as the custom_width_whole checks in the quoting and orders baselines require. */
export function refineCustomWidthWhole(
  line: { readonly rollWidthIn: number; readonly customWidth?: boolean | undefined },
  context: z.RefinementCtx,
): void {
  if (line.customWidth === true && !Number.isInteger(line.rollWidthIn)) {
    context.addIssue({
      code: 'custom',
      path: ['rollWidthIn'],
      message: CUSTOM_WIDTH_REFUSAL,
    });
  }
}

export function formatWidthIn(width: number, unit = '"'): string {
  const parts = width * ROLL_WIDTH_PARTS_PER_INCH;
  if (Number.isInteger(width) || !Number.isInteger(parts)) {
    return `${String(width)}${unit}`;
  }
  const whole = Math.trunc(width);
  let numerator = parts - whole * ROLL_WIDTH_PARTS_PER_INCH;
  let denominator = ROLL_WIDTH_PARTS_PER_INCH;
  while (numerator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }
  const fraction = `${String(numerator)}/${String(denominator)}`;
  return whole === 0 ? `${fraction}${unit}` : `${String(whole)} ${fraction}${unit}`;
}
