// PostgreSQL `CustomerRepository` over the crm schema.
// Writes compare lockVersion in the WHERE clause, so a stale write changes no row:
// docs/decisions/006-optimistic-concurrency.md.
import { StaleAggregateError, isUniqueViolation } from '@erp/db';
import {
  type BillingAddress,
  type Customer,
  type PaymentTerms,
  type ShippingAddress,
} from '@erp/types';
import { and, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import type { CrmDb } from '../../data/crm-db';
import { customers } from '../../data/schema';
import {
  DuplicateLegacyAccountNumberError,
  type CustomerNamePage,
  type CustomerPatch,
  type CustomerRepository,
  type CustomerSearchPage,
  type CustomerSearchParams,
  type NewCustomer,
} from '../../ports';

type Row = typeof customers.$inferSelect;

// A guarded write that matched no row is either stale or missing. Re-reading tells them apart:
// stale throws, missing answers null.
async function staleOrMissing(db: CrmDb, id: string, expectedLockVersion: number): Promise<null> {
  const [current] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (current !== undefined) {
    throw new StaleAggregateError('customer', id, expectedLockVersion, current.lockVersion);
  }
  return null;
}

function toPaymentTerms(row: Row): PaymentTerms {
  return { netDays: row.netDays };
}

function fromPaymentTerms(terms: PaymentTerms): {
  paymentTermsKind: string;
  netDays: number;
} {
  return { paymentTermsKind: 'net', netDays: terms.netDays };
}

function toBillingAddress(row: Row): BillingAddress | undefined {
  const { billingLine1, billingCity, billingState, billingPostalCode } = row;
  if (
    billingLine1 === null ||
    billingCity === null ||
    billingState === null ||
    billingPostalCode === null
  ) {
    return undefined;
  }
  return {
    ...(row.billingName === null ? {} : { name: row.billingName }),
    line1: billingLine1,
    ...(row.billingLine2 === null ? {} : { line2: row.billingLine2 }),
    city: billingCity,
    state: billingState,
    postalCode: billingPostalCode,
  };
}

function fromBillingAddress(address: BillingAddress): {
  billingName: string | null;
  billingLine1: string;
  billingLine2: string | null;
  billingCity: string;
  billingState: string;
  billingPostalCode: string;
} {
  return {
    billingName: address.name ?? null,
    billingLine1: address.line1,
    billingLine2: address.line2 ?? null,
    billingCity: address.city,
    billingState: address.state,
    billingPostalCode: address.postalCode,
  };
}

// Clearing an address nulls every column of it, which customers_billing_address_check requires.
function clearBillingAddress(): {
  billingName: null;
  billingLine1: null;
  billingLine2: null;
  billingCity: null;
  billingState: null;
  billingPostalCode: null;
} {
  return {
    billingName: null,
    billingLine1: null,
    billingLine2: null,
    billingCity: null,
    billingState: null,
    billingPostalCode: null,
  };
}

function toShippingAddress(row: Row): ShippingAddress | undefined {
  const { shippingLine1, shippingCity, shippingState, shippingPostalCode } = row;
  if (
    shippingLine1 === null ||
    shippingCity === null ||
    shippingState === null ||
    shippingPostalCode === null
  ) {
    return undefined;
  }
  return {
    ...(row.shippingName === null ? {} : { name: row.shippingName }),
    line1: shippingLine1,
    ...(row.shippingLine2 === null ? {} : { line2: row.shippingLine2 }),
    city: shippingCity,
    state: shippingState,
    postalCode: shippingPostalCode,
  };
}

function fromShippingAddress(address: ShippingAddress): {
  shippingName: string | null;
  shippingLine1: string;
  shippingLine2: string | null;
  shippingCity: string;
  shippingState: string;
  shippingPostalCode: string;
} {
  return {
    shippingName: address.name ?? null,
    shippingLine1: address.line1,
    shippingLine2: address.line2 ?? null,
    shippingCity: address.city,
    shippingState: address.state,
    shippingPostalCode: address.postalCode,
  };
}

function clearShippingAddress(): {
  shippingName: null;
  shippingLine1: null;
  shippingLine2: null;
  shippingCity: null;
  shippingState: null;
  shippingPostalCode: null;
} {
  return {
    shippingName: null,
    shippingLine1: null,
    shippingLine2: null,
    shippingCity: null,
    shippingState: null,
    shippingPostalCode: null,
  };
}

function toCustomer(row: Row): Customer {
  const billingAddress = toBillingAddress(row);
  const shippingAddress = toShippingAddress(row);
  return {
    id: row.id,
    name: row.name,
    ...(row.legacyAccountNumber === null ? {} : { legacyAccountNumber: row.legacyAccountNumber }),
    ...(row.legacyUmbrellaAccountNumber === null
      ? {}
      : { legacyUmbrellaAccountNumber: row.legacyUmbrellaAccountNumber }),
    paymentTerms: toPaymentTerms(row),
    lockVersion: row.lockVersion,
    ...(row.taxJurisdiction === null ? {} : { taxJurisdiction: row.taxJurisdiction }),
    taxExempt: row.taxExempt,
    ...(row.taxExemptionDocRef === null ? {} : { taxExemptionDocRef: row.taxExemptionDocRef }),
    reseller: row.reseller,
    ...(billingAddress === undefined ? {} : { billingAddress }),
    ...(shippingAddress === undefined ? {} : { shippingAddress }),
    ...(row.freightMarginPct === null ? {} : { freightMarginPct: row.freightMarginPct }),
    ...(row.accountRepUsername === null ? {} : { accountRepUsername: row.accountRepUsername }),

    creditHold: row.creditHold,
    ...(row.creditHoldSetBy === null ? {} : { creditHoldSetBy: row.creditHoldSetBy }),
    ...(row.creditHoldSetAt === null ? {} : { creditHoldSetAt: row.creditHoldSetAt.toISOString() }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleCustomerRepository implements CustomerRepository {
  readonly #db: CrmDb;

  constructor(db: CrmDb) {
    this.#db = db;
  }

  async create(
    input: NewCustomer & { id: string; createdAt: Date; updatedAt: Date },
  ): Promise<Customer> {
    try {
      const [row] = await this.#db
        .insert(customers)
        .values({
          id: input.id,
          name: input.name,
          legacyAccountNumber: input.legacyAccountNumber ?? null,
          legacyUmbrellaAccountNumber: input.legacyUmbrellaAccountNumber ?? null,
          ...fromPaymentTerms(input.paymentTerms),
          taxJurisdiction: input.taxJurisdiction ?? null,
          taxExempt: input.taxExempt,
          taxExemptionDocRef: input.taxExemptionDocRef ?? null,
          reseller: input.reseller,

          ...(input.billingAddress === undefined ? {} : fromBillingAddress(input.billingAddress)),

          ...(input.shippingAddress === undefined
            ? {}
            : fromShippingAddress(input.shippingAddress)),
          freightMarginPct: input.freightMarginPct ?? null,
          accountRepUsername: input.accountRepUsername ?? null,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })
        .returning();
      if (row === undefined) {
        throw new Error('Creating a customer returned no row');
      }
      return toCustomer(row);
    } catch (err) {
      if (isUniqueViolation(err) && input.legacyAccountNumber !== undefined) {
        throw new DuplicateLegacyAccountNumberError(input.legacyAccountNumber);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<Customer | null> {
    const [row] = await this.#db.select().from(customers).where(eq(customers.id, id)).limit(1);
    return row === undefined ? null : toCustomer(row);
  }

  async update(
    id: string,
    patch: CustomerPatch,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<Customer | null> {
    const hasChange =
      patch.name !== undefined ||
      patch.legacyAccountNumber !== undefined ||
      patch.legacyUmbrellaAccountNumber !== undefined ||
      patch.paymentTerms !== undefined ||
      patch.taxJurisdiction !== undefined ||
      patch.taxExempt !== undefined ||
      patch.taxExemptionDocRef !== undefined ||
      patch.reseller !== undefined ||
      patch.billingAddress !== undefined ||
      patch.shippingAddress !== undefined ||
      patch.freightMarginPct !== undefined ||
      patch.accountRepUsername !== undefined;

    if (!hasChange) {
      return this.findById(id);
    }

    try {
      const [row] = await this.#db
        .update(customers)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.legacyAccountNumber === undefined
            ? {}
            : { legacyAccountNumber: patch.legacyAccountNumber }),
          ...(patch.legacyUmbrellaAccountNumber === undefined
            ? {}
            : { legacyUmbrellaAccountNumber: patch.legacyUmbrellaAccountNumber }),

          ...(patch.paymentTerms === undefined ? {} : fromPaymentTerms(patch.paymentTerms)),
          ...(patch.taxJurisdiction === undefined
            ? {}
            : { taxJurisdiction: patch.taxJurisdiction }),
          ...(patch.taxExempt === undefined ? {} : { taxExempt: patch.taxExempt }),
          ...(patch.taxExemptionDocRef === undefined
            ? {}
            : { taxExemptionDocRef: patch.taxExemptionDocRef }),
          ...(patch.reseller === undefined ? {} : { reseller: patch.reseller }),

          ...(patch.billingAddress === undefined
            ? {}
            : patch.billingAddress === null
              ? clearBillingAddress()
              : fromBillingAddress(patch.billingAddress)),

          ...(patch.shippingAddress === undefined
            ? {}
            : patch.shippingAddress === null
              ? clearShippingAddress()
              : fromShippingAddress(patch.shippingAddress)),
          ...(patch.freightMarginPct === undefined
            ? {}
            : { freightMarginPct: patch.freightMarginPct }),

          ...(patch.accountRepUsername === undefined
            ? {}
            : { accountRepUsername: patch.accountRepUsername }),

          updatedAt,
          lockVersion: sql`${customers.lockVersion} + 1`,
        })

        .where(and(eq(customers.id, id), eq(customers.lockVersion, expectedLockVersion)))
        .returning();
      if (row === undefined) {
        return await staleOrMissing(this.#db, id, expectedLockVersion);
      }
      return toCustomer(row);
    } catch (err) {
      if (
        isUniqueViolation(err) &&
        patch.legacyAccountNumber !== undefined &&
        patch.legacyAccountNumber !== null
      ) {
        throw new DuplicateLegacyAccountNumberError(patch.legacyAccountNumber);
      }
      throw err;
    }
  }

  async setCreditHold(
    id: string,
    held: boolean,
    actor: string,
    at: Date,
    expectedLockVersion: number,
  ): Promise<Customer | null> {
    const [row] = await this.#db
      .update(customers)
      .set({
        creditHold: held,
        creditHoldSetBy: actor,
        creditHoldSetAt: at,
        updatedAt: at,
        lockVersion: sql`${customers.lockVersion} + 1`,
      })
      .where(and(eq(customers.id, id), eq(customers.lockVersion, expectedLockVersion)))
      .returning();
    if (row === undefined) {
      return await staleOrMissing(this.#db, id, expectedLockVersion);
    }
    return toCustomer(row);
  }

  async search(params: CustomerSearchParams): Promise<CustomerSearchPage> {
    if (params.ids !== undefined) {
      const rows = await this.#db
        .select()
        .from(customers)
        .where(inArray(customers.id, [...params.ids]))
        .orderBy(customers.name, customers.id);
      return { items: rows.map(toCustomer), total: rows.length };
    }

    const filters = [
      ...(params.q === undefined || params.q === '' ? [] : [matchesQuery(params.q)]),
      ...(params.accountRepUsername === undefined
        ? []
        : [eq(customers.accountRepUsername, params.accountRepUsername)]),
      ...(params.creditHold === undefined ? [] : [eq(customers.creditHold, params.creditHold)]),
    ];
    const where = filters.length === 0 ? undefined : and(...filters);

    const rowsQuery = this.#db
      .select()
      .from(customers)
      .orderBy(customers.name, customers.id)
      .limit(params.limit)
      .offset(params.offset);

    const totalQuery = this.#db.select({ n: count() }).from(customers);

    const [rows, totalRows] = await Promise.all([
      where === undefined ? rowsQuery : rowsQuery.where(where),
      where === undefined ? totalQuery : totalQuery.where(where),
    ]);

    return {
      items: rows.map(toCustomer),
      total: totalRows[0]?.n ?? 0,
    };
  }

  async listNames(limit: number): Promise<CustomerNamePage> {
    const rowsQuery = this.#db
      .select({
        id: customers.id,
        name: customers.name,
        legacyAccountNumber: customers.legacyAccountNumber,
      })
      .from(customers)
      .orderBy(customers.name, customers.id)
      .limit(limit);

    const totalQuery = this.#db.select({ n: count() }).from(customers);

    const [rows, totalRows] = await Promise.all([rowsQuery, totalQuery]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,

        ...(row.legacyAccountNumber === null
          ? {}
          : { legacyAccountNumber: row.legacyAccountNumber }),
      })),
      total: totalRows[0]?.n ?? 0,
    };
  }
}

function matchesQuery(q: string) {
  const needle = `%${escapeIlike(q)}%`;
  return or(
    ilike(customers.name, needle),
    ilike(customers.legacyAccountNumber, needle),
    ilike(customers.legacyUmbrellaAccountNumber, needle),
  );
}

// Escapes the LIKE wildcards so a search for `50%` matches that text, not a pattern.
function escapeIlike(input: string): string {
  return input.replace(/([%_\\])/g, '\\$1');
}
