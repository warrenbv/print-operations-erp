// The PostgreSQL adapter for `QuoteRepository` in modules/quoting/src/ports.ts. It and the
// in-memory adapter are held to modules/quoting/test/contracts/quote-repository.contract.ts.
// Guarded writes put `lockVersion` in the WHERE clause. When nothing matches, a second read tells a
// stale version from a missing quote. A line replacement instead locks the row and compares the
// version it holds: docs/decisions/006-optimistic-concurrency.md.
import { isForeignKeyViolation, isUniqueViolation } from '@erp/db';
import type {
  CountAndOldest,
  RevenueCategory,
  TaxStatus,
  DeliveryAddress,
  FloorStatus,
  FreightInput,
  FreightResult,
  PriceSource,
  PricingBasis,
  Quote,
  QuoteLine,
  QuoteListItem,
  QuoteOverrideDecision,
  QuoteOverrideDecisionKind,
  QuoteOverrideKind,
  QuoteSend,
  QuoteStatus,
  QuoteWithLines,
  ShippingMode,
  TierSelectionSource,
} from '@erp/types';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type { QuotingDb } from '../../data/quoting-db';
import {
  quoteApprovals,
  quoteLines,
  quoteOverrideDecisions,
  quoteSends,
  quotes,
} from '../../data/schema';
import { toQuoteApproval } from './drizzle-quote-approval-repository';
import {
  LineEditRevocationMissingError,
  QuoteNotEditableError,
  QuoteNotRevisableError,
  QuoteVersionConflictError,
  StaleAggregateError,
  UnknownGradeOnLineError,
} from '../../ports';
import { canTransition, isEditable } from '../../quote-state-machine';
import type {
  LineEditRevocations,
  NewQuoteLine,
  NewQuoteRow,
  NewQuoteSend,
  QuoteHeaderPatch,
  QuoteListParams,
  QuoteRepository,
  SpentQuoteApproval,
} from '../../ports';

type QuoteRow = typeof quotes.$inferSelect;
type LineRow = typeof quoteLines.$inferSelect;
type SendRow = typeof quoteSends.$inferSelect;

function toQuoteSend(row: SendRow): QuoteSend {
  return {
    id: row.id,
    quoteId: row.quoteId,
    messageId: row.messageId,
    actor: row.actor,
    acceptedByRelayAt: row.acceptedByRelayAt.toISOString(),
  };
}

function toDecisionRow(
  quoteId: string,
  entry: Omit<QuoteOverrideDecision, 'quoteId'>,
): typeof quoteOverrideDecisions.$inferInsert {
  return {
    id: entry.id,
    quoteId,
    decision: entry.decision,
    kind: entry.kind,
    actor: entry.actor,
    reason: entry.reason ?? null,
    at: new Date(entry.at),
  };
}

