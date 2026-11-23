// Turns the convert grid into one create-order request, or one request for several deliveries.
// The order keeps the quote's prices, so only quantities and dates are read here: docs/product/requirements.md (R9).
import {
  createOrderRequestSchema,
  createOrdersRequestSchema,
  type CreateOrderLine,
  type CreateOrderRequest,
  type CreateOrdersRequest,
} from '@erp/types';

import { DELIVERY_DATE_REFUSAL } from '../../../../../lib/helptext';
import type { Boxes, GridLine } from './convert-grid';

export interface ConvertFormValues {
  readonly quoteId: string;
  readonly poNumber?: string | undefined;

  readonly requestedDate?: string | undefined;

  readonly lines: readonly GridLine[];

  readonly boxes: (line: GridLine) => Boxes;
}

export type ConvertFormOutcome =
  | { readonly ok: true; readonly request: CreateOrderRequest }
  | { readonly ok: false; readonly message: string };

export const NO_LINE_REFUSAL = 'Put at least one line on the order.';

function rollsRefusal(lineNumber: number): string {
  return `Line ${String(lineNumber)}: enter the rolls as a whole number, or leave the box empty.`;
}

function poundsRefusal(lineNumber: number): string {
  return `Line ${String(lineNumber)} is sold by the pound: enter the pounds ordered, more than 0.`;
}

const FIELD_GLOSS: Readonly<Record<string, string>> = {
  poNumber: 'The PO number can be at most 64 characters.',
  requestedDate: DELIVERY_DATE_REFUSAL,
};

const WHOLE = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

interface LineWords {
  readonly rolls: (lineNumber: number) => string;
  readonly pounds: (lineNumber: number) => string;
}

const ONE_DELIVERY: LineWords = { rolls: rollsRefusal, pounds: poundsRefusal };

function linesOf(
  gridLines: readonly GridLine[],
  boxesOf: (line: GridLine) => Boxes,
  words: LineWords,
):
  | { readonly ok: true; readonly lines: CreateOrderLine[] }
  | { readonly ok: false; readonly message: string } {
  const lines: CreateOrderLine[] = [];
  for (const line of gridLines) {
    const boxes = boxesOf(line);
    const rolls = boxes.rolls.trim();
    // An empty box or a zero leaves the line off this order.
    if (rolls === '') continue;
    if (!WHOLE.test(rolls)) {
      return { ok: false, message: words.rolls(line.lineNumber) };
    }
    if (Number(rolls) === 0) continue;
    if (!line.perPound) {
      lines.push({ quoteLineId: line.quoteLineId, quantityRolls: Number(rolls) });
      continue;
    }
    const pounds = boxes.pounds.trim();
    if (!DECIMAL.test(pounds) || Number(pounds) <= 0) {
      return { ok: false, message: words.pounds(line.lineNumber) };
    }
    lines.push({
      quoteLineId: line.quoteLineId,
      quantityRolls: Number(rolls),
      orderedWeightLb: pounds,
    });
  }
  return { ok: true, lines };
}

export function toConvertRequest(values: ConvertFormValues): ConvertFormOutcome {
  const collected = linesOf(values.lines, values.boxes, ONE_DELIVERY);
  if (!collected.ok) {
    return collected;
  }
  const { lines } = collected;
  if (lines.length === 0) {
    return { ok: false, message: NO_LINE_REFUSAL };
  }

  const parsed = createOrderRequestSchema.safeParse({
    quoteId: values.quoteId,
    ...(values.poNumber === undefined ? {} : { poNumber: values.poNumber }),
    ...(values.requestedDate === undefined ? {} : { requestedDate: values.requestedDate }),
    lines,
  });
  if (parsed.success) {
    return { ok: true, request: parsed.data };
  }
  const field = parsed.error.issues[0]?.path[0];
  const gloss = typeof field === 'string' ? FIELD_GLOSS[field] : undefined;
  return { ok: false, message: gloss ?? 'The order could not be created from these values.' };
}

export interface ConvertPressValues {
  readonly quoteId: string;
  readonly poNumber?: string | undefined;

  readonly columns: number;

  readonly date: (column: number) => string | undefined;

  readonly lines: readonly GridLine[];

