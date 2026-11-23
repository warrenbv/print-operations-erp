// OrderService on the in-memory adapter: conversion, the lines chosen on Create orders, confirmation,
// the PO, what may reach a customer, Production Manager alerts and stale writes.
import type {
  CapturePurchaseOrderRequest,
  Order,
  OrderLine,
  OrderWithLines,
  StoredDocument,
} from '@erp/types';
import { toDecimal, toMoney } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { newId, StaleAggregateError } from '@erp/db';

import { InMemoryOrderRepository } from '../src/adapters/in-memory/in-memory-order-repository';
import { InvalidOrderTransitionError } from '../src/order-state-machine';
import {
  EmptyQuoteError,
  PerPoundLineNeedsRollWeightError,
  MissingConfirmationDetailsError,
  NoConfirmationRecipientError,
  NoProductionManagerError,
  OrderNotConfirmedError,
  OrderedWeightOnPerRollQuoteLineError,
  PerPoundLineNeedsPoundsError,
  UnknownQuoteError,
  UnknownQuoteLineError,
  type OrderConfirmationNotifier,
  type OrderReceivedNotifier,
  type NewOrderLine,
  type QuoteLookup,
} from '../src/ports';
import { OrderService } from '../src/services/order-service';

const clock = { now: () => new Date('2026-08-07T09:00:00.000Z') };

const QUOTE_ID = '01988a00-0100-7000-8000-000000000001';
const CUSTOMER_ID = '01988a00-0200-7000-8000-000000000001';
const QUOTE_LINE_ID = '01988a00-0371-7000-8000-000000000001';
const GRADE_ID = '01988a00-0400-7000-8000-000000000001';

const quoteLineFor = (lineNumber: number): string =>
  `01988a00-0371-7000-8000-00000000000${lineNumber}`;

const CONVERTIBLE_LINE: NewOrderLine = {
  lineNumber: 1,
  quoteLineId: QUOTE_LINE_ID,

  pricingBasis: 'per_roll',
  gradeId: GRADE_ID,
  footageVariant: 'long',

  feetPerRoll: '1385.0000',
  rollWidthIn: 12,
  quantityRolls: 10,
  overwrap: false,
  pallets: 1,
  estimatedWeightLb: '530.0000',

  revenueCategory: 'print',
  printed: false,
  taxStatus: 'id_tax',
  taxJurisdiction: 'ID',
  pricePerRoll: '37.8000',

  totalCostPerRoll: '27.5000',
  extendedPrice: '378.0000',
  extendedCost: '275.0000',
  extendedMargin: '103.0000',
  freight: { mode: 'pickup' },
  freightResult: {
    mode: 'pickup',
    cost: '0.0000',
    margin: '0.0000',
    invoiceTotal: '0.0000',
    pending: false,
  },
};

const PER_POUND_LINE: NewOrderLine = {
  ...CONVERTIBLE_LINE,
  pricingBasis: 'per_pound',
  productPricePerLb: '0.7234',

  orderedWeightLb: '500.0000',
  rollWeightLb: '57.3000',
};

function withoutFeetPerRoll(line: NewOrderLine): NewOrderLine {
  const copy = { ...line };
  delete copy.feetPerRoll;
  return copy;
}

function quoteLookup(
  quotes: Record<
    string,
    { customerId: string; salesRep?: string; lines: readonly NewOrderLine[] }
  > = {
    [QUOTE_ID]: { customerId: CUSTOMER_ID, lines: [CONVERTIBLE_LINE] },
  },
): QuoteLookup {
  return {
    async findConvertible(quoteId) {
      const quote = quotes[quoteId];
      return quote === undefined ? null : { id: quoteId, ...quote };
    },
  };
}

const QUOTED_BY_JSMITH = {
  customerId: CUSTOMER_ID,
  salesRep: 'jsmith',
  lines: [CONVERTIBLE_LINE],
} as const;

const CONVERTED_BY = { actor: 'aclark' } as const;

function makeService(
  lookup: QuoteLookup = quoteLookup(),
  orders: InMemoryOrderRepository = new InMemoryOrderRepository(),
) {
  return new OrderService({
    orders,
    quotes: lookup,
    clock,
  });
}