function toQuote(row: QuoteRow): Quote {
  return {
    id: row.id,
    customerId: row.customerId,

    status: row.status as QuoteStatus,
    rootQuoteId: row.rootQuoteId,
    versionNumber: row.versionNumber,
    quoteNumber: row.quoteNumber,
    lockVersion: row.lockVersion,
    ...(row.leadTimeDays === null ? {} : { leadTimeDays: row.leadTimeDays }),
    ...(row.leadTimeSetBy === null ? {} : { leadTimeSetBy: row.leadTimeSetBy }),
    ...(row.leadTimeSetAt === null ? {} : { leadTimeSetAt: row.leadTimeSetAt.toISOString() }),
    ...(row.salesRep === null ? {} : { salesRep: row.salesRep }),
    ...(row.notes === null ? {} : { notes: row.notes }),
    freightInRollPrice: row.freightInRollPrice,
    ...(row.overrideApprovedBy === null ? {} : { overrideApprovedBy: row.overrideApprovedBy }),
    ...(row.overrideApprovedAt === null
      ? {}
      : { overrideApprovedAt: row.overrideApprovedAt.toISOString() }),
    ...(row.floorOverrideBy === null ? {} : { floorOverrideBy: row.floorOverrideBy }),
    ...(row.floorOverrideAt === null ? {} : { floorOverrideAt: row.floorOverrideAt.toISOString() }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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

function toFreightResult(row: LineRow): FreightResult {
  return {
    mode: row.freightMode as ShippingMode,
    cost: row.freightCost,
    margin: row.freightMargin,
    invoiceTotal: row.freightInvoiceTotal,
    pending: row.freightPending,
  };
}

// The readers below fail loudly on a row that breaks the shape the baseline CHECK constraints
// guarantee, instead of returning a line that looks valid.
function toFloorStatus(row: LineRow): FloorStatus {
  if (row.floorStatus !== 'below_floor') {
    return { status: 'ok' };
  }
  if (row.floorPct === null || row.floorMinimumPricePerRoll === null) {
    throw new Error(`quote line ${row.id} is below_floor with no floor detail stored`);
  }
  return {
    status: 'below_floor',
    floorPct: row.floorPct,
    minimumPricePerRoll: row.floorMinimumPricePerRoll,
  };
}

function toDeliveryAddress(row: LineRow): DeliveryAddress | undefined {
  if (row.deliveryLine1 === null) {
    return undefined;
  }
  if (row.deliveryCity === null || row.deliveryState === null || row.deliveryPostalCode === null) {
    throw new Error(`quote line ${row.id} carries a partial delivery address`);
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

function toLine(row: LineRow): QuoteLine {
  const deliveryAddress = toDeliveryAddress(row);
  return {
    id: row.id,
    quoteId: row.quoteId,
    lineNumber: row.lineNumber,

    revenueCategory: row.revenueCategory as RevenueCategory,
    printed: row.printed,
    taxStatus: row.taxStatus as TaxStatus,
    ...(row.taxJurisdiction === null ? {} : { taxJurisdiction: row.taxJurisdiction }),

    ...(row.customerPartNumber === null ? {} : { customerPartNumber: row.customerPartNumber }),
    ...(row.customerDescription === null ? {} : { customerDescription: row.customerDescription }),

    gradeId: row.gradeId,
    footageVariant: row.footageVariant,
    rollWidthIn: row.rollWidthIn,
    customWidth: row.customWidth,
    quantityRolls: row.quantityRolls,
    overwrap: row.overwrap,
    pricingBasis: row.pricingBasis as PricingBasis,
    ...(row.orderedWeightLb === null ? {} : { orderedWeightLb: row.orderedWeightLb }),
    ...(row.feetPerRollOverride === null ? {} : { feetPerRollOverride: row.feetPerRollOverride }),
    ...(row.convertCostPerTon === null ? {} : { convertCostPerTon: row.convertCostPerTon }),
    ...(row.printCostPerTon === null ? {} : { printCostPerTon: row.printCostPerTon }),
    ...(row.tierOverrideCode === null ? {} : { tierOverrideCode: row.tierOverrideCode }),
    ...(row.overridePricePerRoll === null
      ? {}
      : { overridePricePerRoll: row.overridePricePerRoll }),
    ...(row.overridePricePerLb === null ? {} : { overridePricePerLb: row.overridePricePerLb }),
    ...(row.marginOverridePct === null ? {} : { marginOverridePct: row.marginOverridePct }),
    freight: toFreightInput(row),
    ...(deliveryAddress === undefined ? {} : { deliveryAddress }),

    cost: {
      rollWeightLb: row.rollWeightLb,
      paperCostPerLb: row.paperCostPerLb,
      paperCostPerRoll: row.paperCostPerRoll,
      hardwareCostPerRoll: row.hardwareCostPerRoll,
      addOnCostPerRoll: row.addOnCostPerRoll,
      totalCostPerRoll: row.totalCostPerRoll,
      rollsPerPallet: row.rollsPerPallet,
      feetPerRoll: row.feetPerRoll,
    },
    tier: {
      id: row.tierId,
      code: row.tierCode,
      name: row.tierName,
      marginPct: row.tierMarginPct,
      source: row.tierSource as TierSelectionSource,
    },
    pallets: row.pallets,

    basePricePerRoll: row.basePricePerRoll,
    pricePerRoll: row.pricePerRoll,
    priceSource: row.priceSource as PriceSource,

    ...(row.marginPricePerRoll === null ? {} : { marginPricePerRoll: row.marginPricePerRoll }),
    deliveredPricePerRoll: row.deliveredPricePerRoll,

    marginPct: row.marginPct,
    floor: toFloorStatus(row),
    freightResult: toFreightResult(row),

    extendedPrice: row.extendedPrice,
    extendedCost: row.extendedCost,
    extendedMargin: row.extendedMargin,

    estimatedWeightLb: row.estimatedWeightLb,
    pricePerLb: row.pricePerLb,
    effectivePricePerLb: row.effectivePricePerLb,

    ...(row.basePricePerLb === null ? {} : { basePricePerLb: row.basePricePerLb }),
    ...(row.productPricePerLb === null ? {} : { productPricePerLb: row.productPricePerLb }),

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRow(line: NewQuoteLine, quoteId: string, stamp: Date): typeof quoteLines.$inferInsert {
  return {
    id: line.id,
    quoteId,
    lineNumber: line.lineNumber,
    revenueCategory: line.revenueCategory,
    printed: line.printed,
    taxStatus: line.taxStatus,

    taxJurisdiction: line.taxJurisdiction ?? null,

    customerPartNumber: line.customerPartNumber ?? null,
    customerDescription: line.customerDescription ?? null,

    gradeId: line.gradeId,
    footageVariant: line.footageVariant,
    rollWidthIn: line.rollWidthIn,
    customWidth: line.customWidth ?? false,
    quantityRolls: line.quantityRolls,
    overwrap: line.overwrap,
    pricingBasis: line.pricingBasis,
    orderedWeightLb: line.orderedWeightLb ?? null,
    feetPerRollOverride: line.feetPerRollOverride ?? null,
    convertCostPerTon: line.convertCostPerTon ?? null,
    printCostPerTon: line.printCostPerTon ?? null,
    tierOverrideCode: line.tierOverrideCode ?? null,
    overridePricePerRoll: line.overridePricePerRoll ?? null,
    overridePricePerLb: line.overridePricePerLb ?? null,

    marginOverridePct: line.marginOverridePct ?? null,

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

    deliveryName: line.deliveryAddress?.name ?? null,
    deliveryLine1: line.deliveryAddress?.line1 ?? null,
    deliveryLine2: line.deliveryAddress?.line2 ?? null,
    deliveryCity: line.deliveryAddress?.city ?? null,
    deliveryState: line.deliveryAddress?.state ?? null,
    deliveryPostalCode: line.deliveryAddress?.postalCode ?? null,

    rollWeightLb: line.cost.rollWeightLb,
    paperCostPerLb: line.cost.paperCostPerLb,
    paperCostPerRoll: line.cost.paperCostPerRoll,
    hardwareCostPerRoll: line.cost.hardwareCostPerRoll,
    addOnCostPerRoll: line.cost.addOnCostPerRoll,
    totalCostPerRoll: line.cost.totalCostPerRoll,
    rollsPerPallet: line.cost.rollsPerPallet,
    feetPerRoll: line.cost.feetPerRoll,

    tierId: line.tier.id,
    tierCode: line.tier.code,
    tierName: line.tier.name,
    tierMarginPct: line.tier.marginPct,
    tierSource: line.tier.source,

    pallets: line.pallets,
    priceSource: line.priceSource,
    basePricePerRoll: line.basePricePerRoll,
    marginPricePerRoll: line.marginPricePerRoll ?? null,
    pricePerRoll: line.pricePerRoll,
    deliveredPricePerRoll: line.deliveredPricePerRoll,
    marginPct: line.marginPct,
    floorStatus: line.floor.status,
    floorPct: line.floor.status === 'below_floor' ? line.floor.floorPct : null,
    floorMinimumPricePerRoll:
      line.floor.status === 'below_floor' ? line.floor.minimumPricePerRoll : null,
    extendedPrice: line.extendedPrice,
    extendedCost: line.extendedCost,
    extendedMargin: line.extendedMargin,
    estimatedWeightLb: line.estimatedWeightLb,
    pricePerLb: line.pricePerLb,
    effectivePricePerLb: line.effectivePricePerLb,

    basePricePerLb: line.basePricePerLb ?? null,
    productPricePerLb: line.productPricePerLb ?? null,

    createdAt: stamp,
    updatedAt: stamp,
  };
}

function quoteValues(input: NewQuoteRow): typeof quotes.$inferInsert {
  return {
    id: input.id,
    customerId: input.customerId,
    status: input.status,
    rootQuoteId: input.rootQuoteId,
    versionNumber: input.versionNumber,

    ...(input.quoteNumber === undefined ? {} : { quoteNumber: input.quoteNumber }),
    salesRep: input.salesRep ?? null,
    notes: input.notes ?? null,

    freightInRollPrice: input.freightInRollPrice ?? false,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

// Thrown inside the transaction to roll the quote insert back when there is no exception to spend.
const NO_UNSPENT_APPROVAL = Symbol('no unspent approval');

export class DrizzleQuoteRepository implements QuoteRepository {
  readonly #db: QuotingDb;

  constructor(db: QuotingDb) {
    this.#db = db;
  }

  async create(input: NewQuoteRow): Promise<Quote> {
    const [row] = await this.#db.insert(quotes).values(quoteValues(input)).returning();
    if (row === undefined) {
      throw new Error('insert returned no row');
    }
    return toQuote(row);
  }

  async createSpendingApproval(input: NewQuoteRow): Promise<SpentQuoteApproval | null> {
    try {
      return await this.#db.transaction(async (tx) => {
        const [row] = await tx.insert(quotes).values(quoteValues(input)).returning();
        if (row === undefined) {
          throw new Error('insert returned no row');
        }

        const [approval] = await tx
          .update(quoteApprovals)
          .set({ spentByQuoteId: row.id, spentAt: input.createdAt })
          .where(
            and(
              eq(quoteApprovals.customerId, input.customerId),
              eq(quoteApprovals.status, 'approved'),
              isNull(quoteApprovals.spentByQuoteId),
            ),
          )
          .returning();

        if (approval === undefined) {
          throw NO_UNSPENT_APPROVAL;
        }

        return { quote: toQuote(row), approval: toQuoteApproval(approval) };
      });
    } catch (err) {
      if (err === NO_UNSPENT_APPROVAL) {
        return null;
      }
      throw err;
    }
  }

  async findById(id: string): Promise<Quote | null> {
    const [row] = await this.#db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    return row === undefined ? null : toQuote(row);
  }

  async findWithLines(id: string): Promise<QuoteWithLines | null> {
    const [header] = await this.#db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    if (header === undefined) {
      return null;
    }
    const rows = await this.#db
      .select()
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, id))
      .orderBy(asc(quoteLines.lineNumber));

    return { ...toQuote(header), lines: rows.map(toLine) };
  }

  #listFilter(params: QuoteListParams): SQL | undefined | null {
    if (params.customerIds !== undefined && params.customerIds.length === 0) {
      return null;
    }
    if (params.ids !== undefined && params.ids.length === 0) {
      return null;
    }
    const filters = [
      ...(params.status === undefined ? [] : [eq(quotes.status, params.status)]),

      ...(params.customerIds === undefined
        ? []
        : [inArray(quotes.customerId, [...params.customerIds])]),

      ...(params.ids === undefined ? [] : [inArray(quotes.id, [...params.ids])]),
      ...(params.quoteNumber === undefined ? [] : [eq(quotes.quoteNumber, params.quoteNumber)]),

      ...(params.salesRep === undefined ? [] : [eq(quotes.salesRep, params.salesRep)]),

      ...(params.leadTime === undefined ? [] : [isNull(quotes.leadTimeDays)]),
    ];
    return filters.length === 0 ? undefined : and(...filters);
  }

  async list(params: QuoteListParams): Promise<readonly QuoteListItem[]> {
    const where = this.#listFilter(params);
    if (where === null) {
      return [];
    }

    const order =
      params.sort === 'oldest'
        ? [asc(quotes.updatedAt), asc(quotes.id)]
        : params.sort === 'newest'
          ? [desc(quotes.updatedAt), desc(quotes.id)]
          : [desc(quotes.createdAt)];

    // The line counts are correlated subqueries, so each quote stays one row and the limit applies
    // to quotes.
    const linesOfThisQuote = sql`${quoteLines.quoteId} = ${quotes.id}`;
    const query = this.#db
      .select({
        quote: quotes,
        lineCount: sql<number>`(select count(*)::int from ${quoteLines} where ${linesOfThisQuote})`,
        belowFloorCount: sql<number>`(select count(*)::int from ${quoteLines} where ${linesOfThisQuote} and ${quoteLines.floorStatus} = 'below_floor')`,
        manualCount: sql<number>`(select count(*)::int from ${quoteLines} where ${linesOfThisQuote} and ${quoteLines.priceSource} = 'manual')`,
        manualPricePerRoll: sql<
          string | null
        >`(select ${quoteLines.pricePerRoll} from ${quoteLines} where ${linesOfThisQuote} and ${quoteLines.priceSource} = 'manual' order by ${quoteLines.lineNumber} limit 1)`,
      })
      .from(quotes)
      .where(where)
      .orderBy(...order);

    const rows = await (params.limit === undefined ? query : query.limit(params.limit));
    return rows.map((row) => ({
      ...toQuote(row.quote),
      lineCount: row.lineCount,
      belowFloorCount: row.belowFloorCount,
      manualCount: row.manualCount,
      manualPricePerRoll: row.manualPricePerRoll,
    }));
  }

  async countAndOldest(
    params: Omit<QuoteListParams, 'sort' | 'limit'>,
  ): Promise<CountAndOldest<Quote>> {
    const where = this.#listFilter(params);
    if (where === null) {
      return { count: 0, oldest: null };
    }

    const [row] = await this.#db
      .select({ quote: quotes, count: sql<number>`(count(*) over ())::int` })
      .from(quotes)
      .where(where)
      .orderBy(asc(quotes.updatedAt), asc(quotes.id))
      .limit(1);
    return row === undefined
      ? { count: 0, oldest: null }
      : { count: row.count, oldest: toQuote(row.quote) };
  }

  async replaceLines(
    quoteId: string,
    lines: readonly NewQuoteLine[],
    updatedAt: Date,
    expectedLockVersion?: number,
    header: QuoteHeaderPatch = {},
    revocations?: LineEditRevocations,
  ): Promise<QuoteWithLines | null> {
    const replaced = await this.#db.transaction(async (tx) => {
      // The row is locked before it is read, so whether the quote may still be edited and what is
      // revoked are decided from the row this transaction writes, and no other write to the quote
      // lands until it commits.
      const [locked] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for('update');
      if (locked === undefined) {
        return null;
      }
      if (expectedLockVersion !== undefined && locked.lockVersion !== expectedLockVersion) {
        throw new StaleAggregateError('quote', quoteId, expectedLockVersion, locked.lockVersion);
      }
      if (!isEditable(locked.status as QuoteStatus)) {
        throw new QuoteNotEditableError(quoteId, locked.status as QuoteStatus);
      }

      const live: QuoteOverrideKind[] = [
        ...(locked.overrideApprovedBy === null ? [] : ['price' as const]),
        ...(locked.floorOverrideBy === null ? [] : ['floor' as const]),
      ];
      const entries = live.map((kind) => {
        const entry = revocations?.[kind];
        if (entry === undefined) {
          throw new LineEditRevocationMissingError(quoteId, kind);
        }
        return toDecisionRow(quoteId, { ...entry, decision: 'revoked', kind });
      });

      const [written] = await tx
        .update(quotes)
        .set({
          updatedAt,
          lockVersion: sql`${quotes.lockVersion} + 1`,
          ...(header.freightInRollPrice === undefined
            ? {}
            : { freightInRollPrice: header.freightInRollPrice }),
          ...(live.includes('price') ? { overrideApprovedBy: null, overrideApprovedAt: null } : {}),
          ...(live.includes('floor') ? { floorOverrideBy: null, floorOverrideAt: null } : {}),
          ...(entries.length > 0 && canTransition(locked.status as QuoteStatus, 'draft')
            ? { status: 'draft' }
            : {}),
        })
        // The version predicate repeats what the lock guarantees, so the write fails closed if the
        // lock is ever lost.
        .where(and(eq(quotes.id, quoteId), eq(quotes.lockVersion, locked.lockVersion)))
        .returning();
      if (written === undefined) {
        throw new Error(`update of locked quote "${quoteId}" returned no row`);
      }

      // The lines are replaced wholesale in the transaction that bumped the quote's `lockVersion`,
      // so a line edit always moves the quote's version.
      await tx.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId));
      if (lines.length > 0) {
        try {
          await tx.insert(quoteLines).values(lines.map((line) => toRow(line, quoteId, updatedAt)));
        } catch (err) {
          if (isForeignKeyViolation(err)) {
            throw new UnknownGradeOnLineError(quoteId);
          }
          throw err;
        }
      }
      if (entries.length > 0) {
        await tx.insert(quoteOverrideDecisions).values(entries);
      }
      return written;
    });

    return replaced === null ? null : this.findWithLines(quoteId);
  }

  async transition(
    id: string,
    to: QuoteStatus,
    updatedAt: Date,
    expectedLockVersion?: number,
    log: readonly Omit<QuoteOverrideDecision, 'quoteId'>[] = [],
  ): Promise<Quote | null> {
    return this.#db.transaction(async (tx) => {
      const guard =
        expectedLockVersion === undefined
          ? eq(quotes.id, id)
          : and(eq(quotes.id, id), eq(quotes.lockVersion, expectedLockVersion));

      const [row] = await tx
        .update(quotes)
        .set({ status: to, updatedAt, lockVersion: sql`${quotes.lockVersion} + 1` })
        .where(guard)
        .returning();

      if (row === undefined) {
        if (expectedLockVersion !== undefined) {
          const [current] = await tx.select().from(quotes).where(eq(quotes.id, id));
          if (current !== undefined) {
            throw new StaleAggregateError('quote', id, expectedLockVersion, current.lockVersion);
          }
        }
        return null;
      }

      if (log.length > 0) {
        await tx.insert(quoteOverrideDecisions).values(log.map((e) => toDecisionRow(id, e)));
      }
      return toQuote(row);
    });
  }

  async setLeadTime(
    quoteId: string,
    leadTimeDays: number,
    setBy: string,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<Quote | null> {
    const [row] = await this.#db
      .update(quotes)
      .set({
        leadTimeDays,
        leadTimeSetBy: setBy,
        leadTimeSetAt: updatedAt,
        updatedAt,
        lockVersion: sql`${quotes.lockVersion} + 1`,
      })
      .where(and(eq(quotes.id, quoteId), eq(quotes.lockVersion, expectedLockVersion)))
      .returning();

    if (row === undefined) {
      const [current] = await this.#db.select().from(quotes).where(eq(quotes.id, quoteId));
      if (current !== undefined) {
        throw new StaleAggregateError('quote', quoteId, expectedLockVersion, current.lockVersion);
      }
      return null;
    }
    return toQuote(row);
  }

  async recordOverrideDecision(
    quoteId: string,
    approval: { by: string; at: Date } | null,
    entry: Omit<QuoteOverrideDecision, 'quoteId'>,
    updatedAt: Date,
    expectedLockVersion?: number,
    toDraft = false,
  ): Promise<Quote | null> {
    return this.#db.transaction(async (tx) => {
      const guard =
        expectedLockVersion === undefined
          ? eq(quotes.id, quoteId)
          : and(eq(quotes.id, quoteId), eq(quotes.lockVersion, expectedLockVersion));

      const by = approval === null ? null : approval.by;
      const at = approval === null ? null : approval.at;
      const pair =
        entry.kind === 'floor'
          ? { floorOverrideBy: by, floorOverrideAt: at }
          : { overrideApprovedBy: by, overrideApprovedAt: at };

      const [row] = await tx
        .update(quotes)
        .set({
          ...pair,
          ...(toDraft ? { status: 'draft' } : {}),
          updatedAt,
          lockVersion: sql`${quotes.lockVersion} + 1`,
        })
        .where(guard)
        .returning();

      if (row === undefined) {
        if (expectedLockVersion !== undefined) {
          const [current] = await tx.select().from(quotes).where(eq(quotes.id, quoteId));
          if (current !== undefined) {
            throw new StaleAggregateError(
              'quote',
              quoteId,
              expectedLockVersion,
              current.lockVersion,
            );
          }
        }
        return null;
      }

      await tx.insert(quoteOverrideDecisions).values(toDecisionRow(quoteId, entry));

      return toQuote(row);
    });
  }

  async draftLinesUsingGradeVariant(
    gradeId: string,
    variant: string,
  ): Promise<readonly { quoteId: string; lineNumber: number }[]> {
    const rows = await this.#db
      .select({ quoteId: quoteLines.quoteId, lineNumber: quoteLines.lineNumber })
      .from(quoteLines)
      .innerJoin(quotes, eq(quoteLines.quoteId, quotes.id))
      .where(
        and(
          eq(quoteLines.gradeId, gradeId),
          eq(quoteLines.footageVariant, variant),
          eq(quotes.status, 'draft'),
        ),
      )

      .orderBy(asc(quoteLines.quoteId), asc(quoteLines.lineNumber));
    return rows;
  }

  async draftLinesUsingGradeWidth(
    gradeId: string,
    rollWidthIn: number,
  ): Promise<readonly { quoteId: string; lineNumber: number }[]> {
    return this.#db
      .select({ quoteId: quoteLines.quoteId, lineNumber: quoteLines.lineNumber })
      .from(quoteLines)
      .innerJoin(quotes, eq(quoteLines.quoteId, quotes.id))
      .where(
        and(
          eq(quoteLines.gradeId, gradeId),
          eq(quoteLines.rollWidthIn, rollWidthIn),
          eq(quoteLines.customWidth, false),
          eq(quotes.status, 'draft'),
        ),
      )

      .orderBy(asc(quoteLines.quoteId), asc(quoteLines.lineNumber));
  }

  async overrideDecisions(quoteId: string): Promise<readonly QuoteOverrideDecision[]> {
    const rows = await this.#db
      .select()
      .from(quoteOverrideDecisions)
      .where(eq(quoteOverrideDecisions.quoteId, quoteId))
      .orderBy(asc(quoteOverrideDecisions.at));
    return rows.map((row) => ({
      id: row.id,
      quoteId: row.quoteId,
      decision: row.decision as QuoteOverrideDecisionKind,

      kind: row.kind as QuoteOverrideKind,
      actor: row.actor,
      ...(row.reason === null ? {} : { reason: row.reason }),
      at: row.at.toISOString(),
    }));
  }

  async recordSend(input: NewQuoteSend): Promise<QuoteSend> {
    const [row] = await this.#db
      .insert(quoteSends)
      .values({
        id: input.id,
        quoteId: input.quoteId,
        messageId: input.messageId,
        actor: input.actor,
        acceptedByRelayAt: input.acceptedByRelayAt,
      })
      .returning();
    if (row === undefined) {
      throw new Error(`insert of send record for quote "${input.quoteId}" returned no row`);
    }
    return toQuoteSend(row);
  }

  async sendsForChain(rootQuoteId: string): Promise<readonly QuoteSend[]> {
    const rows = await this.#db
      .select({ send: quoteSends })
      .from(quoteSends)
      .innerJoin(quotes, eq(quoteSends.quoteId, quotes.id))
      .where(eq(quotes.rootQuoteId, rootQuoteId))
      .orderBy(asc(quoteSends.acceptedByRelayAt));
    return rows.map((row) => toQuoteSend(row.send));
  }

  async versions(rootQuoteId: string): Promise<readonly Quote[]> {
    const rows = await this.#db
      .select()
      .from(quotes)
      .where(eq(quotes.rootQuoteId, rootQuoteId))
      .orderBy(asc(quotes.versionNumber));
    return rows.map(toQuote);
  }

  async revise(
    originalId: string,
    next: NewQuoteRow,
    lines: readonly NewQuoteLine[],
    at: Date,
    expectedLockVersion?: number,
  ): Promise<QuoteWithLines | null> {
    const done = await this.#db.transaction(async (tx) => {
      // The original is locked before it is read, so a close or a second revision waits for this
      // one, and the status checked is the status superseded.
      const [original] = await tx
        .select()
        .from(quotes)
        .where(eq(quotes.id, originalId))
        .for('update');
      if (original === undefined) {
        return null;
      }
      if (original.status !== 'quoted') {
        throw new QuoteNotRevisableError(originalId, original.status as QuoteStatus);
      }
      if (expectedLockVersion !== undefined && original.lockVersion !== expectedLockVersion) {
        throw new StaleAggregateError(
          'quote',
          originalId,
          expectedLockVersion,
          original.lockVersion,
        );
      }

      try {
        await tx.insert(quotes).values(quoteValues(next));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new QuoteVersionConflictError(next.rootQuoteId, next.versionNumber);
        }
        throw err;
      }

      if (lines.length > 0) {
        await tx.insert(quoteLines).values(lines.map((line) => toRow(line, next.id, at)));
      }

      // The original is superseded in the same transaction that inserts the next version. The
      // version predicate repeats what the lock guarantees, so the write fails closed if the lock
      // is ever lost.
      const [superseded] = await tx
        .update(quotes)
        .set({ status: 'superseded', updatedAt: at, lockVersion: sql`${quotes.lockVersion} + 1` })
        .where(and(eq(quotes.id, originalId), eq(quotes.lockVersion, original.lockVersion)))
        .returning();
      if (superseded === undefined) {
        throw new Error(`update of locked quote "${originalId}" returned no row`);
      }

      return original;
    });

    return done === null ? null : this.findWithLines(next.id);
  }
}
