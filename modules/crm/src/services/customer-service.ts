// Customer records and the credit-hold flag.
// Role checks are on the routes in apps/api/src/crm/crm.controller.ts, not here.
import { newId } from '@erp/db';
import type {
  CreateCustomerRequest,
  Customer,
  CustomerNameListResponse,
  CustomerSearchQuery,
  CustomerSearchResponse,
  UpdateCustomerRequest,
} from '@erp/types';

import type { Clock, CustomerRepository, CustomerSearchPage, NewCustomer } from '../ports';

export interface CustomerServiceOptions {
  customers: CustomerRepository;
  clock: Clock;
}

export class CustomerService {
  readonly #customers: CustomerRepository;
  readonly #clock: Clock;

  constructor(options: CustomerServiceOptions) {
    this.#customers = options.customers;
    this.#clock = options.clock;
  }

  async create(request: CreateCustomerRequest): Promise<Customer> {
    const now = this.#clock.now();
    const input: NewCustomer & { id: string; createdAt: Date; updatedAt: Date } = {
      id: newId(),
      name: request.name,
      createdAt: now,
      updatedAt: now,

      paymentTerms: request.paymentTerms,
      taxExempt: request.taxExempt,
      reseller: request.reseller,

      ...(request.legacyAccountNumber === undefined
        ? {}
        : { legacyAccountNumber: request.legacyAccountNumber }),
      ...(request.legacyUmbrellaAccountNumber === undefined
        ? {}
        : { legacyUmbrellaAccountNumber: request.legacyUmbrellaAccountNumber }),
      ...(request.taxJurisdiction === undefined
        ? {}
        : { taxJurisdiction: request.taxJurisdiction }),
      ...(request.taxExemptionDocRef === undefined
        ? {}
        : { taxExemptionDocRef: request.taxExemptionDocRef }),

      ...(request.billingAddress === undefined ? {} : { billingAddress: request.billingAddress }),

      ...(request.shippingAddress === undefined
        ? {}
        : { shippingAddress: request.shippingAddress }),
      ...(request.freightMarginPct === undefined
        ? {}
        : { freightMarginPct: request.freightMarginPct }),

      ...(request.accountRepUsername === undefined
        ? {}
        : { accountRepUsername: request.accountRepUsername }),
    };
    return this.#customers.create(input);
  }

  async findById(id: string): Promise<Customer | null> {
    return this.#customers.findById(id);
  }

  async update(id: string, patch: UpdateCustomerRequest): Promise<Customer | null> {
    return this.#customers.update(id, patch, this.#clock.now(), patch.lockVersion);
  }

  async setCreditHold(
    id: string,
    held: boolean,
    actor: string,
    expectedLockVersion: number,
  ): Promise<Customer | null> {
    return this.#customers.setCreditHold(id, held, actor, this.#clock.now(), expectedLockVersion);
  }

  /**
   * False for a customer on credit hold, and for an unknown id, so the check fails closed.
   * Quoting calls it when a quote is created, which is where the block falls:
   * docs/product/requirements.md (R2). The single-use exception is kept by quoting, not here.
   */
  async mayQuote(id: string): Promise<boolean> {
    const customer = await this.#customers.findById(id);
    return customer !== null && !customer.creditHold;
  }

  async hasBillingAddress(id: string): Promise<boolean> {
    const customer = await this.#customers.findById(id);
    return customer !== null && customer.billingAddress !== undefined;
  }

  async billingState(id: string): Promise<string | undefined> {
    const customer = await this.#customers.findById(id);
    return customer?.billingAddress?.state;
  }

  async search(query: CustomerSearchQuery): Promise<CustomerSearchResponse> {
    const page: CustomerSearchPage = await this.#customers.search({
      ...(query.q === undefined || query.q === '' ? {} : { q: query.q }),

      ...(query.ids === undefined ? {} : { ids: query.ids }),

      ...(query.accountRepUsername === undefined
        ? {}
        : { accountRepUsername: query.accountRepUsername }),

      ...(query.creditHold === undefined ? {} : { creditHold: query.creditHold }),
      limit: query.limit,
      offset: query.offset,
    });
    return { items: [...page.items], total: page.total };
  }

  async listNames(limit: number): Promise<CustomerNameListResponse> {
    const page = await this.#customers.listNames(limit);
    return { items: [...page.items], total: page.total };
  }
}
