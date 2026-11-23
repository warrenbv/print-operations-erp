// The role catalogue and, for each act, the roles allowed to perform it.
// The API guards with these lists through `RequireRoles` in apps/api/src/auth/authz.decorators.ts, and the web pages read
// the same lists to decide what to offer. What each desk may do: docs/product/roles.md.
// Reading is open to every role. packages/types/test/roles.test.ts classifies every list here and holds that line.
import { z } from 'zod';

// `Billing` is the Billing Manager's role. No CHECK constraint mirrors this list, because identity stores roles as a text array.
export const ERP_ROLES = ['Sales', 'Billing', 'Production', 'ProductionManager', 'Admin'] as const;

export const erpRoleSchema = z.enum(ERP_ROLES);

export type ErpRole = (typeof ERP_ROLES)[number];

export function isErpRole(value: string): value is ErpRole {
  return (ERP_ROLES as readonly string[]).includes(value);
}

// Editing customers, contacts and quotes.
export const SALES_WRITE_ROLES = ['Sales', 'Admin'] as const;

// The one narrowed read: the Admin section is for Admin alone.
export const ADMIN_SECTION_READ_ROLES = ['Admin'] as const;

// The roles the system alerts when production needs to know something: docs/product/roles.md.
export const NOTIFYING_ROLES = ['ProductionManager'] as const;

export function isNotifyingRole(role: ErpRole): boolean {
  return (NOTIFYING_ROLES as readonly ErpRole[]).includes(role);
}

// Deciding a hand-set price: docs/product/requirements.md (R7). Admin is the fallback described in docs/product/roles.md.
export const PRICE_OVERRIDE_APPROVAL_ROLES = ['Billing', 'Admin'] as const;

// Grades, pricing tiers and the pricing constants, the margin floor among them: docs/product/roles.md.
export const PRICING_CONFIG_WRITE_ROLES = ['Billing', 'Admin'] as const;

// Confirming an order: docs/product/requirements.md (R11).
export const ORDER_CONFIRM_ROLES = ['Production', 'ProductionManager', 'Admin'] as const;

// Issuing an order's confirmation document to the customer. Every role may.
export const ORDER_CONFIRMATION_SEND_ROLES = [
  'Sales',
  'Production',
  'ProductionManager',
  'Billing',
  'Admin',
] as const;

// Entering a quote's lead time. Sales is left out on purpose: docs/product/requirements.md (R5).
export const QUOTE_LEAD_TIME_ROLES = ['ProductionManager', 'Production', 'Admin'] as const;

// Importing and editing tax rates.
export const TAX_RATE_WRITE_ROLES = ['Billing', 'Admin'] as const;

// Setting and clearing a customer's credit hold, and deciding a credit-hold exception:
// docs/product/requirements.md (R2).
export const CREDIT_HOLD_ROLES = ['Billing', 'Admin'] as const;

// Overriding the margin floor on one quote, which Admin alone may do: docs/product/requirements.md (R6).
export const FLOOR_OVERRIDE_ROLES = ['Admin'] as const;

// A customer's quoting defaults and parts.
export const CUSTOMER_DEFAULTS_WRITE_ROLES = ['Sales', 'Billing', 'Admin'] as const;
