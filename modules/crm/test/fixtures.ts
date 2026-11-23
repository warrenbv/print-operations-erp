// Builders for customer inputs shared by the crm tests.
import type { CreateCustomerRequest } from '@erp/types';
import { DEFAULT_PAYMENT_TERMS, createCustomerRequestSchema } from '@erp/types';

import type { NewCustomer } from '../src/ports';

type RepositoryCreateInput = NewCustomer & { id: string; createdAt: Date; updatedAt: Date };

export function newCustomerInput(
  overrides: Partial<NewCustomer> & { id: string; createdAt: Date; updatedAt: Date },
): RepositoryCreateInput {
  return {
    name: 'Test Customer',
    paymentTerms: DEFAULT_PAYMENT_TERMS,
    taxExempt: false,
    reseller: false,
    ...overrides,
  };
}

export function createCustomerRequest(
  overrides: Record<string, unknown> = {},
): CreateCustomerRequest {
  return createCustomerRequestSchema.parse({ name: 'Test Customer', ...overrides });
}