describe('createFromQuote', () => {
  it('creates an order in converted, not draft', async () => {
    const order = await makeService().createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order.status).toBe('converted');
    expect(order.quoteId).toBe(QUOTE_ID);
  });

  it('takes the customer from the quote, not from the caller', async () => {
    const order = await makeService().createFromQuote(
      {
        quoteId: QUOTE_ID,
        // @ts-expect-error -- intentional
        customerId: 'somebody-else',
      },
      CONVERTED_BY,
    );

    expect(order.customerId).toBe(CUSTOMER_ID);
  });

  it('carries the pricing basis and the price per pound across', async () => {
    const service = makeService(
      quoteLookup({
        [QUOTE_ID]: {
          customerId: CUSTOMER_ID,
          lines: [
            {
              ...CONVERTIBLE_LINE,
              pricingBasis: 'per_pound',
              productPricePerLb: '0.7234',
              orderedWeightLb: '500.0000',
              rollWeightLb: '44.6000',
            },
          ],
        },
      }),
    );

    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order.lines[0]?.pricingBasis).toBe('per_pound');
    expect(order.lines[0]?.productPricePerLb).toBe('0.7234');

    expect(order.lines[0]?.orderedWeightLb).toBe('500.0000');

    expect(order.lines[0]?.quantityRolls).toBe(CONVERTIBLE_LINE.quantityRolls);
    expect(order.lines[0]?.pricePerRoll).toBe(CONVERTIBLE_LINE.pricePerRoll);
  });

  it('converts a per-roll line with no price per pound', async () => {
    const order = await makeService().createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order.lines[0]?.pricingBasis).toBe('per_roll');
    expect(order.lines[0]?.productPricePerLb).toBeUndefined();
  });

  it('refuses a per-pound line that carries no roll weight', async () => {
    const weightless = { ...CONVERTIBLE_LINE };
    delete weightless.rollWeightLb;
    const service = makeService(
      quoteLookup({
        [QUOTE_ID]: {
          customerId: CUSTOMER_ID,
          lines: [{ ...weightless, pricingBasis: 'per_pound', productPricePerLb: '0.7234' }],
        },
      }),
    );

    await expect(service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY)).rejects.toThrow(
      PerPoundLineNeedsRollWeightError,
    );
    await expect(service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY)).rejects.toThrow(
      /line 1/,
    );
  });

  it('still converts a PER-ROLL line that carries no roll weight', async () => {
    const weightless = { ...CONVERTIBLE_LINE };
    delete weightless.rollWeightLb;
    const service = makeService(
      quoteLookup({
        [QUOTE_ID]: { customerId: CUSTOMER_ID, lines: [weightless] },
      }),
    );

    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    expect(order.lines[0]?.rollWeightLb).toBeUndefined();
    expect(order.lines[0]?.pricingBasis).toBe('per_roll');
  });

  it('refuses a quote that does not exist', async () => {
    await expect(makeService().createFromQuote({ quoteId: 'nope' }, CONVERTED_BY)).rejects.toThrow(
      UnknownQuoteError,
    );
  });

  it('converts the same quote again, at the prices the quote still holds', async () => {
    const service = makeService();
    const first = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    const second = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(second.id).not.toBe(first.id);
    expect(second.quoteId).toBe(first.quoteId);

    expect(second.lines.map((line) => line.pricePerRoll)).toEqual(
      first.lines.map((line) => line.pricePerRoll),
    );
    expect(second.lines.map((line) => line.quoteLineId)).toEqual(
      first.lines.map((line) => line.quoteLineId),
    );

    expect(second.poNumber).toBeUndefined();
    expect(second.confirmedLeadTimeDays).toBeUndefined();
  });

  it('opens the history with a null from-state', async () => {
    const service = makeService(quoteLookup({ [QUOTE_ID]: { ...QUOTED_BY_JSMITH } }));
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    const history = await service.history(order.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: null, to: 'converted', actor: 'aclark' });
  });

  it('credits the user who converted, not the rep who sold the quote', async () => {
    const service = makeService(quoteLookup({ [QUOTE_ID]: { ...QUOTED_BY_JSMITH } }));

    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, { actor: 'aclark' });

    expect(order.salesRep).toBe('jsmith');
    expect((await service.history(order.id))[0]).toMatchObject({ actor: 'aclark' });
  });

  it('carries the sales rep from the quote', async () => {
    const service = makeService(quoteLookup({ [QUOTE_ID]: { ...QUOTED_BY_JSMITH } }));

    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order.salesRep).toBe('jsmith');
  });

  it('takes the rep from the quote, not from the caller', async () => {
    const service = makeService(quoteLookup({ [QUOTE_ID]: { ...QUOTED_BY_JSMITH } }));

    const order = await service.createFromQuote(
      {
        quoteId: QUOTE_ID,
        // @ts-expect-error -- intentional
        salesRep: 'somebody-else',
      },
      CONVERTED_BY,
    );

    expect(order.salesRep).toBe('jsmith');
  });

  it('leaves the rep off an order whose quote named nobody', async () => {
    const service = makeService();

    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order).not.toHaveProperty('salesRep');
    expect((await service.history(order.id))[0]).toMatchObject({ actor: 'aclark' });
  });

  it('creates the order holding the delivery date it was given, with no change row', async () => {
    const service = makeService();

    const order = await service.createFromQuote(
      { quoteId: QUOTE_ID, requestedDate: '2027-06-10' },
      CONVERTED_BY,
    );

    expect(order.requestedDate).toBe('2027-06-10');
    expect((await service.findById(order.id))?.requestedDate).toBe('2027-06-10');
    expect(await service.history(order.id)).toHaveLength(1);
  });

  it('leaves the delivery date off an order converted without one', async () => {
    const order = await makeService().createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order).not.toHaveProperty('requestedDate');
  });

  it('answers with the generation the order is actually AT, not the one it was created at', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    const stored = await service.findById(order.id);
    expect(order.lockVersion).toBe(stored?.lockVersion);
  });

  it('mints a UUIDv7 id distinct from the quote/s', async () => {
    const order = await makeService().createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    expect(order.id).not.toBe(QUOTE_ID);
    expect(order.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it('copies the effective feet per roll, override included', async () => {
    const order = await makeService().createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order.lines[0]?.feetPerRoll).toBe('1385.0000');
  });

  it('leaves feet per roll absent when the quote line has none', async () => {
    const lookup = quoteLookup({
      [QUOTE_ID]: { customerId: CUSTOMER_ID, lines: [withoutFeetPerRoll(CONVERTIBLE_LINE)] },
    });

    const order = await makeService(lookup).createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order.lines[0]).not.toHaveProperty('feetPerRoll');
  });

  it('carries a null pallet count across, never a zero', async () => {
    const lookup = quoteLookup({
      [QUOTE_ID]: { customerId: CUSTOMER_ID, lines: [{ ...CONVERTIBLE_LINE, pallets: null }] },
    });

    const order = await makeService(lookup).createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order.lines[0]?.pallets).toBeNull();
  });

  it('copies the quote/s lines rather than referencing them', async () => {
    const order = await makeService().createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({
      orderId: order.id,
      quoteLineId: QUOTE_LINE_ID,
      lineNumber: 1,

      extendedPrice: '378.0000',
      extendedCost: '275.0000',
    });

    expect(order.lines[0]?.id).not.toBe(QUOTE_LINE_ID);
  });

  it('refuses a convertible quote that has no lines', async () => {
    const empty = quoteLookup({ [QUOTE_ID]: { customerId: CUSTOMER_ID, lines: [] } });

    await expect(
      makeService(empty).createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY),
    ).rejects.toThrow(EmptyQuoteError);
  });

  it('writes no order at all when the lines are refused', async () => {
    const empty = quoteLookup({ [QUOTE_ID]: { customerId: CUSTOMER_ID, lines: [] } });
    const service = makeService(empty);

    await expect(service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY)).rejects.toThrow(
      EmptyQuoteError,
    );
    expect(await service.list()).toHaveLength(0);
  });

  it('records a PO number given at conversion, signed by the converter', async () => {
    const service = makeService();
    const order = await service.createFromQuote(
      { quoteId: QUOTE_ID, poNumber: 'approved by customer' },
      CONVERTED_BY,
    );

    expect(order).toMatchObject({
      poNumber: 'approved by customer',
      poCapturedBy: CONVERTED_BY.actor,
    });
  });

  it('records no PO when none is given', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    expect(order.poNumber).toBeUndefined();
    expect(order.poCapturedBy).toBeUndefined();
  });
});

