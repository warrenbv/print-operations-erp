// The queue an Act now panel links to when the act belongs to another desk.
import type { Work, WorkDesk } from '../work/work';

export interface QueueLink {
  readonly href: string;
  readonly label: string;
}

const SALES_QUOTES: QueueLink = { href: '/quoting/quotes', label: "Sales' quotes" };

// Keyed by the exact `next` wording in apps/web/src/lib/work/quote-work.ts and apps/web/src/lib/work/order-work.ts.
// An act worded with a figure, such as approving a hand-set price, falls through to its desk in BY_DESK.
const BY_ACT: Readonly<Record<string, QueueLink>> = {
  'Add the first line': SALES_QUOTES,
  'Request price approval': SALES_QUOTES,

  'Request approval': SALES_QUOTES,
  'Decide the line below the floor': { href: '/approvals#price-approvals', label: 'Approvals' },
  'Send the quote': SALES_QUOTES,
  'Enter the lead time': { href: '/production/lead-times', label: "Production's quote queue" },
  'Confirm the order': { href: '/orders', label: "Production Manager's queue" },
};

const BY_DESK: Partial<Readonly<Record<WorkDesk, QueueLink>>> = {
  'The Billing Manager': {
    href: '/approvals#price-approvals',
    label: "The Billing Manager's approvals",
  },
};

export function queueFor(work: Work): QueueLink | undefined {
  if (work.next === null || work.desk === null) return undefined;
  return BY_ACT[work.next] ?? BY_DESK[work.desk];
}
