// PostgreSQL `OrderRepository` over the orders schema. Writes that touch more than one row run in
// one transaction, and guarded writes compare lockVersion in the WHERE clause:
// docs/decisions/006-optimistic-concurrency.md.
import type {
  CountAndOldest,
  RevenueCategory,
  TaxStatus,
  DeliveryAddress,
  FreightInput,
  Order,
  OrderLine,
  OrderStatus,
  OrderTransition,
  OrderWithLines,
  PricingBasis,
  ShippingMode,
} from '@erp/types';
import { and, asc, eq, inArray, desc, sql, type SQL } from 'drizzle-orm';

import { formatJobNumber } from '../../job-number';
import type { OrdersDb } from '../../data/orders-db';
import { orders, orderLines, orderTransitions } from '../../data/schema';
import { StaleAggregateError } from '../../ports';
import type {
  NewOrder,
  NewOrderLine,
  NewOrderWrite,
  OrderListParams,
  OrderPatch,
  OrderRepository,
  PurchaseOrderCapture,
} from '../../ports';

type Row = typeof orders.$inferSelect;
type TransitionRow = typeof orderTransitions.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;

function toOrder(row: Row): Order {
  return {
    id: row.id,
    quoteId: row.quoteId,
    customerId: row.customerId,

    status: row.status as OrderStatus,
    ...(row.jobNumber === null ? {} : { jobNumber: row.jobNumber }),
    ...(row.confirmedLeadTimeDays === null
      ? {}
      : { confirmedLeadTimeDays: row.confirmedLeadTimeDays }),
    ...(row.confirmedBy === null ? {} : { confirmedBy: row.confirmedBy }),
    ...(row.confirmedAt === null ? {} : { confirmedAt: row.confirmedAt.toISOString() }),
    ...(row.salesRep === null ? {} : { salesRep: row.salesRep }),
    ...(row.poNumber === null ? {} : { poNumber: row.poNumber }),
    ...(row.poCapturedBy === null ? {} : { poCapturedBy: row.poCapturedBy }),
    ...(row.poCapturedAt === null ? {} : { poCapturedAt: row.poCapturedAt.toISOString() }),
    ...(row.requestedDate === null ? {} : { requestedDate: row.requestedDate }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lockVersion: row.lockVersion,
  };
}
// Rebuilds the freight input from flat columns. Each mode reads only the columns its CHECK
// constraints in the baseline allow.
function toFreightInput(row: LineRow): FreightInput {
  switch (row.freightMode as ShippingMode) {
    case 'pickup':
      return { mode: 'pickup' };
    case 'our_vehicle':
      return {
        mode: 'our_vehicle',
        ...(row.freightRateOverride === null ? {} : { rateOverride: row.freightRateOverride }),
      };
    case 'pass_through':
      return {
        mode: 'pass_through',
        ...(row.freightRateOverride === null ? {} : { rateOverride: row.freightRateOverride }),
        ...(row.freightCarrierBid === null ? {} : { carrierBid: row.freightCarrierBid }),
      };
    case 'carrier':
      return {
        mode: 'carrier',
        ...(row.freightCarrierBid === null ? {} : { carrierBid: row.freightCarrierBid }),
        ...(row.freightMarginPct === null ? {} : { freightMarginPct: row.freightMarginPct }),
      };
  }
}

function toDeliveryAddress(row: LineRow): DeliveryAddress | undefined {
  if (row.deliveryLine1 === null) {
    return undefined;
  }
  // order_lines_delivery_address_check makes a partial address impossible, so this marks a corrupt row.
  if (row.deliveryCity === null || row.deliveryState === null || row.deliveryPostalCode === null) {
    throw new Error(`order line ${row.id} carries a partial delivery address`);
  }
  return {
    ...(row.deliveryName === null ? {} : { name: row.deliveryName }),
    line1: row.deliveryLine1,
    ...(row.deliveryLine2 === null ? {} : { line2: row.deliveryLine2 }),
    city: row.deliveryCity,
    state: row.deliveryState,
    postalCode: row.deliveryPostalCode,
  };
}
function toLine(row: LineRow): OrderLine {
  const deliveryAddress = toDeliveryAddress(row);
  return {
    id: row.id,
    orderId: row.orderId,
    lineNumber: row.lineNumber,

    ...(row.quoteLineId === null ? {} : { quoteLineId: row.quoteLineId }),

    revenueCategory: row.revenueCategory as RevenueCategory,
    printed: row.printed,
    taxStatus: row.taxStatus as TaxStatus,
    ...(row.taxJurisdiction === null ? {} : { taxJurisdiction: row.taxJurisdiction }),

    ...(row.customerPartNumber === null ? {} : { customerPartNumber: row.customerPartNumber }),
    ...(row.customerDescription === null ? {} : { customerDescription: row.customerDescription }),

    gradeId: row.gradeId,
    footageVariant: row.footageVariant,

    ...(row.feetPerRoll === null ? {} : { feetPerRoll: row.feetPerRoll }),
    rollWidthIn: row.rollWidthIn,
    customWidth: row.customWidth,
    quantityRolls: row.quantityRolls,
    overwrap: row.overwrap,
    pallets: row.pallets,
    estimatedWeightLb: row.estimatedWeightLb,
    ...(deliveryAddress === undefined ? {} : { deliveryAddress }),

    pricingBasis: row.pricingBasis as PricingBasis,
    ...(row.orderedWeightLb === null ? {} : { orderedWeightLb: row.orderedWeightLb }),
    pricePerRoll: row.pricePerRoll,

    ...(row.productPricePerLb === null ? {} : { productPricePerLb: row.productPricePerLb }),
    totalCostPerRoll: row.totalCostPerRoll,
    extendedPrice: row.extendedPrice,
    extendedCost: row.extendedCost,
    extendedMargin: row.extendedMargin,

    ...(row.rollWeightLb === null ? {} : { rollWeightLb: row.rollWeightLb }),
    ...(row.paperCostPerLb === null ? {} : { paperCostPerLb: row.paperCostPerLb }),
    ...(row.paperCostPerRoll === null ? {} : { paperCostPerRoll: row.paperCostPerRoll }),

    freight: toFreightInput(row),
    freightResult: {
      mode: row.freightMode as ShippingMode,
      cost: row.freightCost,
      margin: row.freightMargin,
      invoiceTotal: row.freightInvoiceTotal,
      pending: row.freightPending,
    },

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toLineColumns(
  line: NewOrderLine & { id: string },
  orderId: string,
  at: Date,
): typeof orderLines.$inferInsert {
  return {
    id: line.id,
    orderId,
    lineNumber: line.lineNumber,

    quoteLineId: line.quoteLineId ?? null,
    revenueCategory: line.revenueCategory,
    printed: line.printed,
    taxStatus: line.taxStatus,

    taxJurisdiction: line.taxJurisdiction ?? null,

    customerPartNumber: line.customerPartNumber ?? null,
    customerDescription: line.customerDescription ?? null,

    gradeId: line.gradeId,
    footageVariant: line.footageVariant,
    feetPerRoll: line.feetPerRoll ?? null,
    rollWidthIn: line.rollWidthIn,
    customWidth: line.customWidth ?? false,
    quantityRolls: line.quantityRolls,
    overwrap: line.overwrap,
    pallets: line.pallets,
    estimatedWeightLb: line.estimatedWeightLb,

    deliveryName: line.deliveryAddress?.name ?? null,
    deliveryLine1: line.deliveryAddress?.line1 ?? null,
    deliveryLine2: line.deliveryAddress?.line2 ?? null,
    deliveryCity: line.deliveryAddress?.city ?? null,
    deliveryState: line.deliveryAddress?.state ?? null,
    deliveryPostalCode: line.deliveryAddress?.postalCode ?? null,

    pricingBasis: line.pricingBasis,

    orderedWeightLb: line.orderedWeightLb ?? null,
    pricePerRoll: line.pricePerRoll,

    productPricePerLb: line.productPricePerLb ?? null,
    totalCostPerRoll: line.totalCostPerRoll,
    extendedPrice: line.extendedPrice,
    extendedCost: line.extendedCost,
    extendedMargin: line.extendedMargin,

    rollWeightLb: line.rollWeightLb ?? null,
    paperCostPerLb: line.paperCostPerLb ?? null,
    paperCostPerRoll: line.paperCostPerRoll ?? null,

    freightMode: line.freight.mode,
    freightRateOverride:
      line.freight.mode === 'our_vehicle' || line.freight.mode === 'pass_through'
        ? (line.freight.rateOverride ?? null)
        : null,
    freightCarrierBid:
      line.freight.mode === 'pass_through' || line.freight.mode === 'carrier'
        ? (line.freight.carrierBid ?? null)
        : null,
    freightMarginPct:
      line.freight.mode === 'carrier' ? (line.freight.freightMarginPct ?? null) : null,
    freightCost: line.freightResult.cost,
    freightMargin: line.freightResult.margin,
    freightInvoiceTotal: line.freightResult.invoiceTotal,
    freightPending: line.freightResult.pending,

    createdAt: at,
    updatedAt: at,
  };
}
function toOrderWithLines(row: Row, lineRows: readonly LineRow[]): OrderWithLines {
  return {
    ...toOrder(row),
    lines: [...lineRows].sort((a, b) => a.lineNumber - b.lineNumber).map(toLine),
  };
}

function toTransition(row: TransitionRow): OrderTransition {
  return {
    id: row.id,
    orderId: row.orderId,
    from: row.fromStatus as OrderStatus | null,
    to: row.toStatus as OrderStatus,
    ...(row.reason === null ? {} : { reason: row.reason }),
    actor: row.actor,
    at: row.at.toISOString(),
  };
}

type OrdersTx = Parameters<Parameters<OrdersDb['transaction']>[0]>[0];

// A guarded write that matched no row is either stale or missing. Re-reading tells them apart:
// stale throws, missing answers null.
async function staleOrMissing(
  tx: OrdersTx,
  id: string,
  expectedLockVersion: number,
): Promise<null> {
  const [current] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (current !== undefined) {
    throw new StaleAggregateError('order', id, expectedLockVersion, current.lockVersion);
  }
  return null;
}
async function insertOrderWithLines(
  tx: OrdersTx,
  input: NewOrder & {
    id: string;
    status: OrderStatus;
    createdAt: Date;
    updatedAt: Date;
    lines: readonly (NewOrderLine & { id: string })[];
  },
  purchaseOrder?: { poNumber: string; capturedBy: string },
): Promise<OrderWithLines> {
  const [row] = await tx
    .insert(orders)
    .values({
      id: input.id,
      quoteId: input.quoteId,
      customerId: input.customerId,
      status: input.status,
      salesRep: input.salesRep ?? null,
      requestedDate: input.requestedDate ?? null,
      ...(purchaseOrder === undefined
        ? {}
        : {
            poNumber: purchaseOrder.poNumber,
            poCapturedBy: purchaseOrder.capturedBy,
            poCapturedAt: input.createdAt,
          }),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .returning();
  if (row === undefined) {
    throw new Error('insert returned no row');
  }

  const lineRows = await tx
    .insert(orderLines)
    .values(input.lines.map((line) => toLineColumns(line, input.id, input.createdAt)))
    .returning();

  return {
    ...toOrder(row),
    lines: lineRows.map(toLine).sort((a, b) => a.lineNumber - b.lineNumber),
  };
}

export class DrizzleOrderRepository implements OrderRepository {
  readonly #db: OrdersDb;

  constructor(db: OrdersDb) {
    this.#db = db;
  }

  async createMany(inputs: readonly NewOrderWrite[]): Promise<readonly OrderWithLines[]> {
    return await this.#db.transaction(async (tx) => {
      const made: OrderWithLines[] = [];
      for (const input of inputs) {
        const order = await insertOrderWithLines(tx, input, input.purchaseOrder);
        await tx.insert(orderTransitions).values({
          id: input.opening.id,
          orderId: input.id,
          fromStatus: input.opening.from,
          toStatus: input.opening.to,
          reason: input.opening.reason ?? null,
          actor: input.opening.actor,
          at: new Date(input.opening.at),
        });
        made.push(order);
      }
      return made;
    });
  }

  async findById(id: string): Promise<Order | null> {
    const [row] = await this.#db.select().from(orders).where(eq(orders.id, id)).limit(1);
    return row === undefined ? null : toOrder(row);
  }

  async findWithLines(id: string): Promise<OrderWithLines | null> {
    const [row] = await this.#db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (row === undefined) return null;
    const lineRows = await this.#db
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, id))
      .orderBy(asc(orderLines.lineNumber));
    return toOrderWithLines(row, lineRows);
  }

  async linesByOrderIds(orderIds: readonly string[]): Promise<readonly OrderLine[]> {
    if (orderIds.length === 0) return [];
    const rows = await this.#db
      .select()
      .from(orderLines)

      .where(inArray(orderLines.orderId, [...orderIds]))
      .orderBy(asc(orderLines.orderId), asc(orderLines.lineNumber));
    return rows.map(toLine);
  }

  async existsForQuote(quoteId: string): Promise<boolean> {
    const [row] = await this.#db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.quoteId, quoteId))
      .limit(1);
    return row !== undefined;
  }

  async mintJobNumber(): Promise<string> {
    // nextval is not undone when a transaction rolls back, so job numbers may skip but never repeat.
    const result = await this.#db.execute<{ counter: string }>(
      sql`SELECT nextval('orders.job_number_seq') AS counter`,
    );
    const raw = result.rows[0]?.counter;
    if (raw === undefined) {
      throw new Error('orders.job_number_seq returned no value');
    }

    return formatJobNumber(Number(raw));
  }

  // Null means an empty status or quote list, which matches nothing without a query.
  #listFilter(params: OrderListParams): SQL | undefined | null {
    if (
      (params.status !== undefined && params.status.length === 0) ||
      (params.quoteIds !== undefined && params.quoteIds.length === 0)
    ) {
      return null;
    }
    const filters = [
      ...(params.status === undefined ? [] : [inArray(orders.status, [...params.status])]),
      ...(params.customerId === undefined ? [] : [eq(orders.customerId, params.customerId)]),

      ...(params.quoteIds === undefined ? [] : [inArray(orders.quoteId, [...params.quoteIds])]),
      ...(params.poNumber === undefined ? [] : [eq(orders.poNumber, params.poNumber)]),

      ...(params.salesRep === undefined ? [] : [eq(orders.salesRep, params.salesRep)]),
    ];
    return filters.length === 0 ? undefined : and(...filters);
  }

  async list(params: OrderListParams): Promise<readonly Order[]> {
    const where = this.#listFilter(params);
    if (where === null) {
      return [];
    }

    const order =
      params.sort === 'oldest'
        ? [asc(orders.updatedAt), asc(orders.id)]
        : params.sort === 'newest'
          ? [desc(orders.updatedAt), desc(orders.id)]
          : [desc(orders.createdAt)];
    const query = this.#db
      .select()
      .from(orders)
      .where(where)
      .orderBy(...order);

    const rows = await (params.limit === undefined ? query : query.limit(params.limit));
    return rows.map(toOrder);
  }

  async countAndOldest(
    params: Omit<OrderListParams, 'sort' | 'limit'>,
  ): Promise<CountAndOldest<Order>> {
    const where = this.#listFilter(params);
    if (where === null) {
      return { count: 0, oldest: null };
    }

    const [row] = await this.#db
      .select({ order: orders, count: sql<number>`(count(*) over ())::int` })
      .from(orders)
      .where(where)
      .orderBy(asc(orders.updatedAt), asc(orders.id))
      .limit(1);
    return row === undefined
      ? { count: 0, oldest: null }
      : { count: row.count, oldest: toOrder(row.order) };
  }
  async transition(
    id: string,
    to: OrderStatus,
    patch: OrderPatch,
    entry: Omit<OrderTransition, 'orderId'>,
    updatedAt: Date,
    expectedLockVersion?: number,
  ): Promise<Order | null> {
    return this.#db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: to,
          ...(patch.jobNumber === undefined ? {} : { jobNumber: patch.jobNumber }),
          ...(patch.confirmedLeadTimeDays === undefined
            ? {}
            : { confirmedLeadTimeDays: patch.confirmedLeadTimeDays }),

          ...(patch.confirmedBy === undefined ? {} : { confirmedBy: patch.confirmedBy }),
          ...(patch.confirmedAt === undefined ? {} : { confirmedAt: patch.confirmedAt }),
          updatedAt,
          lockVersion: sql`${orders.lockVersion} + 1`,
        })

        .where(
          expectedLockVersion === undefined
            ? eq(orders.id, id)
            : and(eq(orders.id, id), eq(orders.lockVersion, expectedLockVersion)),
        )
        .returning();

      if (row === undefined) {
        return expectedLockVersion === undefined
          ? null
          : await staleOrMissing(tx, id, expectedLockVersion);
      }

      await tx.insert(orderTransitions).values({
        id: entry.id,
        orderId: id,
        fromStatus: entry.from,
        toStatus: entry.to,
        reason: entry.reason ?? null,
        actor: entry.actor,
        at: new Date(entry.at),
      });

      return toOrder(row);
    });
  }
  async capturePurchaseOrder(
    id: string,
    po: PurchaseOrderCapture,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<OrderWithLines | null> {
    return await this.#db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          poNumber: po.poNumber ?? null,
          poCapturedBy: po.poNumber === undefined ? null : po.capturedBy,
          poCapturedAt: po.poNumber === undefined ? null : updatedAt,
          updatedAt,
          lockVersion: sql`${orders.lockVersion} + 1`,
        })

        .where(and(eq(orders.id, id), eq(orders.lockVersion, expectedLockVersion)))
        .returning();
      if (row === undefined) {
        return await staleOrMissing(tx, id, expectedLockVersion);
      }
      const lineRows = await tx
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, id))
        .orderBy(asc(orderLines.lineNumber));
      return toOrderWithLines(row, lineRows);
    });
  }
  async history(orderId: string): Promise<readonly OrderTransition[]> {
    const rows = await this.#db
      .select()
      .from(orderTransitions)
      .where(eq(orderTransitions.orderId, orderId))
      .orderBy(asc(orderTransitions.at));
    return rows.map(toTransition);
  }
}
