// The grid on the convert page: one column per delivery, one row per quote line, with what is ordered so far.
// Each delivery becomes its own order: see the one-delivery-date-per-order entry in docs/decisions/README.md.
import {
  CREATE_ORDERS_MAX_DELIVERIES,
  columnCeiling,
  formatMoney,
  requestedRollsSchema,
  toDecimal,
  toMeasure,
  type Order,
  type OrderLine,
  type QuoteLine,
} from '@erp/types';

import { ECHO_PREFIX, echoFits } from '../../../../../lib/form-echo';
import { formatOrderedPounds } from '../../../../../lib/measures';
import { formatPricePerPound } from '../../../../../lib/price-per-pound';

export const DELIVERIES_FIELD = 'deliveries';

function suffix(column: number): string {
  return column === 1 ? '' : `.${String(column)}`;
}

export const convertField = {
  date: (column = 1) => `requestedDate${suffix(column)}`,
  rolls: (quoteLineId: string, column = 1) => `rolls.${quoteLineId}${suffix(column)}`,
  pounds: (quoteLineId: string, column = 1) => `pounds.${quoteLineId}${suffix(column)}`,
} as const;

export function isConvertField(name: string): boolean {
  return (
    name === 'quoteId' ||
    name === 'poNumber' ||
    name === 'requestedDate' ||
    name.startsWith('requestedDate.') ||
    name.startsWith('rolls.') ||
    name.startsWith('pounds.')
  );
}

const LONGEST = {
  poNumber: '/'.repeat(64),
  date: '2026-12-31',
  rolls: String(requestedRollsSchema.maxValue ?? 0),
  pounds: columnCeiling('measure'),
} as const;

function fullestEcho(
  lines: readonly Pick<GridLine, 'quoteLineId' | 'perPound'>[],
  columns: number,
): Record<string, string> {
  const echo: Record<string, string> = {
    [`${ECHO_PREFIX}quoteId`]: '0'.repeat(36),
    [`${ECHO_PREFIX}poNumber`]: LONGEST.poNumber,
  };
  for (let column = 1; column <= columns; column += 1) {
    echo[`${ECHO_PREFIX}${convertField.date(column)}`] = LONGEST.date;
    for (const line of lines) {
      echo[`${ECHO_PREFIX}${convertField.rolls(line.quoteLineId, column)}`] = LONGEST.rolls;
      if (line.perPound) {
        echo[`${ECHO_PREFIX}${convertField.pounds(line.quoteLineId, column)}`] = LONGEST.pounds;
      }
    }
  }
  return echo;
}

/**
 * How many delivery columns this page may hold: the most whose fullest possible form still fits in a
 * redirect URL as an echo (apps/web/src/lib/form-echo.ts). A refused post can then always be drawn
 * again with what was typed. `CREATE_ORDERS_MAX_DELIVERIES` caps it as well.
 */
export function maxDeliveries(
  lines: readonly Pick<GridLine, 'quoteLineId' | 'perPound'>[],
): number {
  let columns = 1;
  while (columns < CREATE_ORDERS_MAX_DELIVERIES && echoFits(fullestEcho(lines, columns + 1))) {
    columns += 1;
  }
  return columns;
}

export function deliveryCount(raw: unknown, max: number): number {
  const count = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : 1;
  return Math.min(Math.max(count, 1), Math.max(max, 1));
}

