// What every OrderRepository adapter must do, written once and run against both adapters by
// modules/orders/test/repository-contracts.test.ts. It covers lines round-tripped at their scales,
// all-or-none order writes, the PO, list filters and sorting, job numbers, history and lockVersion.
// A failure in only one adapter means the two disagree, the defect this layer exists to catch:
// docs/process/verifying-agent-written-code.md.
import { newId } from '@erp/db';
import { orderWithLinesSchema, type Order, type OrderWithLines } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  StaleAggregateError,
  type NewOrderLine,
  type NewOrderWrite,
  type OrderRepository,
} from '../../src/ports';

async function currentLockVersion(repo: OrderRepository, orderId: string): Promise<number> {
  const order = await repo.findById(orderId);
  return order === null ? 1 : order.lockVersion;
}

type CaptureArgs = Parameters<OrderRepository['capturePurchaseOrder']>;
async function capturePo(
  repo: OrderRepository,
  id: CaptureArgs[0],
  po: CaptureArgs[1],
  updatedAt: CaptureArgs[2],
): ReturnType<OrderRepository['capturePurchaseOrder']> {
  return repo.capturePurchaseOrder(id, po, updatedAt, await currentLockVersion(repo, id));
}
export const NOW = new Date('2026-08-07T09:00:00.000Z');

export const newLine = (over: Partial<NewOrderLine & { id: string }> = {}) => ({
  id: newId(),
  lineNumber: 1,
  quoteLineId: newId(),

  gradeId: newId(),
  footageVariant: 'long',

  feetPerRoll: '1385.0000',
  rollWidthIn: 12,
  quantityRolls: 10,
  overwrap: false,
  pallets: 1,
  estimatedWeightLb: '528.5000',

  revenueCategory: 'print' as const,
  printed: false,
  taxStatus: 'id_tax' as const,
  taxJurisdiction: 'ID',

  pricingBasis: 'per_roll' as const,
  pricePerRoll: '37.8000',

  totalCostPerRoll: '23.9000',
  extendedPrice: '419.0000',
  extendedCost: '280.0000',
  extendedMargin: '139.0000',

  rollWeightLb: '52.8500',
  paperCostPerLb: '0.46266422',
  paperCostPerRoll: '24.4518',

  freight: { mode: 'our_vehicle' as const, rateOverride: '41.0000' },
  freightResult: {
    mode: 'our_vehicle' as const,
    cost: '41.0000',
    margin: '0.0000',
    invoiceTotal: '41.0000',
    pending: false,
  },
  ...over,
});

type OrderInput = Omit<NewOrderWrite, 'opening' | 'purchaseOrder'>;

export const newOrder = (over: Partial<OrderInput> = {}) => ({
  id: newId(),
  quoteId: newId(),
  customerId: newId(),
  status: 'converted' as const,
  createdAt: NOW,
  updatedAt: NOW,
  lines: [newLine()],
  ...over,
});

// The history row conversion writes with every order.
export const openingRow = (over: Partial<NewOrderWrite['opening']> = {}) => ({
  id: newId(),
  from: null,
  to: 'converted' as const,
  reason: 'converted from quote',
  actor: 'aclark',
  at: NOW.toISOString(),
  ...over,
});

// Writes one order through `createMany`, with its opening history row, as conversion does.
export async function createOrder(
  repo: OrderRepository,
  input: OrderInput,
  opening: NewOrderWrite['opening'] = openingRow(),
): Promise<OrderWithLines> {
  const [made] = await repo.createMany([{ ...input, opening }]);
  if (made === undefined) {
    throw new Error(`createMany returned no order for "${input.id}"`);
  }
  return made;
}