  readonly boxes: (line: GridLine, column: number) => Boxes;
}

export type ConvertPressOutcome =
  | { readonly ok: true; readonly kind: 'one'; readonly request: CreateOrderRequest }
  | { readonly ok: true; readonly kind: 'several'; readonly request: CreateOrdersRequest }
  | { readonly ok: false; readonly message: string };

function deliveryRollsRefusal(column: number, lineNumber: number): string {
  return `Delivery ${String(column)}, line ${String(lineNumber)}: enter the rolls as a whole number, or leave the box empty.`;
}

function deliveryPoundsRefusal(column: number, lineNumber: number): string {
  return `Delivery ${String(column)}, line ${String(lineNumber)}: enter the pounds ordered, more than 0.`;
}

function emptyDeliveryRefusal(column: number): string {
  return `Delivery ${String(column)} has no lines. Put at least one line on it, or remove it.`;
}

function undatedDeliveryRefusal(column: number): string {
  return `Delivery ${String(column)} needs a delivery date.`;
}

function deliveryDateRefusal(column: number): string {
  const words = DELIVERY_DATE_REFUSAL.charAt(0).toLowerCase() + DELIVERY_DATE_REFUSAL.slice(1);
  return `Delivery ${String(column)}: ${words}`;
}

export function sameDateRefusal(columns: readonly number[]): string {
  const numbers = columns.map(String);
  const last = numbers.pop() ?? '';
  const named = numbers.length === 0 ? last : `${numbers.join(', ')} and ${last}`;
  const which = columns.length === 2 ? 'both' : 'them';
  return `Deliveries ${named} have the same date. Put ${which} on one delivery.`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One delivery goes to the single-order route with an optional date. Several go to the deliveries
 * route, where each needs a date and becomes its own order.
 */
export function toConvertPress(values: ConvertPressValues): ConvertPressOutcome {
  if (values.columns <= 1) {
    const one = toConvertRequest({
      quoteId: values.quoteId,
      poNumber: values.poNumber,
      requestedDate: values.date(1),
      lines: values.lines,
      boxes: (line) => values.boxes(line, 1),
    });
    return one.ok ? { ok: true, kind: 'one', request: one.request } : one;
  }

  const deliveries: { requestedDate: string; lines: CreateOrderLine[] }[] = [];
  for (let column = 1; column <= values.columns; column += 1) {
    const collected = linesOf(values.lines, (line) => values.boxes(line, column), {
      rolls: (lineNumber) => deliveryRollsRefusal(column, lineNumber),
      pounds: (lineNumber) => deliveryPoundsRefusal(column, lineNumber),
    });
    if (!collected.ok) {
      return collected;
    }
    if (collected.lines.length === 0) {
      return { ok: false, message: emptyDeliveryRefusal(column) };
    }
    const date = values.date(column)?.trim() ?? '';
    if (date === '') {
      return { ok: false, message: undatedDeliveryRefusal(column) };
    }
    if (!DATE.test(date)) {
      return { ok: false, message: deliveryDateRefusal(column) };
    }
    deliveries.push({ requestedDate: date, lines: collected.lines });
  }

  // Each order is one delivery date, so deliveries sharing a date are refused, as the request schema
  // in packages/types/src/order.ts also refuses them. The message names each shared date once.
  for (const [index, delivery] of deliveries.entries()) {
    const sharing = deliveries.flatMap((other, at) =>
      other.requestedDate === delivery.requestedDate ? [at + 1] : [],
    );
    if (sharing.length > 1 && sharing[0] === index + 1) {
      return { ok: false, message: sameDateRefusal(sharing) };
    }
  }

  const parsed = createOrdersRequestSchema.safeParse({
    quoteId: values.quoteId,
    ...(values.poNumber === undefined ? {} : { poNumber: values.poNumber }),
    deliveries,
  });
  if (parsed.success) {
    return { ok: true, kind: 'several', request: parsed.data };
  }
  const field = parsed.error.issues[0]?.path[0];
  const gloss = typeof field === 'string' ? FIELD_GLOSS[field] : undefined;
  return { ok: false, message: gloss ?? 'The orders could not be created from these values.' };
}