export function columnsOf(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

export const AT_CAPACITY =
  'That is as many deliveries as one page can hold. Create these, then press Create another order on the quote for the rest.';

export function convertPageUrl(
  quoteId: string,
  columns: number,
  echo: Readonly<Record<string, string>>,
): string {
  const query = new URLSearchParams({ [DELIVERIES_FIELD]: String(columns), ...echo }).toString();
  return `/quoting/quotes/${encodeURIComponent(quoteId)}/convert?${query}#deliveries`;
}

export function withoutDelivery(
  values: Readonly<Record<string, string>>,
  lines: readonly Pick<GridLine, 'quoteLineId'>[],
  columns: number,
  removed: number,
): Record<string, string> {
  const names = (column: number): string[] => [
    convertField.date(column),
    ...lines.flatMap((line) => [
      convertField.rolls(line.quoteLineId, column),
      convertField.pounds(line.quoteLineId, column),
    ]),
  ];
  const next: Record<string, string> = { ...values };
  for (let column = removed; column <= columns; column += 1) {
    for (const name of names(column)) delete next[name];
  }
  for (let column = removed + 1; column <= columns; column += 1) {
    const from = names(column);
    const to = names(column - 1);
    from.forEach((name, index) => {
      const value = values[name];
      const target = to[index];
      if (value !== undefined && target !== undefined) next[target] = value;
    });
  }
  return next;
}

export interface SoFar {
  readonly rolls: number;

  readonly pounds: string;
}

/**
 * What existing orders already hold of each quote line, keyed by quote line id. Pounds are summed as
 * decimals and returned at measure scale: docs/decisions/003-decimal-arithmetic.md.
 */
export function orderedSoFar(
  orders: readonly Pick<Order, 'id'>[],
  linesByOrder: ReadonlyMap<
    string,
    readonly Pick<OrderLine, 'quoteLineId' | 'quantityRolls' | 'orderedWeightLb'>[]
  >,
): ReadonlyMap<string, SoFar> {
  const sums = new Map<string, { rolls: number; pounds: ReturnType<typeof toDecimal> }>();
  for (const order of orders) {
    for (const line of linesByOrder.get(order.id) ?? []) {
      if (line.quoteLineId === undefined) continue;
      const sum = sums.get(line.quoteLineId) ?? { rolls: 0, pounds: toDecimal('0') };
      sums.set(line.quoteLineId, {
        rolls: sum.rolls + line.quantityRolls,
        pounds:
          line.orderedWeightLb === undefined
            ? sum.pounds
            : sum.pounds.plus(toDecimal(line.orderedWeightLb)),
      });
    }
  }
  return new Map(
    [...sums].map(([id, sum]) => [id, { rolls: sum.rolls, pounds: toMeasure(sum.pounds) }]),
  );
}

export interface GridLine {
  readonly quoteLineId: string;
  readonly lineNumber: number;
  readonly perPound: boolean;
  readonly quotedRolls: number;

  readonly quotedPounds: string | undefined;

  readonly soFar: SoFar | undefined;
}

export function gridLines(
  quoteLines: readonly Pick<
    QuoteLine,
    'id' | 'lineNumber' | 'pricingBasis' | 'quantityRolls' | 'orderedWeightLb'
  >[],
  soFar: ReadonlyMap<string, SoFar>,
): GridLine[] {
  return [...quoteLines]
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((line) => {
      const perPound = line.pricingBasis === 'per_pound';
      return {
        quoteLineId: line.id,
        lineNumber: line.lineNumber,
        perPound,
        quotedRolls: line.quantityRolls,
        quotedPounds: perPound ? line.orderedWeightLb : undefined,
        soFar: soFar.get(line.id),
      };
    });
}

export function quotedPriceWords(
  line: Pick<QuoteLine, 'pricingBasis' | 'pricePerRoll' | 'productPricePerLb'>,
): string {
  return line.pricingBasis === 'per_pound' && line.productPricePerLb !== undefined
    ? `${formatPricePerPound(line.productPricePerLb)} / lb`
    : `${formatMoney(line.pricePerRoll)}/roll`;
}

function boxPounds(value: ReturnType<typeof toDecimal>): string {
  return formatOrderedPounds(toMeasure(value)).replace(/,/g, '');
}

export interface Boxes {
  readonly rolls: string;

  readonly pounds: string;
}

export function startingBoxes(line: GridLine): Boxes {
  const rollsLeft = line.quotedRolls - (line.soFar?.rolls ?? 0);
  const poundsLeft =
    line.perPound && line.quotedPounds !== undefined
      ? toDecimal(line.quotedPounds).minus(toDecimal(line.soFar?.pounds ?? '0'))
      : toDecimal('0');
  return {
    rolls: rollsLeft > 0 ? String(rollsLeft) : '',
    pounds: poundsLeft.gt(0) ? boxPounds(poundsLeft) : '',
  };
}

const EMPTY_BOXES: Boxes = { rolls: '', pounds: '' };

export function boxesFor(
  line: GridLine,
  echo: Readonly<Record<string, string>>,
  fromEcho: boolean,
  column = 1,
): Boxes {
  if (!fromEcho) return column === 1 ? startingBoxes(line) : EMPTY_BOXES;
  return {
    rolls: echo[convertField.rolls(line.quoteLineId, column)] ?? '',
    pounds: echo[convertField.pounds(line.quoteLineId, column)] ?? '',
  };
}

const WHOLE = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

function typed(text: string, pattern: RegExp): ReturnType<typeof toDecimal> | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return toDecimal('0');
  return pattern.test(trimmed) ? toDecimal(trimmed) : undefined;
}

