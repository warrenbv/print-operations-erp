// The desks on Your work and the queues each one lists, by the role that holds the desk.
// Every desk sees its queue: docs/product/ux-direction.md. The desk cards are rendered under apps/web/src/app/home/.
import type { ErpRole } from '@erp/types';

type DeskId = 'sales' | 'production-manager' | 'floor' | 'billing';

interface DeskQueue {
  readonly id: string;
  readonly title: string;
}

export interface Desk {
  readonly id: DeskId;

  readonly title: string;
  readonly role: ErpRole;

  readonly queues: readonly DeskQueue[];
}

export function queueId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function desk(id: DeskId, title: string, role: ErpRole, queues: readonly string[]): Desk {
  return { id, title, role, queues: queues.map((queue) => ({ id: queueId(queue), title: queue })) };
}

export const DESKS: readonly Desk[] = [
  desk('sales', 'Sales', 'Sales', [
    'Waiting on you',
    'Waiting on another desk',
    'Quoted, with the customer',
    "Your customers' confirmed orders",
    'Customers on credit hold',
  ]),
  desk('production-manager', 'Production Manager', 'ProductionManager', [
    'Orders to confirm',
    'Quotes needing a lead time',
  ]),

  desk('floor', 'The floor', 'Production', ['Quotes needing a lead time']),
  desk('billing', 'Billing Manager', 'Billing', ['Price approvals', 'Exceptions']),
];

// A reader who holds only Admin sees every desk. Anyone else sees the desks of the roles they hold.
export function desksFor(roles: readonly ErpRole[]): readonly Desk[] {
  if (roles.length > 0 && roles.every((role) => role === 'Admin')) return DESKS;
  return DESKS.filter((d) => roles.includes(d.role));
}
