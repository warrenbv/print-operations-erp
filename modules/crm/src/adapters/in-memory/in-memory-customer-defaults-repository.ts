// In-memory `CustomerDefaultsRepository` for unit tests and the memory-mode API.
// modules/crm/test/contracts/customer-defaults-repository.contract.ts holds it to the Drizzle adapter's behaviour.
// Values are cloned in and out, so a caller cannot change stored state by mutating a result.
import { StaleAggregateError } from '@erp/db';
import {
  partFor,
  toDecimal,
  toMeasure,
  toMoney,
  type CustomerDefaults,
  type StoredCustomerPart,
} from '@erp/types';

import type {
  AgreedPriceWrite,
  CustomerDefaultsRepository,
  CustomerDefaultsWrite,
} from '../../ports';

export class InMemoryCustomerDefaultsRepository implements CustomerDefaultsRepository {
  readonly #byCustomer = new Map<string, CustomerDefaults>();

  findByCustomer(customerId: string): Promise<CustomerDefaults | null> {
    const stored = this.#byCustomer.get(customerId);
    return Promise.resolve(stored === undefined ? null : structuredClone(stored));
  }

  replace(input: CustomerDefaultsWrite, expectedLockVersion: number): Promise<CustomerDefaults> {
    const current = this.#byCustomer.get(input.customerId);
    // No saved defaults counts as version 0, so the first save must send 0.
    const actual = current?.lockVersion ?? 0;
    if (actual !== expectedLockVersion) {
      return Promise.reject(
        new StaleAggregateError('customer-defaults', input.customerId, expectedLockVersion, actual),
      );
    }
    const before = current?.parts ?? [];
    const next: CustomerDefaults = {
      customerId: input.customerId,
      ...(input.pricingBasis === undefined ? {} : { pricingBasis: input.pricingBasis }),
      ...(input.tierCode === undefined ? {} : { tierCode: input.tierCode }),
      ...(input.freightMode === undefined ? {} : { freightMode: input.freightMode }),
      ...(input.leadTimeDays === undefined ? {} : { leadTimeDays: input.leadTimeDays }),
      parts: input.parts.map((part) => {
        const agreed = partFor(before, part.gradeId, part.rollWidthIn)?.agreedPrice;
        return {
          gradeId: part.gradeId,
          rollWidthIn: part.rollWidthIn,
          ...(part.partNumber === undefined ? {} : { partNumber: part.partNumber }),
          ...(part.description === undefined ? {} : { description: part.description }),

          ...(part.feetPerRoll === undefined
            ? {}
            : { feetPerRoll: toMeasure(toDecimal(part.feetPerRoll)) }),
          ...(agreed === undefined ? {} : { agreedPrice: agreed }),
        };
      }),
      lockVersion: actual + 1,
      updatedBy: input.updatedBy,
      updatedAt: input.updatedAt.toISOString(),
    };
    this.#byCustomer.set(input.customerId, next);
    return Promise.resolve(structuredClone(next));
  }

  setAgreedPrice(
    input: AgreedPriceWrite,
    expectedLockVersion: number,
  ): Promise<CustomerDefaults | 'no-part'> {
    const current = this.#byCustomer.get(input.customerId);
    const part =
      current === undefined ? undefined : partFor(current.parts, input.gradeId, input.rollWidthIn);

    if (current === undefined || part === undefined) {
      return Promise.resolve('no-part');
    }
    if (current.lockVersion !== expectedLockVersion) {
      return Promise.reject(
        new StaleAggregateError(
          'customer-defaults',
          input.customerId,
          expectedLockVersion,
          current.lockVersion,
        ),
      );
    }
    const parts = current.parts.map((stored): StoredCustomerPart => {
      if (stored !== part) {
        return stored;
      }
      const rest: StoredCustomerPart = {
        gradeId: stored.gradeId,
        rollWidthIn: stored.rollWidthIn,
        ...(stored.partNumber === undefined ? {} : { partNumber: stored.partNumber }),
        ...(stored.description === undefined ? {} : { description: stored.description }),
        ...(stored.feetPerRoll === undefined ? {} : { feetPerRoll: stored.feetPerRoll }),
      };
      return input.agreed === null
        ? rest
        : {
            ...rest,
            agreedPrice: {
              basis: input.agreed.basis,

              price: toMoney(toDecimal(input.agreed.price)),
              setBy: input.agreed.setBy,
              setAt: input.agreed.setAt.toISOString(),
            },
          };
    });

    const next: CustomerDefaults = { ...current, parts, lockVersion: current.lockVersion + 1 };
    this.#byCustomer.set(input.customerId, next);
    return Promise.resolve(structuredClone(next));
  }
}
