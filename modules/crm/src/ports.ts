// The ports the CRM services depend on, with the row shapes and errors their adapters share.
// Each port has an in-memory and a Drizzle adapter held to one suite in modules/crm/test/contracts/.
import type {
  BillingAddress,
  Contact,
  ContactRole,
  Customer,
  CustomerDefaults,
  CustomerName,
  CustomerPart,
  PaymentTerms,
  PricingBasis,
  ShippingAddress,
  ShippingMode,
} from '@erp/types';

export interface Clock {
  now(): Date;
}

export interface NewCustomer {
  name: string;
  legacyAccountNumber?: string;
  legacyUmbrellaAccountNumber?: string;

  paymentTerms: PaymentTerms;
  taxJurisdiction?: string;
  taxExempt: boolean;
  taxExemptionDocRef?: string;
  reseller: boolean;

  billingAddress?: BillingAddress;

  shippingAddress?: ShippingAddress;

  freightMarginPct?: string;

  accountRepUsername?: string;
}

export interface CustomerPatch {
  name?: string;
  legacyAccountNumber?: string | null;
  legacyUmbrellaAccountNumber?: string | null;

  paymentTerms?: PaymentTerms;
  taxJurisdiction?: string | null;
  taxExempt?: boolean;
  taxExemptionDocRef?: string | null;
  reseller?: boolean;

  billingAddress?: BillingAddress | null;

  shippingAddress?: ShippingAddress | null;
  freightMarginPct?: string | null;

  accountRepUsername?: string | null;
}

export interface CustomerSearchParams {
  q?: string;

  ids?: readonly string[];

  accountRepUsername?: string;

  creditHold?: boolean;
  limit: number;
  offset: number;
}

export interface CustomerSearchPage {
  items: readonly Customer[];

  total: number;
}

export class DuplicateLegacyAccountNumberError extends Error {
  readonly value: string;
  constructor(value: string) {
    super(`legacyAccountNumber "${value}" is already in use`);
    this.name = 'DuplicateLegacyAccountNumberError';
    this.value = value;
  }
}

/**
 * Every write takes the `lockVersion` the caller read and moves it on. A mismatch throws
 * `StaleAggregateError` and writes nothing. An unknown id answers null instead:
 * docs/decisions/006-optimistic-concurrency.md.
 * A patch that changes nothing returns the current row and leaves `lockVersion` alone.
 */
export interface CustomerRepository {
  create(input: NewCustomer & { id: string; createdAt: Date; updatedAt: Date }): Promise<Customer>;
  findById(id: string): Promise<Customer | null>;

  update(
    id: string,
    patch: CustomerPatch,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<Customer | null>;

  /**
   * Sets or clears the hold and records who did it and when. The route that reaches it is gated
   * to Billing and Admin in apps/api/src/crm/crm.controller.ts: docs/product/requirements.md (R2).
   */
  setCreditHold(
    id: string,
    held: boolean,
    actor: string,
    at: Date,
    expectedLockVersion: number,
  ): Promise<Customer | null>;

  search(params: CustomerSearchParams): Promise<CustomerSearchPage>;

  listNames(limit: number): Promise<CustomerNamePage>;
}

export interface CustomerNamePage {
  items: readonly CustomerName[];

  total: number;
}

export interface NewContact {
  customerId: string;

  name: string | null;
  email?: string;
  phone?: string;
}

export interface ContactPatch {
  name?: string | null;
  email?: string | null;
  phone?: string | null;

  /** The whole role set after the write, not a change list. A role already held keeps its `setBy` and `setAt`. */
  roles?: readonly ContactRoleRow[];
}

export interface ContactRoleRow {
  role: ContactRole;
  setBy: string;
  setAt: Date;
}

export type NewContactRow = NewContact & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  roles?: readonly ContactRoleRow[];
};

export interface ContactRepository {
  create(input: NewContactRow): Promise<Contact>;
  findById(id: string): Promise<Contact | null>;

  listByCustomer(customerId: string): Promise<readonly Contact[]>;

  update(
    id: string,
    patch: ContactPatch,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<Contact | null>;

  delete(id: string, expectedLockVersion: number): Promise<boolean>;
}

export class ContactCustomerNotFoundError extends Error {
  readonly customerId: string;
  constructor(customerId: string) {
    super(`contact references customer "${customerId}" which does not exist`);
    this.name = 'ContactCustomerNotFoundError';
    this.customerId = customerId;
  }
}

export interface CustomerDefaultsWrite {
  customerId: string;
  pricingBasis?: PricingBasis;

  tierCode?: string;
  freightMode?: ShippingMode;
  leadTimeDays?: number;
  parts: readonly CustomerPart[];
  updatedBy: string;
  updatedAt: Date;
}

/**
 * A customer with no saved defaults is at `lockVersion` 0, and `replace` at 0 creates them.
 * `replace` swaps the whole part list. A part whose grade and width are kept keeps its agreed price.
 * `setAgreedPrice` answers 'no-part' when the customer has no part at that grade and width.
 */
export interface CustomerDefaultsRepository {
  findByCustomer(customerId: string): Promise<CustomerDefaults | null>;

  replace(input: CustomerDefaultsWrite, expectedLockVersion: number): Promise<CustomerDefaults>;

  setAgreedPrice(
    input: AgreedPriceWrite,
    expectedLockVersion: number,
  ): Promise<CustomerDefaults | 'no-part'>;
}

export interface AgreedPriceWrite {
  customerId: string;
  gradeId: string;
  rollWidthIn: number;
  agreed: { basis: PricingBasis; price: string; setBy: string; setAt: Date } | null;
}

export class CustomerDefaultsCustomerNotFoundError extends Error {
  readonly customerId: string;
  constructor(customerId: string) {
    super(`customer defaults reference customer "${customerId}" which does not exist`);
    this.name = 'CustomerDefaultsCustomerNotFoundError';
    this.customerId = customerId;
  }
}