describe('createFromQuote, the lines chosen on Create orders', () => {
  const LINE_1: NewOrderLine = { ...CONVERTIBLE_LINE, lineNumber: 1, quoteLineId: quoteLineFor(1) };
  const LINE_2: NewOrderLine = { ...PER_POUND_LINE, lineNumber: 2, quoteLineId: quoteLineFor(2) };
  const LINE_3: NewOrderLine = {
    ...CONVERTIBLE_LINE,
    lineNumber: 3,
    quoteLineId: quoteLineFor(3),
    freight: { mode: 'our_vehicle' },
    freightResult: {
      mode: 'our_vehicle',
      cost: '41.0000',
      margin: '0.0000',
      invoiceTotal: '41.0000',
      pending: false,
    },
    extendedPrice: '419.0000',
    extendedCost: '316.0000',
    extendedMargin: '103.0000',
  };

  const threeLines = (): OrderService =>
    makeService(
      quoteLookup({ [QUOTE_ID]: { customerId: CUSTOMER_ID, lines: [LINE_1, LINE_2, LINE_3] } }),
    );

  function asHandedOver(line: OrderLine): Partial<OrderLine> {
    const copy: Partial<OrderLine> = { ...line };
    delete copy.id;
    delete copy.orderId;
    delete copy.createdAt;
    delete copy.updatedAt;
    return copy;
  }

  it('copies every line named at the quote quantity field for field, nothing worked out again', async () => {
    const order = await threeLines().createFromQuote(
      {
        quoteId: QUOTE_ID,
        lines: [
          { quoteLineId: quoteLineFor(1), quantityRolls: 10 },
          { quoteLineId: quoteLineFor(2), quantityRolls: 10, orderedWeightLb: '500' },
          { quoteLineId: quoteLineFor(3), quantityRolls: 10 },
        ],
      },
      CONVERTED_BY,
    );

    expect(order.lines.map(asHandedOver)).toEqual([LINE_1, LINE_2, LINE_3]);
  });

  it('puts only the named lines on the order, each keeping its quote line number', async () => {
    const order = await threeLines().createFromQuote(
      {
        quoteId: QUOTE_ID,
        lines: [
          { quoteLineId: quoteLineFor(3), quantityRolls: 10 },
          { quoteLineId: quoteLineFor(1), quantityRolls: 10 },
        ],
      },
      CONVERTED_BY,
    );

    expect(order.lines.map((line) => line.lineNumber)).toEqual([1, 3]);
    expect(order.lines.map((line) => line.quoteLineId)).toEqual([quoteLineFor(1), quoteLineFor(3)]);
  });

  it('works a cut line out again at its committed prices, freight as stored', async () => {
    const order = await threeLines().createFromQuote(
      { quoteId: QUOTE_ID, lines: [{ quoteLineId: quoteLineFor(3), quantityRolls: 4 }] },
      CONVERTED_BY,
    );

    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({
      lineNumber: 3,
      quantityRolls: 4,

      pricePerRoll: LINE_3.pricePerRoll,
      totalCostPerRoll: LINE_3.totalCostPerRoll,
      freight: LINE_3.freight,
      freightResult: LINE_3.freightResult,

      extendedPrice: '192.2000',
      extendedCost: '151.0000',
      extendedMargin: '41.2000',

      estimatedWeightLb: '212.0000',
      pallets: 1,
    });
  });

  it('takes more than the quote quantity: the quoted quantity is not a ceiling', async () => {
    const order = await threeLines().createFromQuote(
      { quoteId: QUOTE_ID, lines: [{ quoteLineId: quoteLineFor(3), quantityRolls: 12 }] },
      CONVERTED_BY,
    );

    expect(order.lines[0]).toMatchObject({
      quantityRolls: 12,
      pricePerRoll: '37.8000',

      extendedPrice: '494.6000',
      extendedCost: '371.0000',
      extendedMargin: '123.6000',
      estimatedWeightLb: '636.0000',

      pallets: 2,
    });
  });

  it('works a per-pound line out at the price per pound times the new pounds, its weight following the rolls', async () => {
    const order = await threeLines().createFromQuote(
      {
        quoteId: QUOTE_ID,
        lines: [{ quoteLineId: quoteLineFor(2), quantityRolls: 7, orderedWeightLb: '300' }],
      },
      CONVERTED_BY,
    );

    expect(order.lines[0]).toMatchObject({
      lineNumber: 2,
      quantityRolls: 7,
      orderedWeightLb: '300.0000',
      productPricePerLb: '0.7234',
      pricePerRoll: PER_POUND_LINE.pricePerRoll,

      extendedPrice: toMoney(toDecimal('0.7234').times(300)),
      extendedCost: '192.5000',
      extendedMargin: toMoney(toDecimal('0.7234').times(300).minus(192.5)),

      estimatedWeightLb: '401.1000',
    });
  });

  it('refuses a quote line that is not on the quote, and makes no order', async () => {
    const service = threeLines();
    const unknown = '01988a00-0371-7000-8000-0000000000ff';

    await expect(
      service.createFromQuote(
        { quoteId: QUOTE_ID, lines: [{ quoteLineId: unknown, quantityRolls: 2 }] },
        CONVERTED_BY,
      ),
    ).rejects.toThrow(UnknownQuoteLineError);
    expect(await service.list()).toHaveLength(0);
  });

  it('refuses pounds on a line sold by the roll, and makes no order', async () => {
    const service = threeLines();

    await expect(
      service.createFromQuote(
        {
          quoteId: QUOTE_ID,
          lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 2, orderedWeightLb: '90' }],
        },
        CONVERTED_BY,
      ),
    ).rejects.toThrow(OrderedWeightOnPerRollQuoteLineError);
    expect(await service.list()).toHaveLength(0);
  });

  it('refuses a per-pound line named without its pounds, naming the line, and makes no order', async () => {
    const service = threeLines();
    const refused = service.createFromQuote(
      { quoteId: QUOTE_ID, lines: [{ quoteLineId: quoteLineFor(2), quantityRolls: 5 }] },
      CONVERTED_BY,
    );

    await expect(refused).rejects.toThrow(PerPoundLineNeedsPoundsError);
    await expect(refused).rejects.toMatchObject({ lineNumber: 2, quoteLineId: quoteLineFor(2) });
    expect(await service.list()).toHaveLength(0);
  });

  it('asks for a roll weight only of the per-pound lines going on the order', async () => {
    const weightless: NewOrderLine = { ...LINE_2 };
    delete weightless.rollWeightLb;
    const service = makeService(
      quoteLookup({ [QUOTE_ID]: { customerId: CUSTOMER_ID, lines: [LINE_1, weightless] } }),
    );

    const lineOneOnly = await service.createFromQuote(
      { quoteId: QUOTE_ID, lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 10 }] },
      CONVERTED_BY,
    );
    expect(lineOneOnly.lines.map((line) => line.lineNumber)).toEqual([1]);

    await expect(
      service.createFromQuote(
        {
          quoteId: QUOTE_ID,
          lines: [{ quoteLineId: quoteLineFor(2), quantityRolls: 10, orderedWeightLb: '500' }],
        },
        CONVERTED_BY,
      ),
    ).rejects.toThrow(PerPoundLineNeedsRollWeightError);
  });
});

