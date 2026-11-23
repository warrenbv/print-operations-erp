// Tests for the conversion requests: chosen quote lines, and one order per delivery date.
import { describe, expect, it } from 'vitest';

import {
  CREATE_ORDERS_MAX_DELIVERIES,
  createOrderRequestSchema,
  createOrdersRequestSchema,
  createOrdersResponseSchema,
  orderLinesLookupResponseSchema,
} from '../src/order';

const QUOTE = '01988a00-0100-7000-8000-000000000001';
const LINE = '01988a00-0300-7000-8000-000000000001';
const OTHER = '01988a00-0300-7000-8000-000000000002';

const parse = (lines: unknown) => createOrderRequestSchema.safeParse({ quoteId: QUOTE, lines });

describe('createOrderRequestSchema, the chosen lines', () => {
  it('still takes a request with no lines, as every caller but Create orders sends', () => {
    expect(createOrderRequestSchema.safeParse({ quoteId: QUOTE }).success).toBe(true);
  });

  it('takes rolls per line, and pounds ordered where the line is sold by the pound', () => {
    const parsed = parse([
      { quoteLineId: LINE, quantityRolls: 5 },
      { quoteLineId: OTHER, quantityRolls: 6, orderedWeightLb: '600' },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('refuses zero rolls, a fraction of a roll and zero pounds: a line left off is not named', () => {
    expect(parse([{ quoteLineId: LINE, quantityRolls: 0 }]).success).toBe(false);
    expect(parse([{ quoteLineId: LINE, quantityRolls: 3.5 }]).success).toBe(false);
    expect(parse([{ quoteLineId: LINE, quantityRolls: 2, orderedWeightLb: '0' }]).success).toBe(
      false,
    );
  });

  it('refuses a roll count above the integer column, with the amendment s bound', () => {
    expect(parse([{ quoteLineId: LINE, quantityRolls: 2_147_483_648 }]).success).toBe(false);
  });

  it('refuses an empty list and the same quote line twice', () => {
    expect(parse([]).success).toBe(false);
    const twice = parse([
      { quoteLineId: LINE, quantityRolls: 4 },
      { quoteLineId: LINE, quantityRolls: 5 },
    ]);
    expect(twice.success).toBe(false);
    if (!twice.success) {
      expect(twice.error.issues[0]?.message).toBe('each quote line may appear once');
    }
  });
});

describe('createOrdersRequestSchema, one order per delivery date', () => {
  const june = { requestedDate: '2027-06-10', lines: [{ quoteLineId: LINE, quantityRolls: 5 }] };
  const july = { requestedDate: '2027-07-15', lines: [{ quoteLineId: OTHER, quantityRolls: 6 }] };
  const several = (deliveries: unknown, extra: Record<string, unknown> = {}) =>
    createOrdersRequestSchema.safeParse({ quoteId: QUOTE, deliveries, ...extra });

  it('takes two deliveries, each with its date and lines, and one PO number for both', () => {
    const parsed = several([june, july], { poNumber: 'PO 7731846' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deliveries.map((delivery) => delivery.requestedDate)).toEqual([
        '2027-06-10',
        '2027-07-15',
      ]);
    }
  });

  it('refuses one delivery, which is POST /orders, and none', () => {
    expect(several([june]).success).toBe(false);
    expect(several([]).success).toBe(false);
  });

  it('refuses two deliveries on the same date', () => {
    const parsed = several([june, { ...july, requestedDate: june.requestedDate }]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('each delivery date may appear once');
      expect(parsed.error.issues[0]?.path).toEqual(['deliveries', 1, 'requestedDate']);
    }
  });

  it('refuses a delivery with no date, or a date that is not a calendar day', () => {
    expect(several([june, { lines: july.lines }]).success).toBe(false);
    expect(several([june, { ...july, requestedDate: '15/07/2027' }]).success).toBe(false);
  });

  it('refuses a delivery with no lines, or with one quote line twice, as one order would', () => {
    expect(several([june, { ...july, lines: [] }]).success).toBe(false);
    expect(
      several([
        june,
        {
          ...july,
          lines: [
            { quoteLineId: OTHER, quantityRolls: 1 },
            { quoteLineId: OTHER, quantityRolls: 2 },
          ],
        },
      ]).success,
    ).toBe(false);
  });

  it('bounds one press at the most deliveries, each day once', () => {
    const day = (n: number) => new Date(Date.UTC(2027, 0, 1 + n)).toISOString().slice(0, 10);
    const many = (count: number) =>
      Array.from({ length: count }, (_, n) => ({ ...june, requestedDate: day(n) }));
    expect(several(many(CREATE_ORDERS_MAX_DELIVERIES)).success).toBe(true);
    expect(several(many(CREATE_ORDERS_MAX_DELIVERIES + 1)).success).toBe(false);
  });

  it('answers the orders made as items', () => {
    expect(createOrdersResponseSchema.safeParse({ items: [] }).success).toBe(true);
    expect(createOrdersResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('orderLinesLookupResponseSchema', () => {
  it('groups lines by order, as the totals lookup groups totals', () => {
    expect(orderLinesLookupResponseSchema.safeParse({ items: [] }).success).toBe(true);
    expect(
      orderLinesLookupResponseSchema.safeParse({ items: [{ orderId: QUOTE, lines: [] }] }).success,
    ).toBe(true);

    expect(orderLinesLookupResponseSchema.safeParse({ items: [{ orderId: QUOTE }] }).success).toBe(
      false,
    );
  });
});