function typedSum(
  texts: readonly string[],
  pattern: RegExp,
): ReturnType<typeof toDecimal> | undefined {
  let total = toDecimal('0');
  for (const text of texts) {
    const figure = typed(text, pattern);
    if (figure === undefined) return undefined;
    total = total.plus(figure);
  }
  return total;
}

function overBy(
  line: GridLine,
  rolls: ReturnType<typeof toDecimal> | undefined,
  pounds: ReturnType<typeof toDecimal> | undefined,
): string | undefined {
  const parts: string[] = [];
  if (rolls !== undefined) {
    const over = rolls.plus(line.soFar?.rolls ?? 0).minus(line.quotedRolls);
    if (over.gt(0)) {
      parts.push(`${over.toFixed(0)} roll${over.eq(1) ? '' : 's'}`);
    }
  }
  if (line.perPound && line.quotedPounds !== undefined && pounds !== undefined) {
    const over = pounds
      .plus(toDecimal(line.soFar?.pounds ?? '0'))
      .minus(toDecimal(line.quotedPounds));
    if (over.gt(0)) {
      parts.push(`${formatOrderedPounds(toMeasure(over))} lb`);
    }
  }
  return parts.length === 0 ? undefined : parts.join(' and ');
}

/**
 * Ordering more than was quoted is allowed. These words only point it out. When any box is not a
 * number, that quantity is not compared, because building the request refuses the box itself.
 */
export function overWords(line: GridLine, boxes: readonly Boxes[]): string | undefined {
  const by = overBy(
    line,
    typedSum(
      boxes.map((box) => box.rolls),
      WHOLE,
    ),
    typedSum(
      boxes.map((box) => box.pounds),
      DECIMAL,
    ),
  );
  return by === undefined ? undefined : `${by} over the quoted quantity`;
}

export function overNotice(
  lines: readonly GridLine[],
  ordered: readonly { quoteLineId: string; quantityRolls: number; orderedWeightLb?: string }[],
): string | undefined {
  const sentences = lines.flatMap((line) => {
    const asked = ordered.filter((entry) => entry.quoteLineId === line.quoteLineId);
    if (asked.length === 0) return [];
    const pounds = asked.flatMap((entry) =>
      entry.orderedWeightLb === undefined ? [] : [toDecimal(entry.orderedWeightLb)],
    );
    const by = overBy(
      line,
      asked.reduce((sum, entry) => sum.plus(entry.quantityRolls), toDecimal('0')),
      pounds.length === 0 ? undefined : pounds.reduce((sum, value) => sum.plus(value)),
    );
    return by === undefined
      ? []
      : [`Line ${String(line.lineNumber)} is ${by} over the quoted quantity.`];
  });
  return sentences.length === 0 ? undefined : sentences.join(' ');
}