describe('createOrdersFromQuote, one order per delivery date in one press', () => {
  const LINE_1: NewOrderLine = { ...CONVERTIBLE_LINE, lineNumber: 1, quoteLineId: quoteLineFor(1) };
  const LINE_2: NewOrderLine = { ...PER_POUND_LINE, lineNumber: 2, quoteLineId: quoteLineFor(2) };
  const JUNE = '2027-06-10';
  const JULY = '2027-07-15';

  const twoLines = (
    lines: readonly NewOrderLine[] = [LINE_1, LINE_2],
    orders = new InMemoryOrderRepository(),
  ): OrderService =>
    makeService(
      quoteLookup({ [QUOTE_ID]: { customerId: CUSTOMER_ID, salesRep: 'jsmith', lines } }),
      orders,
    );

  it('makes one order per delivery, each with its date, its lines and the one PO number', async () => {
    const service = twoLines();
    const made = await service.createOrdersFromQuote(
      {
        quoteId: QUOTE_ID,
        poNumber: 'PO 6082417',
        deliveries: [
          { requestedDate: JUNE, lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 10 }] },
          {
            requestedDate: JULY,
            lines: [{ quoteLineId: quoteLineFor(2), quantityRolls: 6, orderedWeightLb: '300' }],
          },
        ],
      },
      CONVERTED_BY,
    );

    expect(made).toHaveLength(2);
    const [june, july] = made;
    expect(june).toMatchObject({
      requestedDate: JUNE,
      poNumber: 'PO 6082417',
      status: 'converted',
    });
    expect(july).toMatchObject({
      requestedDate: JULY,
      poNumber: 'PO 6082417',
      status: 'converted',
    });

    expect(june?.lines.map((line) => [line.lineNumber, line.quantityRolls])).toEqual([[1, 10]]);
    expect(july?.lines[0]).toMatchObject({
      lineNumber: 2,
      quantityRolls: 6,
      orderedWeightLb: '300.0000',
    });

    expect((await service.list({ quoteIds: [QUOTE_ID] })).map((order) => order.id).sort()).toEqual(
      [june?.id, july?.id].sort(),
    );
  });

  it("takes each order's customer and rep from the quote, and the PO's typist from the session", async () => {
    const made = await twoLines().createOrdersFromQuote(
      {
        quoteId: QUOTE_ID,
        poNumber: 'PO 6082417',
        deliveries: [
          { requestedDate: JUNE, lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 4 }] },
          { requestedDate: JULY, lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 6 }] },
        ],
      },
      CONVERTED_BY,
    );

    for (const order of made) {
      expect(order).toMatchObject({
        customerId: CUSTOMER_ID,
        salesRep: 'jsmith',
        poCapturedBy: CONVERTED_BY.actor,
      });
    }
  });

  it('writes each order its opening history row, by the person converting', async () => {
    const service = twoLines();
    const made = await service.createOrdersFromQuote(
      {
        quoteId: QUOTE_ID,
        deliveries: [
          { requestedDate: JUNE, lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 4 }] },
          { requestedDate: JULY, lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 6 }] },
        ],
      },
      CONVERTED_BY,
    );

    for (const order of made) {
      expect(order).not.toHaveProperty('poNumber');
      expect(await service.history(order.id)).toEqual([
        expect.objectContaining({
          orderId: order.id,
          from: null,
          to: 'converted',
          reason: 'converted from quote',
          actor: CONVERTED_BY.actor,
        }),
      ]);
    }
  });

  it('refuses a bad second delivery before anything is written, so no order is made', async () => {
    const service = twoLines();
    const refused = service.createOrdersFromQuote(
      {
        quoteId: QUOTE_ID,
        deliveries: [
          { requestedDate: JUNE, lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 10 }] },

          { requestedDate: JULY, lines: [{ quoteLineId: quoteLineFor(2), quantityRolls: 5 }] },
        ],
      },
      CONVERTED_BY,
    );

    await expect(refused).rejects.toThrow(PerPoundLineNeedsPoundsError);
    await expect(refused).rejects.toMatchObject({ lineNumber: 2 });
    expect(await service.list()).toHaveLength(0);
  });

  it('asks every delivery for its roll weight before the first order is written', async () => {
    const weightless: NewOrderLine = { ...LINE_2 };
    delete weightless.rollWeightLb;
    const service = twoLines([LINE_1, weightless]);

    await expect(
      service.createOrdersFromQuote(
        {
          quoteId: QUOTE_ID,
          deliveries: [
            { requestedDate: JUNE, lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 10 }] },
            {
              requestedDate: JULY,
              lines: [{ quoteLineId: quoteLineFor(2), quantityRolls: 5, orderedWeightLb: '250' }],
            },
          ],
        },
        CONVERTED_BY,
      ),
    ).rejects.toThrow(PerPoundLineNeedsRollWeightError);
    expect(await service.list()).toHaveLength(0);
  });

  it('refuses a quote that does not convert, making nothing', async () => {
    const service = twoLines();
    await expect(
      service.createOrdersFromQuote(
        {
          quoteId: '01988a00-0100-7000-8000-0000000000ff',
          deliveries: [
            { requestedDate: JUNE, lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 1 }] },
            { requestedDate: JULY, lines: [{ quoteLineId: quoteLineFor(1), quantityRolls: 1 }] },
          ],
        },
        CONVERTED_BY,
      ),
    ).rejects.toThrow(UnknownQuoteError);
    expect(await service.list()).toHaveLength(0);
  });
});

