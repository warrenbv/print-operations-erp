// Role checks the pages use to decide which acts to offer. Who may do what: docs/product/roles.md.
// The API enforces the same lists from packages/types/src/roles.ts on every route, so these only shape the page.
import {
  CREDIT_HOLD_ROLES,
  CUSTOMER_DEFAULTS_WRITE_ROLES,
  FLOOR_OVERRIDE_ROLES,
  PRICE_OVERRIDE_APPROVAL_ROLES,
  QUOTE_LEAD_TIME_ROLES,
  SALES_WRITE_ROLES,
  type ErpRole,
} from '@erp/types';

export function maySalesWrite(roles: readonly ErpRole[]): boolean {
  return SALES_WRITE_ROLES.some((role) => roles.includes(role));
}

// Production supplies a quote's lead time: docs/product/requirements.md (R5).
export function mayEnterQuoteLeadTime(roles: readonly ErpRole[]): boolean {
  return QUOTE_LEAD_TIME_ROLES.some((role) => roles.includes(role));
}

// Only the Billing Manager or an Admin sets or clears a hold: docs/product/requirements.md (R2).
export function maySetCreditHold(roles: readonly ErpRole[]): boolean {
  return CREDIT_HOLD_ROLES.some((role) => roles.includes(role));
}

// The desk that sets a hold also decides an exception to it, so the same list gates both: docs/product/roles.md.
export function mayDecideCreditException(roles: readonly ErpRole[]): boolean {
  return CREDIT_HOLD_ROLES.some((role) => roles.includes(role));
}

// The floor override is the Admin's alone: docs/product/requirements.md (R6).
export function mayOverrideFloor(roles: readonly ErpRole[]): boolean {
  return FLOOR_OVERRIDE_ROLES.some((role) => roles.includes(role));
}

export function mayWriteCustomerDefaults(roles: readonly ErpRole[]): boolean {
  return CUSTOMER_DEFAULTS_WRITE_ROLES.some((role) => roles.includes(role));
}

// Setting an agreed price uses the list of roles that approve a hand-set price.
export function maySetAgreedPrice(roles: readonly ErpRole[]): boolean {
  return PRICE_OVERRIDE_APPROVAL_ROLES.some((role) => roles.includes(role));
}
