// In-memory `CustomerRepository` for unit tests and the memory-mode API.
// modules/crm/test/contracts/customer-repository.contract.ts holds it to the Drizzle adapter's behaviour.
import { StaleAggregateError } from '@erp/db';
import type { BillingAddress, Customer, PaymentTerms, ShippingAddress } from '@erp/types';

import type {
  CustomerNamePage,
  CustomerPatch,
  CustomerRepository,
  CustomerSearchPage,
  CustomerSearchParams,
  NewCustomer,
} from '../../ports';
import { DuplicateLegacyAccountNumberError } from '../../ports';

interface Row {
  id: string;
  name: string;
  legacyAccountNumber: string | null;
  legacyUmbrellaAccountNumber: string | null;

  paymentTerms: PaymentTerms;
  taxJurisdiction: string | null;
  taxExempt: boolean;
  taxExemptionDocRef: string | null;
  reseller: boolean;

  billingAddress: BillingAddress | null;

  shippingAddress: ShippingAddress | null;
  freightMarginPct: string | null;

  accountRepUsername: string | null;

  creditHold: boolean;
  creditHoldSetBy: string | null;
  creditHoldSetAt: Date | null;

  lockVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

function guard(row: Row | undefined, id: string, expectedLockVersion: number): Row | null {
  if (row === undefined) {
    return null;
  }
  if (row.lockVersion !== expectedLockVersion) {
    throw new StaleAggregateError('customer', id, expectedLockVersion, row.lockVersion);
  }
  return row;
}

function toCustomer(row: Row): Customer {
  return {
    id: row.id,
    name: row.name,
    lockVersion: row.lockVersion,
    ...(row.legacyAccountNumber === null ? {} : { legacyAccountNumber: row.legacyAccountNumber }),
    ...(row.legacyUmbrellaAccountNumber === null
      ? {}
      : { legacyUmbrellaAccountNumber: row.legacyUmbrellaAccountNumber }),
    paymentTerms: row.paymentTerms,
    ...(row.taxJurisdiction === null ? {} : { taxJurisdiction: row.taxJurisdiction }),
    taxExempt: row.taxExempt,
    ...(row.taxExemptionDocRef === null ? {} : { taxExemptionDocRef: row.taxExemptionDocRef }),
    reseller: row.reseller,
    ...(row.billingAddress === null ? {} : { billingAddress: row.billingAddress }),
    ...(row.shippingAddress === null ? {} : { shippingAddress: row.shippingAddress }),
    ...(row.freightMarginPct === null ? {} : { freightMarginPct: row.freightMarginPct }),
    ...(row.accountRepUsername === null ? {} : { accountRepUsername: row.accountRepUsername }),
    creditHold: row.creditHold,
    ...(row.creditHoldSetBy === null ? {} : { creditHoldSetBy: row.creditHoldSetBy }),
    ...(row.creditHoldSetAt === null ? {} : { creditHoldSetAt: row.creditHoldSetAt.toISOString() }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class InMemoryCustomerRepository implements CustomerRepository {
  readonly #byId = new Map<string, Row>();

  constructor(seed: readonly Customer[] = []) {
    for (const c of seed) {
      this.#byId.set(c.id, {
        id: c.id,
        name: c.name,
        legacyAccountNumber: c.legacyAccountNumber ?? null,
        legacyUmbrellaAccountNumber: c.legacyUmbrellaAccountNumber ?? null,
        paymentTerms: c.paymentTerms,
        taxJurisdiction: c.taxJurisdiction ?? null,
        taxExempt: c.taxExempt,
        taxExemptionDocRef: c.taxExemptionDocRef ?? null,
        reseller: c.reseller,
        billingAddress: c.billingAddress ?? null,
        shippingAddress: c.shippingAddress ?? null,
        freightMarginPct: c.freightMarginPct ?? null,
        accountRepUsername: c.accountRepUsername ?? null,
        creditHold: c.creditHold,
        creditHoldSetBy: c.creditHoldSetBy ?? null,
        creditHoldSetAt: c.creditHoldSetAt === undefined ? null : new Date(c.creditHoldSetAt),
        lockVersion: c.lockVersion,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
      });
    }
  }

  async create(
    input: NewCustomer & { id: string; createdAt: Date; updatedAt: Date },
  ): Promise<Customer> {
    if (input.legacyAccountNumber !== undefined) {
      this.#assertLegacyAccountNumberUnique(input.legacyAccountNumber, null);
    }
    const row: Row = {
      id: input.id,
      name: input.name,
      legacyAccountNumber: input.legacyAccountNumber ?? null,
      legacyUmbrellaAccountNumber: input.legacyUmbrellaAccountNumber ?? null,
      paymentTerms: input.paymentTerms,
      taxJurisdiction: input.taxJurisdiction ?? null,
      taxExempt: input.taxExempt,
      taxExemptionDocRef: input.taxExemptionDocRef ?? null,
      reseller: input.reseller,
      billingAddress: input.billingAddress ?? null,
      shippingAddress: input.shippingAddress ?? null,
      freightMarginPct: input.freightMarginPct ?? null,
      accountRepUsername: input.accountRepUsername ?? null,

      creditHold: false,
      creditHoldSetBy: null,
      creditHoldSetAt: null,
      lockVersion: 1,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
    this.#byId.set(row.id, row);
    return toCustomer(row);
  }

  async findById(id: string): Promise<Customer | null> {
    const row = this.#byId.get(id);
    return row === undefined ? null : toCustomer(row);
  }

  async update(
    id: string,
    patch: CustomerPatch,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<Customer | null> {
    const current = this.#byId.get(id);
    if (current === undefined) {
      return null;
    }

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
    // An empty patch changes nothing, so it returns the row without checking the version, as the
    // Drizzle adapter does: modules/crm/test/contracts/customer-repository.contract.ts.
    if (!hasChange) {
      return toCustomer(current);
    }
    const existing = guard(current, id, expectedLockVersion);
    if (existing === null) {
      return null;
    }
    if (
      patch.legacyAccountNumber !== undefined &&
      patch.legacyAccountNumber !== null &&
      patch.legacyAccountNumber !== existing.legacyAccountNumber
    ) {
      this.#assertLegacyAccountNumberUnique(patch.legacyAccountNumber, id);
    }
    const next: Row = {
      ...existing,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.legacyAccountNumber === undefined
        ? {}
        : { legacyAccountNumber: patch.legacyAccountNumber }),
      ...(patch.legacyUmbrellaAccountNumber === undefined
        ? {}
        : { legacyUmbrellaAccountNumber: patch.legacyUmbrellaAccountNumber }),
      ...(patch.paymentTerms === undefined ? {} : { paymentTerms: patch.paymentTerms }),
      ...(patch.taxJurisdiction === undefined ? {} : { taxJurisdiction: patch.taxJurisdiction }),
      ...(patch.taxExempt === undefined ? {} : { taxExempt: patch.taxExempt }),
      ...(patch.taxExemptionDocRef === undefined
        ? {}
        : { taxExemptionDocRef: patch.taxExemptionDocRef }),
      ...(patch.reseller === undefined ? {} : { reseller: patch.reseller }),

      ...(patch.billingAddress === undefined ? {} : { billingAddress: patch.billingAddress }),

      ...(patch.shippingAddress === undefined ? {} : { shippingAddress: patch.shippingAddress }),
      ...(patch.freightMarginPct === undefined ? {} : { freightMarginPct: patch.freightMarginPct }),

      ...(patch.accountRepUsername === undefined
        ? {}
        : { accountRepUsername: patch.accountRepUsername }),

      updatedAt,
      lockVersion: existing.lockVersion + 1,
    };
    this.#byId.set(id, next);
    return toCustomer(next);
  }

  async setCreditHold(
    id: string,
    held: boolean,
    actor: string,
    at: Date,
    expectedLockVersion: number,
  ): Promise<Customer | null> {
    const existing = guard(this.#byId.get(id), id, expectedLockVersion);
    if (existing === null) {
      return null;
    }

    const next: Row = {
      ...existing,
      creditHold: held,
      creditHoldSetBy: actor,
      creditHoldSetAt: at,
      updatedAt: at,

      lockVersion: existing.lockVersion + 1,
    };
    this.#byId.set(id, next);
    return toCustomer(next);
  }

  async search(params: CustomerSearchParams): Promise<CustomerSearchPage> {
    if (params.ids !== undefined) {
      const wanted = new Set(params.ids);
      const found = [...this.#byId.values()].filter((r) => wanted.has(r.id));
      found.sort((a, b) =>
        a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name),
      );
      return { items: found.map(toCustomer), total: found.length };
    }

    const needle = params.q?.toLowerCase();
    const all = [...this.#byId.values()].filter(
      (r) =>
        (params.accountRepUsername === undefined ||
          r.accountRepUsername === params.accountRepUsername) &&
        (params.creditHold === undefined || r.creditHold === params.creditHold),
    );
    const matched =
      needle === undefined || needle === ''
        ? all
        : all.filter((r) =>
            [r.name, r.legacyAccountNumber, r.legacyUmbrellaAccountNumber].some(
              (field) => field !== null && field.toLowerCase().includes(needle),
            ),
          );

    matched.sort((a, b) =>
      a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name),
    );
    const page = matched.slice(params.offset, params.offset + params.limit);
    return { items: page.map(toCustomer), total: matched.length };
  }

  async listNames(limit: number): Promise<CustomerNamePage> {
    const all = [...this.#byId.values()].sort((a, b) =>
      a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name),
    );
    return {
      items: all.slice(0, limit).map((row) => ({
        id: row.id,
        name: row.name,
        ...(row.legacyAccountNumber === null
          ? {}
          : { legacyAccountNumber: row.legacyAccountNumber }),
      })),

      total: all.length,
    };
  }

  // Stands in for the unique index customers_legacy_account_number_unique.
  #assertLegacyAccountNumberUnique(value: string, exceptId: string | null): void {
    for (const [id, row] of this.#byId) {
      if (id !== exceptId && row.legacyAccountNumber === value) {
        throw new DuplicateLegacyAccountNumberError(value);
      }
    }
  }
}