describe('totals', () => {
  it('derives the total from the stored lines', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    const totals = await service.totals(order.id);
    expect(totals).toMatchObject({
      extendedPrice: '378.0000',
      extendedCost: '275.0000',
      extendedMargin: '103.0000',
      estimatedWeightLb: '530.0000',

      freightCost: '0.0000',
      freightPending: false,
    });
  });

  it('does not add freight to a figure that already contains it', async () => {
    const withFreight = quoteLookup({
      [QUOTE_ID]: {
        customerId: CUSTOMER_ID,
        lines: [
          {
            ...CONVERTIBLE_LINE,
            extendedPrice: '419.0000',
            extendedCost: '316.0000',
            freight: { mode: 'our_vehicle', rateOverride: '41.0000' },
            freightResult: {
              mode: 'our_vehicle',
              cost: '41.0000',
              margin: '0.0000',
              invoiceTotal: '41.0000',
              pending: false,
            },
          },
        ],
      },
    });
    const service = makeService(withFreight);
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    const totals = await service.totals(order.id);

    expect(totals?.extendedPrice).toBe('419.0000');

    expect(totals?.freightInvoiceTotal).toBe('41.0000');

    expect(totals?.extendedMargin).toBe('103.0000');

    for (const figure of Object.values(totals ?? {})) {
      expect(figure).not.toBe('460.0000');
    }
    expect(totals).not.toHaveProperty('orderTotal');
  });

  it('rolls freightPending up across lines so a provisional total is flagged', async () => {
    const pendingBid = quoteLookup({
      [QUOTE_ID]: {
        customerId: CUSTOMER_ID,
        lines: [
          {
            ...CONVERTIBLE_LINE,
            freight: { mode: 'carrier' },
            freightResult: {
              mode: 'carrier',
              cost: '0.0000',
              margin: '0.0000',
              invoiceTotal: '0.0000',
              pending: true,
            },
          },
        ],
      },
    });
    const service = makeService(pendingBid);
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    const totals = await service.totals(order.id);
    expect(totals?.freightPending).toBe(true);

    expect(totals?.freightInvoiceTotal).toBe('0.0000');
  });

  it('returns null for an unknown order so the edge can 404', async () => {
    expect(await makeService().totals('no-such-order')).toBeNull();
  });

  it('omits ids that name nothing rather than inventing a zero total', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    const totals = await service.totalsByIds([order.id, 'no-such-order']);
    expect([...totals.keys()]).toEqual([order.id]);
  });

  it('groups lines by order and omits ids that name nothing', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    const byOrder = await service.linesByOrderIds([order.id, 'no-such-order', order.id]);

    expect([...byOrder.keys()]).toEqual([order.id]);
    expect(byOrder.get(order.id)?.length).toBeGreaterThan(0);

    expect(byOrder.get(order.id)?.[0]?.pricePerRoll).toBeDefined();
    expect(byOrder.get(order.id)?.[0]?.totalCostPerRoll).toBeDefined();
  });

  it('reads nothing for an empty id list', async () => {
    expect((await makeService().linesByOrderIds([])).size).toBe(0);
  });
});

const PO = {
  poNumber: 'PO-7364',
  capturedBy: 'dev-sales',
};

type Service = ReturnType<typeof makeService>;

async function currentLockVersion(service: Service, orderId: string): Promise<number> {
  const order = await service.findById(orderId);
  return order === null ? 1 : order.lockVersion;
}

async function capturePo(
  service: Service,
  orderId: string,
  po: Omit<CapturePurchaseOrderRequest, 'lockVersion'> = PO,
): Promise<OrderWithLines | null> {
  return service.capturePurchaseOrder(orderId, {
    ...po,
    lockVersion: await currentLockVersion(service, orderId),
  });
}

