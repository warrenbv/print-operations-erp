// The Next line for an order: the act it waits on and, for a reader who may take it, the link to it.
// Production or the Production Manager confirms a converted order: docs/product/requirements.md (R11).
// The work rows and the Act now panel derive from it: apps/web/src/lib/work/order-work.ts, apps/web/src/lib/record/lifecycle.ts.
import { ORDER_CONFIRM_ROLES, type ErpRole, type OrderStatus } from '@erp/types';

export interface NextStepLine {
  readonly sentence: string;
  readonly action?: { readonly href: string; readonly label: string };
}

export interface OrderNextStepInput {
  readonly status: OrderStatus;
  readonly roles: readonly ErpRole[];
}

const PRODUCTION_MANAGER = 'the Production Manager';

function holds(roles: readonly ErpRole[], gate: readonly ErpRole[]): boolean {
  return gate.some((role) => roles.includes(role));
}

function step(
  mine: boolean,
  own: string,
  desk: string,
  theirs: string,
  action: { href: string; label: string },
): NextStepLine {
  return mine ? { sentence: own, action } : { sentence: `${desk} ${theirs}` };
}

export function orderNextStep(input: OrderNextStepInput): NextStepLine | null {
  const { status, roles } = input;
  const floor = holds(roles, ORDER_CONFIRM_ROLES);

  switch (status) {
    case 'converted':
      return step(floor, 'confirm the order.', PRODUCTION_MANAGER, 'confirms the order.', {
        href: '#confirmation',
        label: 'Confirm the order',
      });
    // A confirmed order has no next act in this application.
    default:
      return null;
  }
}
