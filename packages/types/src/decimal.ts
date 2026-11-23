// The decimal scalars (money, rates, measures, unit costs), their wire schemas and the one arithmetic type allowed on them.
// Values cross boundaries as strings, become `Decimal` to compute, and are serialised at the kind's scale:
// docs/decisions/003-decimal-arithmetic.md. The scales match the numeric columns in the baselines under infra/db/migrations/.
import Big from 'big.js';
import { z } from 'zod';

/**
 * Places after the decimal point for each kind. Money is `numeric(19, 4)` and a rate is
 * `numeric(9, 6)`, as docs/decisions/010-orm-spike.md sets out. A measure is `numeric(12, 4)`.
 */
export const DECIMAL_SCALES = {
  money: 4,

  rate: 6,

  measure: 4,

  poundsPerTonne: 8,

  unitCost: 8,
} as const;

export type DecimalKind = keyof typeof DECIMAL_SCALES;

/** Total digits for each kind, the precision of its column. With the scale it gives `columnCeiling`. */
export const DECIMAL_PRECISION = {
  money: 19,

  rate: 9,

  measure: 12,

  poundsPerTonne: 12,

  unitCost: 12,
} as const satisfies Record<DecimalKind, number>;

export function columnCeiling(kind: DecimalKind): string {
  const scale = DECIMAL_SCALES[kind];
  return `${'9'.repeat(DECIMAL_PRECISION[kind] - scale)}.${'9'.repeat(scale)}`;
}

function grouped(value: string): string {
  const [whole = '', fraction = ''] = value.split('.');
  const digits = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === '' ? digits : `${digits}.${fraction}`;
}

/**
 * Refuses a value above the column's ceiling with a message that names the limit, so an
 * oversized figure fails validation instead of overflowing the column on write.
 */
export function withinColumn<Schema extends z.ZodType<string, string>>(
  schema: Schema,
  kind: DecimalKind,
  subject: string,
) {
  const ceiling = columnCeiling(kind);
  return schema.refine((value) => toDecimal(value).lte(ceiling), {
    error: `${subject} cannot be more than ${grouped(ceiling)}`,
  });
}

/**
 * A string schema for a decimal with at most `maxScale` places. A failed pattern check stops every later check,
 * so no refinement layered on top ever passes `toDecimal` a string it cannot read.
 */
export const decimalString = (maxScale: number) => {
  const pattern = new RegExp(`^-?\\d+(\\.\\d{1,${maxScale}})?$`);
  const message = `expected a decimal with at most ${maxScale} places`;

  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (pattern.test(value)) return;
      ctx.addIssue({ code: 'custom', message, continue: false });
      return z.NEVER;
    });
};
export const moneySchema = decimalString(DECIMAL_SCALES.money);
export const rateSchema = decimalString(DECIMAL_SCALES.rate);
export const measureSchema = decimalString(DECIMAL_SCALES.measure);
export const poundsPerTonneSchema = decimalString(DECIMAL_SCALES.poundsPerTonne);
export const unitCostSchema = decimalString(DECIMAL_SCALES.unitCost);

export type Money = z.infer<typeof moneySchema>;
export type Rate = z.infer<typeof rateSchema>;
export type Measure = z.infer<typeof measureSchema>;
export type UnitCost = z.infer<typeof unitCostSchema>;

// An isolated constructor, so nothing set here changes big.js for any other caller.
const Decimal = Big();

// Half-up rounding and the library's default division places, stated so the rule is visible in code.
Decimal.RM = 1;

Decimal.DP = 20;

export type Decimal = InstanceType<typeof Decimal>;

/**
 * Parses a decimal string. Throws a TypeError on anything else, because types vanish at runtime
 * and a JavaScript number has already lost precision.
 */
export function toDecimal(value: string): Decimal {
  if (typeof value !== 'string') {
    throw new TypeError(
      `Decimal values must be strings, received ${typeof value}. A JS number has ` +
        'already lost precision by this point — read the column with ' +
        "Drizzle's mode: 'string'.",
    );
  }
  return new Decimal(value);
}

/** Serialises at the kind's scale, rounding half-up. */
export function fromDecimal(value: Decimal, kind: DecimalKind): string {
  return value.toFixed(DECIMAL_SCALES[kind]);
}

export const toMoney = (value: Decimal): Money => fromDecimal(value, 'money');
export const toRate = (value: Decimal): Rate => fromDecimal(value, 'rate');
export const toMeasure = (value: Decimal): Measure => fromDecimal(value, 'measure');
export const toUnitCost = (value: Decimal): UnitCost => fromDecimal(value, 'unitCost');

/**
 * Serialises money rounding away from zero. The margin-floor minimum price uses it, so the
 * quoted minimum never falls below the floor: `evaluateFloor` in packages/types/src/quote-calculation.ts.
 */
export function toMoneyRoundedUp(value: Decimal): Money {
  return value.toFixed(DECIMAL_SCALES.money, 3);
}

/** Cents, for display only. Stored money keeps four places. */
export const MONEY_DISPLAY_SCALE = 2;

export function roundToCents(value: Money): Money {
  return toMoney(toDecimal(value).round(MONEY_DISPLAY_SCALE));
}

export function formatMoney(value: string): string {
  const rounded = toDecimal(value).toFixed(MONEY_DISPLAY_SCALE);
  const negative = rounded.startsWith('-');
  const digits = negative ? rounded.slice(1) : rounded;
  const [whole = '0', cents = '00'] = digits.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${cents}`;
}

export function formatMeasure(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return trimmed === '' ? grouped : `${grouped}.${trimmed}`;
}

/** Shows every stored place, because a price per pound is quoted below the cent. */
export function formatPricePerPound(value: string): string {
  const [whole = '0', places = ''] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return places === '' ? `$${grouped}` : `$${grouped}.${places}`;
}

/** Turns a ratio string into a percent by moving the decimal point in the string, so no float touches it. */
export function formatRatePercent(ratio: string): string {
  const negative = ratio.startsWith('-');
  const digits = negative ? ratio.slice(1) : ratio;
  const [whole = '0', fraction = ''] = digits.split('.');
  const integer = `${whole}${`${fraction}00`.slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  const rest = fraction.slice(2).replace(/0+$/, '');
  const sign = negative && /[1-9]/.test(digits) ? '-' : '';
  return `${sign}${integer}${rest === '' ? '' : `.${rest}`}%`;
}

export function formatEstimatedPounds(value: string): string {
  return formatMoney(value).replace('$', '');
}

export function positiveDecimal<Schema extends z.ZodType<string, string>>(
  schema: Schema,
  field: string,
  kind: DecimalKind,
) {
  return withinColumn(
    schema.refine((value) => toDecimal(value).gt(0), {
      error: `${field} must be greater than zero`,
    }),
    kind,
    field,
  );
}

export function zero(kind: DecimalKind): string {
  return new Decimal(0).toFixed(DECIMAL_SCALES[kind]);
}

export function sum(values: readonly string[], kind: DecimalKind): string {
  return fromDecimal(
    values.reduce<Decimal>((acc, v) => acc.plus(new Decimal(v)), new Decimal(0)),
    kind,
  );
}