describe('transition', () => {
  async function confirmed() {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    await capturePo(service, order.id, PO);
    await service.transition(
      order.id,
      { to: 'confirmed' },
      { actor: 'pm', confirmedLeadTimeDays: 10 },
    );
    return { service, order };
  }

  it('walks the happy path to confirmed', async () => {
    const { service, order } = await confirmed();

    expect((await service.findById(order.id))?.status).toBe('confirmed');
    expect((await service.history(order.id)).map((t) => t.to)).toEqual(['converted', 'confirmed']);
  });

  it('refuses an illegal move and says what is legal', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    await expect(
      service.transition(order.id, { to: 'converted' }, { actor: 'pm' }),
    ).rejects.toThrow(InvalidOrderTransitionError);
  });

  it('leaves the order untouched when it refuses', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    await expect(
      service.transition(order.id, { to: 'converted' }, { actor: 'pm' }),
    ).rejects.toThrow();

    expect((await service.findById(order.id))?.status).toBe('converted');

    expect(await service.history(order.id)).toHaveLength(1);
  });

  it('requires a job number and lead time to confirm', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    await capturePo(service, order.id, PO);

    await expect(
      service.transition(order.id, { to: 'confirmed' }, { actor: 'pm' }),
    ).rejects.toThrow(MissingConfirmationDetailsError);

    await expect(
      service.transition(order.id, { to: 'confirmed' }, { actor: 'pm' }),
    ).rejects.toThrow(MissingConfirmationDetailsError);
  });

  it('confirms with no PO number and no PO document', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    const moved = await service.transition(
      order.id,
      { to: 'confirmed' },
      { actor: 'pm', confirmedLeadTimeDays: 14 },
    );
    expect(moved?.status).toBe('confirmed');
    expect(moved?.poNumber).toBeUndefined();
  });

  it('still asks for the confirmation details when there is no PO', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    await expect(
      service.transition(order.id, { to: 'confirmed' }, { actor: 'pm' }),
    ).rejects.toThrow(MissingConfirmationDetailsError);
  });

  it('mints the job number at confirmation, not before', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    expect(order).not.toHaveProperty('jobNumber');
    await capturePo(service, order.id, PO);

    const moved = await service.transition(
      order.id,
      { to: 'confirmed' },
      { actor: 'pm', confirmedLeadTimeDays: 21 },
    );

    expect(moved).toMatchObject({ jobNumber: 'DPW-00001', confirmedLeadTimeDays: 21 });
  });

  it('mints a distinct job number per confirmation', async () => {
    const otherQuoteId = '01988a00-0100-7000-8000-000000000002';
    const service = makeService(
      quoteLookup({
        [QUOTE_ID]: { customerId: CUSTOMER_ID, lines: [CONVERTIBLE_LINE] },
        [otherQuoteId]: { customerId: CUSTOMER_ID, lines: [CONVERTIBLE_LINE] },
      }),
    );
    const first = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    const second = await service.createFromQuote({ quoteId: otherQuoteId }, CONVERTED_BY);
    await capturePo(service, first.id, PO);
    await capturePo(service, second.id, { ...PO, poNumber: 'PO-OTHER' });

    const a = await service.transition(
      first.id,
      { to: 'confirmed' },
      { actor: 'pm', confirmedLeadTimeDays: 5 },
    );
    const b = await service.transition(
      second.id,
      { to: 'confirmed' },
      { actor: 'pm', confirmedLeadTimeDays: 5 },
    );

    expect(a?.jobNumber).toBe('DPW-00001');
    expect(b?.jobNumber).toBe('DPW-00002');
  });

  it('records who signed the confirmation off, and when', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    await capturePo(service, order.id, PO);

    const moved = await service.transition(
      order.id,
      { to: 'confirmed' },
      { actor: 'trish', confirmedLeadTimeDays: 14 },
    );

    expect(moved?.confirmedBy).toBe('trish');
    expect(moved?.confirmedAt).toBe(clock.now().toISOString());
  });

  it('records who moved it', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    await service.transition(
      order.id,
      { to: 'confirmed' },
      { actor: 'pmanager', confirmedLeadTimeDays: 3 },
    );

    const last = (await service.history(order.id)).at(-1);
    expect(last).toMatchObject({ from: 'converted', to: 'confirmed', actor: 'pmanager' });
  });

  it('cannot move a confirmed order again', async () => {
    const { service, order } = await confirmed();

    await expect(
      service.transition(order.id, { to: 'confirmed' }, { actor: 'pm', confirmedLeadTimeDays: 1 }),
    ).rejects.toThrow(InvalidOrderTransitionError);
  });

  it('returns null for an unknown order rather than throwing', async () => {
    expect(
      await makeService().transition('missing', { to: 'confirmed' }, { actor: 'pm' }),
    ).toBeNull();
  });
});

describe('the customer PO on an order', () => {
  it('records a PO number on a converted order and on a confirmed one', async () => {
    const service = makeService();
    const converted = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    expect((await capturePo(service, converted.id, PO))?.poNumber).toBe(PO.poNumber);

    const confirmed = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    await service.transition(
      confirmed.id,
      { to: 'confirmed' },
      { actor: 'pm', confirmedLeadTimeDays: 7 },
    );
    const late = await capturePo(service, confirmed.id, { ...PO, poNumber: 'PO-LATE' });
    expect(late).toMatchObject({ status: 'confirmed', poNumber: 'PO-LATE' });
  });

  it('answers null for an unknown order rather than refusing it', async () => {
    const service = makeService();
    expect(await capturePo(service, newId(), PO)).toBeNull();
  });
});

function notifierSpy() {
  const calls: {
    order: Order;
    document: StoredDocument;
    to: readonly string[];
    actor: string;
  }[] = [];
  const notifier: OrderConfirmationNotifier = {
    confirmationIssued: async (order, document, to, actor) => {
      calls.push({ order, document, to, actor });
      return {
        recipients: to,
        messageId: '<oc-1@example.test>',
        issuedAt: new Date('2026-08-17T16:00:00.000Z'),
      };
    },
  };
  return { notifier, calls };
}

