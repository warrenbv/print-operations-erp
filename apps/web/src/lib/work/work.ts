// The shared shape of a work row: what happens next on a record, whose move it is, and since when.
// Every quote and order says whose move it is: docs/product/requirements.md (R12).
// Rows are built in apps/web/src/lib/work/quote-work.ts and apps/web/src/lib/work/order-work.ts.
import type { ErpRole } from '@erp/types';

export type WorkGroup = 'yours' | 'another-desk' | 'customer' | 'converted' | 'done' | 'closed';

export type WorkWith =
  | 'You'
  | 'Sales'
  | 'Production'
  | 'The Production Manager'
  | 'The floor'
  | 'The Billing Manager'
  | 'An Admin'
  | 'Customer';

export type WorkDesk = Exclude<WorkWith, 'You' | 'Customer'>;

export interface Work {
  readonly group: WorkGroup;

  readonly next: string | null;

  readonly with: WorkWith | null;

  readonly desk: WorkDesk | null;

  readonly ageFrom: string;

  readonly href: string;
}

/**
 * Roles that pass every act's gate, for asking what a record's next act is whoever holds it.
 * This holds because Admin is on the role list of every act the Next lines check, in packages/types/src/roles.ts.
 * An act whose list leaves Admin out would never be found by this question.
 */
export const ALL_GATES: readonly ErpRole[] = ['Admin'];

/**
 * The roles that count as the reader's desk. Admin is set aside when the reader also holds a desk role,
 * so an Admin who works in Sales sees Sales' acts as theirs rather than every act.
 */
export function deskRoles(roles: readonly ErpRole[]): readonly ErpRole[] {
  const desks = roles.filter((role) => role !== 'Admin');
  return desks.length === 0 ? roles : desks;
}

export function absolute(href: string, page: string): string {
  return href.startsWith('#') ? `${page}${href}` : href;
}

export function quotePage(quoteId: string): string {
  return `/quoting/quotes/${encodeURIComponent(quoteId)}`;
}

export function orderPage(orderId: string): string {
  return `/orders/${encodeURIComponent(orderId)}`;
}

export type OrderFold = 'documents';

export function orderFoldPage(orderId: string, fold: OrderFold): string {
  return `${orderPage(orderId)}?field=${fold}#${fold}`;
}

export function settled(group: 'done' | 'closed', ageFrom: string, href: string): Work {
  return { group, next: null, with: null, desk: null, ageFrom, href };
}
