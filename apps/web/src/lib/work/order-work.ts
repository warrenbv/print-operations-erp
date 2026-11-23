// The work row for an order: its next act, whose desk it is with, and where the act is done.
// It asks the order's Next line twice, once with every gate held to learn the act, once with the reader's desk roles to learn whether it is theirs.
// Production or the Production Manager confirms: docs/product/requirements.md (R11).
import type { ErpRole, Order } from '@erp/types';

import { orderNextStep, type NextStepLine } from '../order-next-step';
import {
  ALL_GATES,
  absolute,
  deskRoles,
  orderPage,
  settled,
  type Work,
  type WorkDesk,
} from './work';

export interface WorkRow {
  readonly next: string;
  readonly with: WorkDesk;
}

function productionRow(label: string): WorkRow | null {
  switch (label) {
    case 'Confirm the order':
      return { next: 'Confirm the order', with: 'The Production Manager' };
    default:
      return null;
  }
}

export function orderRow(line: NextStepLine): WorkRow {
  const label = line.action?.label;
  const row = label === undefined ? null : productionRow(label);
  // Throws on a Next line with no row, so a new act cannot reach the queues unnamed.
  if (row === null) {
    throw new Error(`no work row for the order Next line "${label ?? line.sentence}"`);
  }
  return row;
}

export interface OrderWorkInput {
  readonly order: Pick<Order, 'id' | 'status' | 'updatedAt'>;
  readonly roles: readonly ErpRole[];

  readonly now: Date;
}

export function orderWork(input: OrderWorkInput): Work {
  const { order, roles } = input;
  const page = orderPage(order.id);
  const ask = (gates: readonly ErpRole[]) => orderNextStep({ status: order.status, roles: gates });

  const full = ask(ALL_GATES);
  if (full === null) {
    return settled('done', order.updatedAt, page);
  }
  const row = orderRow(full);
  const own = ask(deskRoles(roles));
  if (own?.action !== undefined) {
    return {
      group: 'yours',
      next: row.next,
      with: 'You',
      desk: row.with,
      ageFrom: order.updatedAt,
      href: absolute(own.action.href, page),
    };
  }
  return {
    group: 'another-desk',
    next: row.next,
    with: row.with,
    desk: row.with,
    ageFrom: order.updatedAt,
    href: page,
  };
}