const SENDER = { actor: 'sales-sender' };

const storedOc = {
  id: 'doc-1',
  kind: 'order_confirmation',
  filename: 'order-confirmation.pdf',
  contentType: 'application/pdf',
} as unknown as StoredDocument;

function confirmationService(emails: readonly string[] = ['ap@acme.example.test']) {
  const spy = notifierSpy();
  const service = new OrderService({
    orders: new InMemoryOrderRepository(),
    quotes: quoteLookup(),
    recipients: { emailsFor: async () => emails },
    notifier: spy.notifier,
    clock,
  });
  return { service, ...spy };
}

async function confirmedOrder(service: OrderService) {
  const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
  await capturePo(service, order.id, PO);
  await service.transition(
    order.id,
    { to: 'confirmed' },
    { actor: 'pm', confirmedLeadTimeDays: 10 },
  );
  return order;
}

describe('issueConfirmation — what may reach a customer', () => {
  it('hands the document and the resolved recipients to the notifier', async () => {
    const { service, calls } = confirmationService();
    const order = await confirmedOrder(service);

    const receipt = await service.issueConfirmation(order.id, storedOc, SENDER);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toEqual(['ap@acme.example.test']);
    expect(calls[0]?.document).toBe(storedOc);
    expect(calls[0]?.actor).toBe('sales-sender');
    expect(receipt).toMatchObject({
      recipients: ['ap@acme.example.test'],
      messageId: '<oc-1@example.test>',
    });
  });

  it('refuses before the order is confirmed — there is no job number yet', async () => {
    const { service, calls } = confirmationService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    await expect(service.issueConfirmation(order.id, storedOc, SENDER)).rejects.toThrowError(
      OrderNotConfirmedError,
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses when no contact is tagged for order confirmations, before the port is called', async () => {
    const { service, calls } = confirmationService([]);
    const order = await confirmedOrder(service);

    await expect(service.issueConfirmation(order.id, storedOc, SENDER)).rejects.toThrowError(
      NoConfirmationRecipientError,
    );
    expect(calls).toHaveLength(0);
  });

  it('returns null for an unknown order rather than throwing', async () => {
    const { service } = confirmationService();

    await expect(service.issueConfirmation('no-such-order', storedOc, SENDER)).resolves.toBeNull();
  });

  it('can re-issue a confirmation already sent', async () => {
    const { service, calls } = confirmationService();
    const order = await confirmedOrder(service);

    await service.issueConfirmation(order.id, storedOc, SENDER);
    await service.issueConfirmation(order.id, storedOc, SENDER);

    expect(calls).toHaveLength(2);
  });
});

function poNotifierSpy() {
  const calls: { order: OrderWithLines; to: readonly string[] }[] = [];
  const notifier: OrderReceivedNotifier = {
    orderReceived: async (order, to) => {
      calls.push({ order, to });
      return {
        recipients: to,
        messageId: '<po-1@example.test>',
        notifiedAt: new Date('2026-08-17T16:00:00.000Z'),
      };
    },
  };
  return { notifier, calls };
}

function poNotifyService(
  pmEmails: readonly string[] = ['pm@example.test'],

  pmWithoutEmail: readonly string[] = [],
) {
  const spy = poNotifierSpy();
  const service = new OrderService({
    orders: new InMemoryOrderRepository(),
    quotes: quoteLookup(),
    productionManagers: {
      audience: async () => ({ emails: pmEmails, withoutEmail: pmWithoutEmail }),
    },
    orderNotifier: spy.notifier,
    clock,
  });
  return { service, ...spy };
}

describe('notifyOrderReceived — telling the PMs an order is waiting', () => {
  it('tells every production manager, naming the PO number when there is one', async () => {
    const { service, calls } = poNotifyService(['pm-a@example.test', 'pm-b@example.test']);
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    await capturePo(service, order.id, PO);

    const notified = await service.notifyOrderReceived(order.id);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toEqual(['pm-a@example.test', 'pm-b@example.test']);

    expect(calls[0]?.order.poNumber).toBe(PO.poNumber);
    expect(notified?.messageId).toBe('<po-1@example.test>');
  });

  it('raises when nobody holds the role, rather than reporting a silent success', async () => {
    const { service, calls } = poNotifyService([]);
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    await capturePo(service, order.id, PO);

    await expect(service.notifyOrderReceived(order.id)).rejects.toThrowError(
      NoProductionManagerError,
    );
    expect(calls).toHaveLength(0);
  });

  it('separates a held-but-unreachable role from nobody holding it', async () => {
    const { service, calls } = poNotifyService([], ['dev-pm', 'jsmith']);
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    await capturePo(service, order.id, PO);

    await expect(service.notifyOrderReceived(order.id)).rejects.toMatchObject({
      reason: 'no-addresses',
      holdersWithoutEmail: ['dev-pm', 'jsmith'],
    });

    await expect(service.notifyOrderReceived(order.id)).rejects.toThrow(/dev-pm, jsmith/);
    expect(calls).toHaveLength(0);
  });

  it('reports no-holders when the role is genuinely unheld', async () => {
    const { service } = poNotifyService([], []);
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    await capturePo(service, order.id, PO);

    await expect(service.notifyOrderReceived(order.id)).rejects.toMatchObject({
      reason: 'no-holders',
      holdersWithoutEmail: [],
    });
  });

  it('tells them about an order with no PO at all', async () => {
    const { service, calls } = poNotifyService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);

    await expect(service.notifyOrderReceived(order.id)).resolves.not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.order.poNumber).toBeUndefined();
  });

  it('returns null for an unknown order', async () => {
    const { service } = poNotifyService();

    await expect(service.notifyOrderReceived('no-such-order')).resolves.toBeNull();
  });
});