export function orderRepositoryContract(makeRepo: () => Promise<OrderRepository>): void {
  const LATER = new Date('2026-08-07T10:00:00.000Z');

  async function confirm(repo: OrderRepository, id: string): Promise<Order | null> {
    return repo.transition(
      id,
      'confirmed',
      {
        jobNumber: await repo.mintJobNumber(),
        confirmedLeadTimeDays: 10,
        confirmedBy: 'pm',
        confirmedAt: NOW,
      },
      { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: NOW.toISOString() },
      NOW,
    );
  }

  describe('one order, written through createMany', () => {
    it('returns the order it stored', async () => {
      const repo = await makeRepo();
      const input = newOrder({ salesRep: 'jsmith' });
      const created = await createOrder(repo, input);

      expect(created).toMatchObject({
        id: input.id,
        quoteId: input.quoteId,
        customerId: input.customerId,
        status: 'converted',
        salesRep: 'jsmith',
      });
    });

    it('omits absent optional fields rather than surfacing null', async () => {
      const repo = await makeRepo();
      const created = await createOrder(repo, newOrder());

      expect(created).not.toHaveProperty('jobNumber');
      expect(created).not.toHaveProperty('salesRep');
      expect(created).not.toHaveProperty('confirmedLeadTimeDays');
    });

    it('stores a delivery date given at creation, and its absence, as a calendar day', async () => {
      const repo = await makeRepo();
      const dated = newOrder({ requestedDate: '2027-06-10' });
      const undated = newOrder();

      expect(await createOrder(repo, dated)).toMatchObject({ requestedDate: '2027-06-10' });
      await createOrder(repo, undated);

      expect((await repo.findById(dated.id))?.requestedDate).toBe('2027-06-10');
      expect(await repo.findById(undated.id)).not.toHaveProperty('requestedDate');
    });

    it('round-trips a per-pound line with its price per pound', async () => {
      const repo = await makeRepo();
      const input = newOrder({
        lines: [
          newLine({
            pricingBasis: 'per_pound',
            productPricePerLb: '0.7234',
            orderedWeightLb: '500.0000',
            rollWeightLb: '44.6000',
          }),
        ],
      });

      await createOrder(repo, input);
      const stored = (await repo.findWithLines(input.id))?.lines[0];

      expect(stored).toMatchObject({
        pricingBasis: 'per_pound',
        productPricePerLb: '0.7234',
        orderedWeightLb: '500.0000',
      });
    });

    it("round-trips the customer's part number and description, and their absence", async () => {
      const repo = await makeRepo();
      const input = newOrder({
        lines: [
          newLine({ customerPartNumber: 'LN-1300-C', customerDescription: 'CEDAR CORE SHEET' }),
          newLine({ lineNumber: 2 }),
        ],
      });

      await createOrder(repo, input);
      const lines = (await repo.findWithLines(input.id))?.lines ?? [];

      expect(lines[0]).toMatchObject({
        customerPartNumber: 'LN-1300-C',
        customerDescription: 'CEDAR CORE SHEET',
      });

      expect(Object.hasOwn(lines[1] ?? {}, 'customerPartNumber')).toBe(false);
      expect(Object.hasOwn(lines[1] ?? {}, 'customerDescription')).toBe(false);
    });

    it('round-trips the custom-width mark, and a line without it reads as a stock width', async () => {
      const repo = await makeRepo();
      const input = newOrder({
        lines: [newLine({ rollWidthIn: 17, customWidth: true }), newLine({ lineNumber: 2 })],
      });

      await createOrder(repo, input);
      const lines = (await repo.findWithLines(input.id))?.lines ?? [];

      expect(lines.map((line) => line.customWidth ?? false)).toEqual([true, false]);
    });

    it('round-trips a line with no pallet count as null, beside a counted one', async () => {
      const repo = await makeRepo();
      const input = newOrder({
        lines: [newLine({ pallets: null }), newLine({ lineNumber: 2, pallets: 3 })],
      });

      await createOrder(repo, input);
      const lines = (await repo.findWithLines(input.id))?.lines ?? [];

      expect(lines.map((line) => line.pallets)).toEqual([null, 3]);
    });

    it('round-trips a stock width in sixteenths as the number it went in as', async () => {
      const repo = await makeRepo();
      const input = newOrder({
        lines: [newLine({ rollWidthIn: 11.3125 }), newLine({ lineNumber: 2, rollWidthIn: 24 })],
      });

      await createOrder(repo, input);
      const lines = (await repo.findWithLines(input.id))?.lines ?? [];

      expect(lines.map((line) => line.rollWidthIn)).toEqual([11.3125, 24]);
    });

    it('reads a per-roll line back with NO price per pound', async () => {
      const repo = await makeRepo();
      const input = newOrder({ lines: [newLine()] });

      await createOrder(repo, input);
      const stored = (await repo.findWithLines(input.id))?.lines[0];

      expect(stored?.pricingBasis).toBe('per_roll');
      expect(stored?.productPricePerLb).toBeUndefined();
      expect(Object.hasOwn(stored ?? {}, 'productPricePerLb')).toBe(false);

      expect(Object.hasOwn(stored ?? {}, 'orderedWeightLb')).toBe(false);
    });

    it('allows a second order against the same quote, at the same lines', async () => {
      const repo = await makeRepo();
      const first = newOrder();
      await createOrder(repo, first);

      const second = newOrder({
        quoteId: first.quoteId,
        lines: first.lines.map((line) => ({ ...line, id: newId() })),
      });
      await createOrder(repo, second);

      const both = await repo.list({ quoteIds: [first.quoteId] });
      expect(both.map((order) => order.id).sort()).toEqual([first.id, second.id].sort());
      expect((await repo.findWithLines(second.id))?.lines[0]?.quoteLineId).toBe(
        first.lines[0]?.quoteLineId,
      );
    });

    it('refuses the same quote line twice inside one order', async () => {
      const repo = await makeRepo();
      const line = newLine({ lineNumber: 1 });

      await expect(
        createOrder(
          repo,
          newOrder({
            lines: [line, { ...line, id: newId(), lineNumber: 2 }],
          }),
        ),
      ).rejects.toThrow();
    });

    it('allows many orders for one customer', async () => {
      const repo = await makeRepo();
      const customerId = newId();
      await createOrder(repo, newOrder({ customerId }));
      await createOrder(repo, newOrder({ customerId }));

      expect(await repo.list({ customerId })).toHaveLength(2);
    });

    it('stores the lines with the order and returns them round-tripped', async () => {
      const repo = await makeRepo();
      const line = newLine({
        lineNumber: 1,
        overwrap: true,
        freight: { mode: 'carrier', freightMarginPct: '0.120000' },
        freightResult: {
          mode: 'carrier',
          cost: '0.0000',
          margin: '0.0000',
          invoiceTotal: '0.0000',

          pending: true,
        },
      });
      const input = newOrder({ lines: [line] });

      const created = await createOrder(repo, input);
      expect(created.lines).toHaveLength(1);
      expect(created.lines[0]).toMatchObject({
        id: line.id,
        orderId: input.id,
        lineNumber: 1,
        quoteLineId: line.quoteLineId,
        gradeId: line.gradeId,
        overwrap: true,

        feetPerRoll: '1385.0000',
        estimatedWeightLb: '528.5000',
        pricePerRoll: '37.8000',
        extendedPrice: '419.0000',
        extendedCost: '280.0000',
        extendedMargin: '139.0000',
        freight: { mode: 'carrier', freightMarginPct: '0.120000' },
        freightResult: { mode: 'carrier', pending: true, invoiceTotal: '0.0000' },
      });
    });

    it('omits feet_per_roll rather than surfacing null on a line that predates it', async () => {
      const repo = await makeRepo();

      const line: NewOrderLine & { id: string } = newLine();
      delete line.feetPerRoll;
      const input = newOrder({ lines: [line] });

      const created = await createOrder(repo, input);
      expect(created.lines[0]).not.toHaveProperty('feetPerRoll');

      const read = await repo.findWithLines(input.id);
      expect(read?.lines[0]).not.toHaveProperty('feetPerRoll');
    });

    it('round-trips the paper cost basis at its own scale', async () => {
      const repo = await makeRepo();
      const input = newOrder({ lines: [newLine()] });

      const created = await createOrder(repo, input);
      const read = await repo.findWithLines(input.id);

      for (const line of [created.lines[0], read?.lines[0]]) {
        expect(line).toMatchObject({
          rollWeightLb: '52.8500',

          paperCostPerLb: '0.46266422',
          paperCostPerRoll: '24.4518',
        });
      }
    });

    it('returns an order the wire contract accepts', async () => {
      const repo = await makeRepo();
      const input = newOrder({ lines: [newLine()] });

      const created = await createOrder(repo, input);
      const read = await repo.findWithLines(input.id);

      expect(() => orderWithLinesSchema.parse(created)).not.toThrow();
      expect(() => orderWithLinesSchema.parse(read)).not.toThrow();
    });

    it('omits the paper cost basis rather than surfacing null on a line that predates it', async () => {
      const repo = await makeRepo();
      const line: NewOrderLine & { id: string } = newLine();
      delete line.rollWeightLb;
      delete line.paperCostPerLb;
      delete line.paperCostPerRoll;
      const input = newOrder({ lines: [line] });

      const created = await createOrder(repo, input);
      const read = await repo.findWithLines(input.id);

      for (const stored of [created.lines[0], read?.lines[0]]) {
        expect(stored).not.toHaveProperty('rollWeightLb');
        expect(stored).not.toHaveProperty('paperCostPerLb');
        expect(stored).not.toHaveProperty('paperCostPerRoll');
      }
    });

    it('stores a delivery address per line, and a different one on each', async () => {
      const repo = await makeRepo();
      const harbor = {
        name: 'Harbor Receiving',
        line1: '200 Example Way',
        line2: 'Dock 3',
        city: 'Sample Harbor',
        state: 'WA',
        postalCode: '98000-6153',
      };
      const falls = {
        line1: '500 Example Way',
        city: 'Demo Falls',
        state: 'ID',
        postalCode: '83010',
      };
      const input = newOrder({
        lines: [
          newLine({ lineNumber: 1, deliveryAddress: harbor }),
          newLine({ lineNumber: 2, deliveryAddress: falls }),
        ],
      });

      const created = await createOrder(repo, input);

      expect(created.lines.map((l) => l.deliveryAddress)).toEqual([harbor, falls]);
    });

    it('omits an absent delivery address rather than surfacing a hollow one', async () => {
      const repo = await makeRepo();
      const input = newOrder({ lines: [newLine({ lineNumber: 1 })] });

      const created = await createOrder(repo, input);

      expect(created.lines[0]).not.toHaveProperty('deliveryAddress');
    });
  });

  describe('createMany, the orders of one press', () => {
    const pressOrder = (over: Partial<OrderInput> = {}, poNumber?: string) => {
      const order = newOrder(over);
      return {
        ...order,
        opening: {
          id: newId(),
          from: null,
          to: 'converted' as const,
          reason: 'converted from quote',
          actor: 'aclark',
          at: NOW.toISOString(),
        },
        ...(poNumber === undefined ? {} : { purchaseOrder: { poNumber, capturedBy: 'aclark' } }),
      };
    };

    it('writes every order with its lines, its date, its opening history row and the PO number', async () => {
      const repo = await makeRepo();
      const quoteId = newId();
      const june = pressOrder({ quoteId, requestedDate: '2027-06-10' }, 'PO 6082417');
      const july = pressOrder(
        { quoteId, requestedDate: '2027-07-15', lines: [newLine(), newLine({ lineNumber: 2 })] },
        'PO 6082417',
      );

      const made = await repo.createMany([june, july]);

      expect(made.map((order) => order.id)).toEqual([june.id, july.id]);
      for (const [order, input] of [
        [made[0], june],
        [made[1], july],
      ] as const) {
        expect(order).toMatchObject({
          quoteId,
          status: 'converted',
          requestedDate: input.requestedDate,
          poNumber: 'PO 6082417',
          poCapturedBy: 'aclark',
          poCapturedAt: NOW.toISOString(),
        });
        expect(order?.lines.map((line) => line.id)).toEqual(input.lines.map((line) => line.id));
        expect(orderWithLinesSchema.safeParse(order).success).toBe(true);

        expect(await repo.findWithLines(input.id)).toEqual(order);
        expect(await repo.history(input.id)).toEqual([{ ...input.opening, orderId: input.id }]);
      }
    });

    it('leaves the PO fields absent when no number was typed', async () => {
      const repo = await makeRepo();
      const [made] = await repo.createMany([pressOrder(), pressOrder()]);

      expect(made).not.toHaveProperty('poNumber');
      expect(made).not.toHaveProperty('poCapturedBy');
      expect(made).not.toHaveProperty('poCapturedAt');
    });

    it('writes all or none: a refused second order leaves no first order behind', async () => {
      const repo = await makeRepo();
      const quoteId = newId();
      const first = pressOrder({ quoteId, requestedDate: '2027-06-10' }, 'PO 6082417');
      const line = newLine();
      const second = pressOrder(
        {
          quoteId,
          requestedDate: '2027-07-15',
          lines: [line, { ...line, id: newId(), lineNumber: 2 }],
        },
        'PO 6082417',
      );

      await expect(repo.createMany([first, second])).rejects.toThrow();

      expect(await repo.findById(first.id)).toBeNull();
      expect(await repo.findById(second.id)).toBeNull();
      expect(await repo.list({ quoteIds: [quoteId] })).toEqual([]);
      expect(await repo.history(first.id)).toEqual([]);
      expect(await repo.linesByOrderIds([first.id])).toEqual([]);
    });

    it('writes one order with its opening history row and PO number in the same call', async () => {
      const repo = await makeRepo();
      const single = pressOrder({}, 'PO 7140258');

      const [made] = await repo.createMany([single]);

      expect(made).toMatchObject({
        id: single.id,
        status: 'converted',
        poNumber: 'PO 7140258',
        poCapturedBy: 'aclark',
        poCapturedAt: NOW.toISOString(),
        lockVersion: 1,
      });
      expect(made).not.toHaveProperty('requestedDate');
      expect(await repo.findWithLines(single.id)).toEqual(made);
      expect(await repo.history(single.id)).toEqual([{ ...single.opening, orderId: single.id }]);
    });

    it('writes nothing when the opening history row cannot be written', async () => {
      const repo = await makeRepo();
      const [earlier] = await repo.createMany([pressOrder()]);
      const taken = (await repo.history(earlier!.id))[0]!.id;
      const order = pressOrder({}, 'PO 7140259');

      await expect(
        repo.createMany([{ ...order, opening: { ...order.opening, id: taken } }]),
      ).rejects.toThrow();

      expect(await repo.findById(order.id)).toBeNull();
      expect(await repo.linesByOrderIds([order.id])).toEqual([]);
      expect(await repo.history(order.id)).toEqual([]);
      expect(await repo.list({ poNumber: 'PO 7140259' })).toEqual([]);
    });
  });

  describe('lines', () => {
    it('reads lines back in lineNumber order, whatever order they were written', async () => {
      const repo = await makeRepo();
      const input = newOrder({
        lines: [newLine({ lineNumber: 3 }), newLine({ lineNumber: 1 }), newLine({ lineNumber: 2 })],
      });
      await createOrder(repo, input);

      const found = await repo.findWithLines(input.id);
      expect(found?.lines.map((l) => l.lineNumber)).toEqual([1, 2, 3]);
    });

    it('returns null from findWithLines for an unknown id rather than throwing', async () => {
      const repo = await makeRepo();
      expect(await repo.findWithLines(newId())).toBeNull();
    });

    it('reads lines for many orders in one call, and ignores ids that name nothing', async () => {
      const repo = await makeRepo();
      const first = newOrder({ lines: [newLine({ lineNumber: 1 }), newLine({ lineNumber: 2 })] });
      const second = newOrder({ lines: [newLine({ lineNumber: 1 })] });
      await createOrder(repo, first);
      await createOrder(repo, second);

      const lines = await repo.linesByOrderIds([first.id, second.id, newId()]);
      expect(lines).toHaveLength(3);
      expect(lines.filter((l) => l.orderId === first.id)).toHaveLength(2);
      expect(lines.filter((l) => l.orderId === second.id)).toHaveLength(1);
    });

    it('captures the customer PO number and reads it back', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      await createOrder(repo, input);

      const captured = await capturePo(
        repo,
        input.id,
        { poNumber: 'PO-7364', capturedBy: 'dev-sales' },
        LATER,
      );

      expect(captured).toMatchObject({
        poNumber: 'PO-7364',

        poCapturedBy: 'dev-sales',
        poCapturedAt: LATER.toISOString(),
      });
      expect((await repo.findWithLines(input.id))?.poNumber).toBe('PO-7364');
    });

    it('replaces the number on re-capture', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      await createOrder(repo, input);
      await capturePo(repo, input.id, { poNumber: 'PO-7364', capturedBy: 'dev-sales' }, LATER);

      const corrected = await capturePo(
        repo,
        input.id,
        { poNumber: 'PO-2851', capturedBy: 'dev-billing' },
        LATER,
      );
      expect(corrected).toMatchObject({ poNumber: 'PO-2851', poCapturedBy: 'dev-billing' });
    });

    it('clears the number and its provenance when none is given', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      await createOrder(repo, input);
      await capturePo(repo, input.id, { poNumber: 'PO-7364', capturedBy: 'dev-sales' }, LATER);

      const cleared = await capturePo(repo, input.id, { capturedBy: 'dev-sales' }, LATER);

      expect(cleared?.poNumber).toBeUndefined();
      expect(cleared?.poCapturedBy).toBeUndefined();
      expect(cleared?.poCapturedAt).toBeUndefined();
      expect((await repo.findWithLines(input.id))?.poNumber).toBeUndefined();
    });

    it('takes the same number on two orders of one customer', async () => {
      const repo = await makeRepo();
      const customerId = newId();
      const first = newOrder({ customerId });
      const second = newOrder({ customerId });
      await createOrder(repo, first);
      await createOrder(repo, second);

      const po = { poNumber: 'approved by customer', capturedBy: 'dev-sales' };
      await capturePo(repo, first.id, po, LATER);
      await expect(capturePo(repo, second.id, po, LATER)).resolves.toMatchObject({
        poNumber: 'approved by customer',
      });
    });

    it('returns null capturing against an unknown order rather than throwing', async () => {
      const repo = await makeRepo();
      expect(
        await capturePo(repo, newId(), { poNumber: 'PO-X', capturedBy: 'dev-sales' }, LATER),
      ).toBeNull();
    });

    it('answers an empty list for no ids at all', async () => {
      const repo = await makeRepo();
      expect(await repo.linesByOrderIds([])).toEqual([]);
    });
  });

  describe('findById / existsForQuote', () => {
    it('returns null for an unknown id rather than throwing', async () => {
      const repo = await makeRepo();
      expect(await repo.findById(newId())).toBeNull();
      expect(await repo.existsForQuote(newId())).toBe(false);
    });

    it('answers whether a quote has started any job', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      await createOrder(repo, input);

      expect(await repo.existsForQuote(input.quoteId)).toBe(true);

      await createOrder(
        repo,
        newOrder({
          quoteId: input.quoteId,
          lines: input.lines.map((line) => ({ ...line, id: newId() })),
        }),
      );
      expect(await repo.existsForQuote(input.quoteId)).toBe(true);
    });
  });

  describe('list', () => {
    it('filters by status', async () => {
      const repo = await makeRepo();
      const a = newOrder();
      await createOrder(repo, a);
      await createOrder(repo, newOrder());
      await confirm(repo, a.id);

      expect(await repo.list({ status: ['confirmed'] })).toHaveLength(1);
      expect(await repo.list({ status: ['converted'] })).toHaveLength(1);
    });

    it('filters by several statuses at once, returning the union', async () => {
      const repo = await makeRepo();
      const confirmed = newOrder();
      const converted = newOrder();
      await createOrder(repo, confirmed);
      await createOrder(repo, converted);
      await confirm(repo, confirmed.id);

      const both = await repo.list({ status: ['confirmed', 'converted'] });
      expect(both.map((o) => o.id).sort()).toEqual([confirmed.id, converted.id].sort());

      expect(await repo.list({ status: ['converted'] })).toHaveLength(1);

      expect(await repo.list({ status: ['converted', 'converted'] })).toHaveLength(1);
    });

    it('matches nothing when the status list is empty', async () => {
      const repo = await makeRepo();
      await createOrder(repo, newOrder());

      expect(await repo.list({ status: [] })).toEqual([]);

      expect(await repo.list({})).toHaveLength(1);
    });

    it('filters by quote', async () => {
      const repo = await makeRepo();
      const converted = newOrder();
      await createOrder(repo, converted);
      await createOrder(repo, newOrder());

      expect((await repo.list({ quoteIds: [converted.quoteId] })).map((o) => o.id)).toEqual([
        converted.id,
      ]);
      expect(await repo.list({ quoteIds: [newId()] })).toEqual([]);
    });

    it('composes the quote filter with the others', async () => {
      const repo = await makeRepo();
      const order = newOrder();
      await createOrder(repo, order);

      expect(await repo.list({ quoteIds: [order.quoteId], status: ['converted'] })).toHaveLength(1);
      expect(await repo.list({ quoteIds: [order.quoteId], status: ['confirmed'] })).toEqual([]);
      expect(
        await repo.list({ quoteIds: [order.quoteId], customerId: order.customerId }),
      ).toHaveLength(1);
      expect(await repo.list({ quoteIds: [order.quoteId], customerId: newId() })).toEqual([]);
    });

    it('returns every listed quote’s orders, and nothing for an empty list', async () => {
      const repo = await makeRepo();
      const first = newOrder();
      const second = newOrder();
      await createOrder(repo, first);
      await createOrder(repo, second);
      await createOrder(repo, newOrder());

      const both = await repo.list({ quoteIds: [first.quoteId, second.quoteId] });
      expect(both.map((o) => o.id).sort()).toEqual([first.id, second.id].sort());
      expect(await repo.list({ quoteIds: [] })).toEqual([]);
      expect(await repo.countAndOldest({ quoteIds: [] })).toEqual({ count: 0, oldest: null });
    });

    describe('sort, limit and countAndOldest', () => {
      const seed = async (repo: OrderRepository) => {
        const customerId = newId();
        const a = newOrder({
          customerId,
          salesRep: 'rep-ab',
          createdAt: new Date('2026-08-01T10:00:00.000Z'),
          updatedAt: new Date('2026-08-05T10:00:00.000Z'),
        });
        const b = newOrder({
          customerId,
          salesRep: 'rep-ab',
          createdAt: new Date('2026-08-02T10:00:00.000Z'),
          updatedAt: new Date('2026-08-04T10:00:00.000Z'),
        });
        const c = newOrder({
          customerId,
          salesRep: 'rep-c',
          createdAt: new Date('2026-08-03T10:00:00.000Z'),
          updatedAt: new Date('2026-08-03T10:00:00.000Z'),
        });
        for (const order of [a, b, c]) {
          await createOrder(repo, order);
        }
        return { customerId, a, b, c };
      };

      it('keeps newest-created-first when no sort is asked for', async () => {
        const repo = await makeRepo();
        const { customerId, a, b, c } = await seed(repo);
        expect((await repo.list({ customerId })).map((o) => o.id)).toEqual([c.id, b.id, a.id]);
      });

      it('sorts by updatedAt both ways and cuts the limit after the sort', async () => {
        const repo = await makeRepo();
        const { customerId, a, b, c } = await seed(repo);

        expect((await repo.list({ customerId, sort: 'oldest' })).map((o) => o.id)).toEqual([
          c.id,
          b.id,
          a.id,
        ]);
        expect((await repo.list({ customerId, sort: 'newest' })).map((o) => o.id)).toEqual([
          a.id,
          b.id,
          c.id,
        ]);
        expect(
          (await repo.list({ customerId, sort: 'oldest', limit: 2 })).map((o) => o.id),
        ).toEqual([c.id, b.id]);
        expect(
          (await repo.list({ customerId, sort: 'newest', limit: 1 })).map((o) => o.id),
        ).toEqual([a.id]);
      });

      it('counts what the list returns under the same filters, with the oldest by updatedAt', async () => {
        const repo = await makeRepo();
        const { customerId, b, c } = await seed(repo);

        for (const filters of [
          { customerId },
          { customerId, salesRep: 'rep-ab' },
          { customerId, status: ['converted' as const] },
          { customerId, status: ['confirmed' as const] },
        ]) {
          const listed = await repo.list(filters);
          const counted = await repo.countAndOldest(filters);
          expect(counted.count).toBe(listed.length);
          const oldest = [...listed].sort((x, y) => x.updatedAt.localeCompare(y.updatedAt))[0];
          expect(counted.oldest).toEqual(oldest ?? null);
        }

        expect((await repo.countAndOldest({ customerId })).oldest?.id).toBe(c.id);
        expect((await repo.countAndOldest({ customerId, salesRep: 'rep-ab' })).oldest?.id).toBe(
          b.id,
        );
        expect(await repo.countAndOldest({ customerId: newId() })).toEqual({
          count: 0,
          oldest: null,
        });
      });
    });

    it('filters by the customer PO number', async () => {
      const repo = await makeRepo();
      const withPo = newOrder();
      await createOrder(repo, withPo);
      await createOrder(repo, newOrder({ customerId: withPo.customerId }));
      await capturePo(repo, withPo.id, { poNumber: 'PO-DUP-1', capturedBy: 'dev-sales' }, NOW);

      expect((await repo.list({ poNumber: 'PO-DUP-1' })).map((o) => o.id)).toEqual([withPo.id]);
      expect(await repo.list({ poNumber: 'PO-NEVER-SENT' })).toEqual([]);

      expect(await repo.list({ poNumber: 'PO-DUP-1', customerId: withPo.customerId })).toHaveLength(
        1,
      );
      expect(await repo.list({ poNumber: 'PO-DUP-1', customerId: newId() })).toEqual([]);
    });

    it('returns newest first', async () => {
      const repo = await makeRepo();
      const older = newOrder({ createdAt: NOW, updatedAt: NOW });
      const newer = newOrder({ createdAt: LATER, updatedAt: LATER });
      await createOrder(repo, older);
      await createOrder(repo, newer);

      expect((await repo.list({})).map((o) => o.id)).toEqual([newer.id, older.id]);
    });

    it('is empty, not null, when nothing matches', async () => {
      expect(await (await makeRepo()).list({ status: ['confirmed'] })).toEqual([]);
    });

    it('filters by sales rep', async () => {
      const repo = await makeRepo();
      const jane = newOrder({ salesRep: 'jsmith' });
      await createOrder(repo, jane);
      await createOrder(repo, newOrder({ salesRep: 'rlee' }));
      await createOrder(repo, newOrder());

      expect((await repo.list({ salesRep: 'jsmith' })).map((o) => o.id)).toEqual([jane.id]);
      expect(await repo.list({ salesRep: 'nobody' })).toEqual([]);
    });

    it('matches the rep exactly, free text included', async () => {
      const repo = await makeRepo();
      const typed = newOrder({ salesRep: 'Smith, Jane' });
      await createOrder(repo, typed);

      expect((await repo.list({ salesRep: 'Smith, Jane' })).map((o) => o.id)).toEqual([typed.id]);
      expect(await repo.list({ salesRep: 'Smith' })).toEqual([]);
    });

    it('composes the rep filter with the others', async () => {
      const repo = await makeRepo();
      const order = newOrder({ salesRep: 'jsmith' });
      await createOrder(repo, order);

      expect(await repo.list({ salesRep: 'jsmith', status: ['converted'] })).toHaveLength(1);
      expect(await repo.list({ salesRep: 'jsmith', status: ['confirmed'] })).toEqual([]);
      expect(await repo.list({ salesRep: 'jsmith', customerId: order.customerId })).toHaveLength(1);
      expect(await repo.list({ salesRep: 'rlee', customerId: order.customerId })).toEqual([]);
    });
  });

  describe('mintJobNumber', () => {
    it('never issues the same number twice', async () => {
      const repo = await makeRepo();

      const minted = await Promise.all(Array.from({ length: 25 }, () => repo.mintJobNumber()));

      expect(new Set(minted).size).toBe(minted.length);
    });

    it('formats as an LOB-prefixed, zero-padded number', async () => {
      const repo = await makeRepo();

      expect(await repo.mintJobNumber()).toMatch(/^DPW-\d{5,}$/);
    });

    it('issues a number the orders table will accept as unique', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      await createOrder(repo, input);
      const jobNumber = await repo.mintJobNumber();

      const moved = await repo.transition(
        input.id,
        'confirmed',
        { jobNumber, confirmedLeadTimeDays: 3, confirmedBy: 'pm', confirmedAt: LATER },
        { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: LATER.toISOString() },
        LATER,
      );

      expect(moved?.jobNumber).toBe(jobNumber);
    });
  });

  describe('transition', () => {
    it('moves the order and stamps updatedAt', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      await createOrder(repo, input);

      const moved = await repo.transition(
        input.id,
        'confirmed',
        {
          jobNumber: 'DPW-4718',
          confirmedLeadTimeDays: 14,
          confirmedBy: 'pm',
          confirmedAt: LATER,
        },
        { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: LATER.toISOString() },
        LATER,
      );

      expect(moved).toMatchObject({
        status: 'confirmed',
        jobNumber: 'DPW-4718',
        confirmedLeadTimeDays: 14,

        confirmedBy: 'pm',
        confirmedAt: LATER.toISOString(),
        updatedAt: LATER.toISOString(),
      });
    });

    it('appends history alongside the status change', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      const opening = openingRow();
      await createOrder(repo, input, opening);

      await repo.transition(
        input.id,
        'confirmed',
        {
          jobNumber: 'DPW-2947',
          confirmedLeadTimeDays: 5,
          confirmedBy: 'pmanager',
          confirmedAt: LATER,
        },
        {
          id: newId(),
          from: 'converted',
          to: 'confirmed',
          reason: 'material in stock',
          actor: 'pmanager',
          at: LATER.toISOString(),
        },
        LATER,
      );

      const history = await repo.history(input.id);
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ ...opening, orderId: input.id });
      expect(history[1]).toMatchObject({
        orderId: input.id,
        from: 'converted',
        to: 'confirmed',
        reason: 'material in stock',
        actor: 'pmanager',
      });
    });

    it('returns null for an unknown id rather than throwing', async () => {
      const repo = await makeRepo();
      const result = await repo.transition(
        newId(),
        'confirmed',
        {},
        { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: NOW.toISOString() },
        NOW,
      );
      expect(result).toBeNull();
    });

    it('leaves fields the patch does not mention alone', async () => {
      const repo = await makeRepo();
      const input = newOrder({ salesRep: 'jsmith', requestedDate: '2027-06-10' });
      await createOrder(repo, input);
      await capturePo(repo, input.id, { poNumber: 'PO-7364', capturedBy: 'dev-sales' }, NOW);

      const after = await repo.transition(
        input.id,
        'confirmed',
        {
          jobNumber: 'DPW-6352',
          confirmedLeadTimeDays: 7,
          confirmedBy: 'pm',
          confirmedAt: LATER,
        },
        { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: LATER.toISOString() },
        LATER,
      );

      expect(after).toMatchObject({
        status: 'confirmed',
        jobNumber: 'DPW-6352',
        confirmedLeadTimeDays: 7,
        salesRep: 'jsmith',
        requestedDate: '2027-06-10',
        poNumber: 'PO-7364',
      });
    });
  });

  describe('history', () => {
    it('is oldest first, so it reads as a story', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      await repo.createMany([
        {
          ...input,
          opening: {
            id: newId(),
            from: null,
            to: 'converted',
            reason: 'converted from quote',
            actor: 'sales',
            at: NOW.toISOString(),
          },
        },
      ]);

      await repo.transition(
        input.id,
        'confirmed',
        {
          jobNumber: 'DPW-2947',
          confirmedLeadTimeDays: 5,
          confirmedBy: 'pm',
          confirmedAt: LATER,
        },
        { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: LATER.toISOString() },
        LATER,
      );

      expect((await repo.history(input.id)).map((t) => t.to)).toEqual(['converted', 'confirmed']);
    });

    it('does not leak another order/s history', async () => {
      const repo = await makeRepo();
      const a = newOrder();
      const b = newOrder();
      await createOrder(repo, a);
      const opening = openingRow({ actor: 'jsmith' });
      await createOrder(repo, b, opening);
      await confirm(repo, a.id);

      expect(await repo.history(b.id)).toEqual([{ ...opening, orderId: b.id }]);
    });
  });

  describe('lockVersion', () => {
    it('starts at 1 and climbs on every write to the aggregate', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      const created = await createOrder(repo, input);
      expect(created.lockVersion).toBe(1);

      const afterPo = await capturePo(
        repo,
        input.id,
        { poNumber: 'PO-7364', capturedBy: 'sales' },
        LATER,
      );
      expect(afterPo?.lockVersion).toBe(2);

      const afterTransition = await repo.transition(
        input.id,
        'confirmed',
        {},
        { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: NOW.toISOString() },
        LATER,
      );
      expect(afterTransition?.lockVersion).toBe(3);
    });

    it('refuses a transition carrying a stale lockVersion', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      const created = await createOrder(repo, input);

      await expect(
        repo.transition(
          input.id,
          'confirmed',
          {},
          { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: NOW.toISOString() },
          LATER,
          created.lockVersion + 1,
        ),
      ).rejects.toBeInstanceOf(StaleAggregateError);

      const after = await repo.findById(input.id);
      expect(after?.status).toBe('converted');
      expect(after?.lockVersion).toBe(created.lockVersion);
    });

    it('accepts a transition carrying the lockVersion the caller read', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      const created = await createOrder(repo, input);

      const moved = await repo.transition(
        input.id,
        'confirmed',
        {},
        { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: NOW.toISOString() },
        LATER,
        created.lockVersion,
      );

      expect(moved?.status).toBe('confirmed');
      expect(moved?.lockVersion).toBe(created.lockVersion + 1);
    });

    it('checks nothing when a transition omits the lockVersion', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      await createOrder(repo, input);

      const moved = await repo.transition(
        input.id,
        'confirmed',
        {},
        { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: NOW.toISOString() },
        LATER,
      );

      expect(moved?.status).toBe('confirmed');
    });

    it('reports an unknown order as absent rather than as stale', async () => {
      const repo = await makeRepo();

      expect(
        await repo.transition(
          newId(),
          'confirmed',
          {},
          { id: newId(), from: 'converted', to: 'confirmed', actor: 'pm', at: NOW.toISOString() },
          LATER,
          1,
        ),
      ).toBeNull();
    });

    it('refuses a PO capture carrying a stale lockVersion', async () => {
      const repo = await makeRepo();
      const input = newOrder();
      const created = await createOrder(repo, input);
      await capturePo(repo, input.id, { poNumber: 'PO-FIRST', capturedBy: 'dev-sales' }, LATER);

      await expect(
        repo.capturePurchaseOrder(
          input.id,
          { poNumber: 'PO-STALE', capturedBy: 'dev-sales' },
          LATER,
          created.lockVersion,
        ),
      ).rejects.toBeInstanceOf(StaleAggregateError);

      const after = await repo.findWithLines(input.id);
      expect(after?.poNumber).toBe('PO-FIRST');
    });
  });
}
