// Per-customer defaults for new quote lines, and the customer's parts with optional agreed prices.
// Setting an agreed price is gated to Billing and Admin in apps/api/src/crm/crm-agreed-price.controller.ts.
import {
  emptyCustomerDefaults,
  partFor,
  type AgreedPriceTerms,
  type CustomerDefaults,
  type PutCustomerDefaultsRequest,
  type SetAgreedPriceRequest,
} from '@erp/types';

import type { Clock, CustomerDefaultsRepository, CustomerRepository } from '../ports';

export type AgreedPriceWriteResult =
  | { ok: true; defaults: CustomerDefaults }
  | { ok: false; reason: 'customer-not-found' | 'part-not-found' };

export type CustomerDefaultsWriteResult =
  { ok: true; defaults: CustomerDefaults } | { ok: false; reason: 'customer-not-found' };

export interface CustomerDefaultsServiceOptions {
  defaults: CustomerDefaultsRepository;
  customers: CustomerRepository;
  clock: Clock;
}

export class CustomerDefaultsService {
  readonly #defaults: CustomerDefaultsRepository;
  readonly #customers: CustomerRepository;
  readonly #clock: Clock;

  constructor(options: CustomerDefaultsServiceOptions) {
    this.#defaults = options.defaults;
    this.#customers = options.customers;
    this.#clock = options.clock;
  }

  /** A customer with nothing saved reads as empty defaults at `lockVersion` 0, the version a first save sends. */
  async find(customerId: string): Promise<CustomerDefaults | null> {
    const customer = await this.#customers.findById(customerId);
    if (customer === null) {
      return null;
    }
    return (await this.#defaults.findByCustomer(customerId)) ?? emptyCustomerDefaults(customerId);
  }

  async replace(
    customerId: string,
    request: PutCustomerDefaultsRequest,
    actor: string,
  ): Promise<CustomerDefaultsWriteResult> {
    const customer = await this.#customers.findById(customerId);
    if (customer === null) {
      return { ok: false, reason: 'customer-not-found' };
    }
    const defaults = await this.#defaults.replace(
      {
        customerId,
        ...(request.pricingBasis === undefined ? {} : { pricingBasis: request.pricingBasis }),
        ...(request.tierCode === undefined ? {} : { tierCode: request.tierCode }),
        ...(request.freightMode === undefined ? {} : { freightMode: request.freightMode }),
        ...(request.leadTimeDays === undefined ? {} : { leadTimeDays: request.leadTimeDays }),
        parts: request.parts,
        updatedBy: actor,
        updatedAt: this.#clock.now(),
      },
      request.lockVersion,
    );
    return { ok: true, defaults };
  }

  async setAgreedPrice(
    customerId: string,
    request: SetAgreedPriceRequest,
    actor: string,
  ): Promise<AgreedPriceWriteResult> {
    const customer = await this.#customers.findById(customerId);
    if (customer === null) {
      return { ok: false, reason: 'customer-not-found' };
    }
    const result = await this.#defaults.setAgreedPrice(
      {
        customerId,
        gradeId: request.gradeId,
        rollWidthIn: request.rollWidthIn,
        agreed:
          request.agreedPrice === null
            ? null
            : { ...request.agreedPrice, setBy: actor, setAt: this.#clock.now() },
      },
      request.lockVersion,
    );
    return result === 'no-part'
      ? { ok: false, reason: 'part-not-found' }
      : { ok: true, defaults: result };
  }

  /**
   * Read by quoting for a line with a hand-set price. A price that matches this one is recorded as
   * agreed rather than manual: modules/quoting/src/services/quote-service.ts.
   */
  async agreedPrice(
    customerId: string,
    gradeId: string,
    rollWidthIn: number,
  ): Promise<AgreedPriceTerms | undefined> {
    const defaults = await this.#defaults.findByCustomer(customerId);
    const agreed =
      defaults === null ? undefined : partFor(defaults.parts, gradeId, rollWidthIn)?.agreedPrice;
    return agreed === undefined ? undefined : { basis: agreed.basis, price: agreed.price };
  }
}
