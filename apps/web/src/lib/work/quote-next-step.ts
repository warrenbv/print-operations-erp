// The Next line for a draft or sent quote: the act it waits on and, for a reader who may take it, the link to it.
// The checks run in the order of the send conditions in docs/product/requirements.md (R8): lines, floor, price approval, lead time.
// The work rows and the Act now panel derive from it: apps/web/src/lib/work/quote-work.ts.
import {
  FLOOR_OVERRIDE_ROLES,
  PRICE_OVERRIDE_APPROVAL_ROLES,
  QUOTE_LEAD_TIME_ROLES,
  SALES_WRITE_ROLES,
  type ErpRole,
  type QuoteStatus,
} from '@erp/types';

import type { SendAction } from '../../app/quoting/quotes/[id]/action-rail';
import type { NextStepLine } from '../order-next-step';

export interface QuoteNextStepInput {
  readonly quoteId: string;
  readonly status: QuoteStatus;
  readonly lineCount: number;
  readonly leadTimeDays: number | undefined;
  readonly send: SendAction;

  readonly orderIds: readonly string[];
  readonly roles: readonly ErpRole[];
}

function holds(roles: readonly ErpRole[], gate: readonly ErpRole[]): boolean {
  return gate.some((role) => roles.includes(role));
}

export function quoteNextStep(input: QuoteNextStepInput): NextStepLine | null {
  const { quoteId, status, lineCount, leadTimeDays, send, orderIds, roles } = input;
  const sales = holds(roles, SALES_WRITE_ROLES);

  // Any signed-in reader may convert, so this branch checks no role: docs/product/requirements.md (R10).
  if (status === 'quoted') {
    const convert = `/quoting/quotes/${encodeURIComponent(quoteId)}/convert`;

    if (orderIds.length > 0) {
      return {
        sentence: 'create another order when the customer sends the next PO.',
        action: { href: convert, label: 'Create another order' },
      };
    }

    return {
      sentence: 'convert it to an order when the customer accepts.',
      action: {
        href: convert,

        label: 'Convert this quote',
      },
    };
  }

  if (status !== 'draft' && status !== 'override_requested') {
    return null;
  }

  if (lineCount === 0) {
    return sales
      ? {
          sentence: 'add the lines and price them.',
          action: { href: '#lines', label: 'Add a line' },
        }
      : { sentence: 'Sales adds the lines and prices them.' };
  }
  // A line below the floor blocks the send until an Admin overrides it: docs/product/requirements.md (R6).
  if (send.kind === 'needs-floor-override' || send.kind === 'override-floor') {
    if (status === 'draft') {
      return sales
        ? {
            sentence: 'request approval for the line below the floor.',
            action: { href: reviewHref(quoteId), label: 'Go to the request' },
          }
        : { sentence: 'Sales requests approval for the line below the floor.' };
    }
    return holds(roles, FLOOR_OVERRIDE_ROLES)
      ? {
          sentence: 'decide the line below the floor.',
          action: { href: '/approvals', label: 'Open Approvals' },
        }
      : { sentence: 'an Admin decides the line below the floor.' };
  }
  // A hand-set price waits on the Billing Manager's approval: docs/product/requirements.md (R7).
  if (send.kind === 'needs-approval') {
    return sales
      ? {
          sentence: 'request approval of the hand-set price.',
          action: { href: reviewHref(quoteId), label: 'Go to the request' },
        }
      : { sentence: 'Sales requests approval of the hand-set price.' };
  }
  if (send.kind === 'awaiting-approval') {
    return holds(roles, PRICE_OVERRIDE_APPROVAL_ROLES)
      ? {
          sentence: 'decide the hand-set price.',
          action: { href: '/approvals', label: 'Open Approvals' },
        }
      : { sentence: 'the Billing Manager decides the hand-set price.' };
  }
  // Production supplies the lead time before the quote can be sent: docs/product/requirements.md (R5).
  if (leadTimeDays === undefined) {
    return holds(roles, QUOTE_LEAD_TIME_ROLES)
      ? {
          sentence: 'enter the lead time.',
          action: { href: '#lead-time', label: 'Go to the lead time' },
        }
      : { sentence: 'Production enters the lead time.' };
  }
  return sales
    ? {
        sentence: 'send the quote.',
        action: { href: reviewHref(quoteId), label: 'Go to Send quote' },
      }
    : { sentence: 'Sales sends the quote.' };
}

function reviewHref(quoteId: string): string {
  return `/quoting/quotes/${encodeURIComponent(quoteId)}/review`;
}