describe('optimistic concurrency on the remaining writers', () => {
  async function converted() {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    const current = await service.findById(order.id);
    return { service, order, lockVersion: current?.lockVersion ?? 1 };
  }

  it('refuses a confirmation whose lockVersion is stale', async () => {
    const { service, order, lockVersion } = await converted();

    await expect(
      service.transition(
        order.id,
        { to: 'confirmed' },
        { actor: 'pm', confirmedLeadTimeDays: 5, expectedLockVersion: lockVersion - 1 },
      ),
    ).rejects.toThrow(StaleAggregateError);
    expect((await service.findById(order.id))?.status).toBe('converted');
  });

  it('accepts the lockVersion the caller actually read', async () => {
    const { service, order, lockVersion } = await converted();

    const moved = await service.transition(
      order.id,
      { to: 'confirmed' },
      { actor: 'pm', confirmedLeadTimeDays: 5, expectedLockVersion: lockVersion },
    );

    expect(moved?.status).toBe('confirmed');
    expect(moved?.lockVersion).toBe(lockVersion + 1);
  });

  it('checks nothing when no lockVersion is given', async () => {
    const { service, order } = await converted();

    const moved = await service.transition(
      order.id,
      { to: 'confirmed' },
      { actor: 'pm', confirmedLeadTimeDays: 5 },
    );

    expect(moved?.status).toBe('confirmed');
  });

  it('refuses the next lockVersion when the order was confirmed after the read, keeping the first confirmation', async () => {
    const orders = new InMemoryOrderRepository();
    const service = makeService(quoteLookup(), orders);
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    const read = (await service.findById(order.id))!;

    // The first confirmation lands right after the second caller's read.
    let armed = true;
    const raced = makeService(
      quoteLookup(),
      new Proxy(orders, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== 'function') return value;
          const bound = (value as (...args: unknown[]) => Promise<unknown>).bind(target);
          if (prop !== 'findById') return bound;
          return async (...args: unknown[]) => {
            const result = await bound(...args);
            if (armed) {
              armed = false;
              await service.transition(
                order.id,
                { to: 'confirmed' },
                {
                  actor: 'pm-first',
                  confirmedLeadTimeDays: 5,
                  expectedLockVersion: read.lockVersion,
                },
              );
            }
            return result;
          };
        },
      }),
    );
    await expect(
      raced.transition(
        order.id,
        { to: 'confirmed' },
        { actor: 'pm-second', confirmedLeadTimeDays: 9, expectedLockVersion: read.lockVersion + 1 },
      ),
    ).rejects.toThrow(StaleAggregateError);

    const first = await service.findById(order.id);
    expect(first?.status).toBe('confirmed');
    expect(first?.confirmedBy).toBe('pm-first');
    expect(first?.confirmedLeadTimeDays).toBe(5);
    expect(first?.lockVersion).toBe(read.lockVersion + 1);
  });

  it('404s rather than reporting staleness for an order that does not exist', async () => {
    expect(
      await makeService().transition(
        '01988a00-9999-7000-8000-000000000001',
        { to: 'confirmed' },
        { actor: 'pm', confirmedLeadTimeDays: 5, expectedLockVersion: 1 },
      ),
    ).toBeNull();
  });

  it('refuses a PO capture against a generation that has moved', async () => {
    const service = makeService();
    const order = await service.createFromQuote({ quoteId: QUOTE_ID }, CONVERTED_BY);
    const current = await service.findById(order.id);
    const lockVersion = current?.lockVersion ?? 1;
    await capturePo(service, order.id, PO);

    await expect(
      service.capturePurchaseOrder(order.id, {
        ...PO,
        poNumber: 'PO-STALE',

        lockVersion,
      }),
    ).rejects.toThrow(StaleAggregateError);

    const after = await service.findById(order.id);
    expect(after?.poNumber).toBe(PO.poNumber);
  });
});

describe('createFromQuote, one write', () => {
  // The same orders with every write other than the creation failing, as a database that goes away
  // after the order row lands would.
  function withFailingFollowUps(orders: InMemoryOrderRepository): InMemoryOrderRepository {
    return new Proxy(orders, {
      get(target, prop) {
        if (prop === 'transition' || prop === 'capturePurchaseOrder') {
          return async () => {
            throw new Error('the database went away');
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  it('never leaves an order without its opening history row and its PO', async () => {
    const orders = new InMemoryOrderRepository();
    const service = makeService(quoteLookup(), withFailingFollowUps(orders));

    const outcome = await service
      .createFromQuote({ quoteId: QUOTE_ID, poNumber: 'PO 5523190' }, CONVERTED_BY)
      .then(
        (order) => order,
        (err: unknown) => err,
      );

    const stored = await orders.list({ quoteIds: [QUOTE_ID] });
    expect(stored).toHaveLength(1);
    expect(await orders.history(stored[0]!.id)).toMatchObject([
      { from: null, to: 'converted', actor: 'aclark', reason: 'converted from quote' },
    ]);
    expect(stored[0]).toMatchObject({ poNumber: 'PO 5523190', poCapturedBy: 'aclark' });
    expect(outcome).toEqual(await orders.findWithLines(stored[0]!.id));
  });

  it('writes nothing when the order cannot be written whole', async () => {
    const orders = new InMemoryOrderRepository();
    const failing = new Proxy(orders, {
      get(target, prop) {
        if (prop === 'createMany') {
          return async () => {
            throw new Error('the opening history row was refused');
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    await expect(
      makeService(quoteLookup(), failing).createFromQuote(
        { quoteId: QUOTE_ID, poNumber: 'PO 5523191' },
        CONVERTED_BY,
      ),
    ).rejects.toThrow('the opening history row was refused');

    expect(await orders.list({ quoteIds: [QUOTE_ID] })).toEqual([]);
  });
});
