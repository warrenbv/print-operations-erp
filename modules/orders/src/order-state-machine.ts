// Guards for the order lifecycle. The states and moves are ORDER_TRANSITIONS in
// packages/types/src/order.ts: converted, then confirmed, which is final.
// Confirmation is the company's commitment: docs/product/requirements.md (R10) and (R11).
import type { OrderStatus } from '@erp/types';
import { ORDER_TRANSITIONS } from '@erp/types';

export class InvalidOrderTransitionError extends Error {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly allowed: readonly OrderStatus[];

  constructor(from: OrderStatus, to: OrderStatus) {
    const allowed = ORDER_TRANSITIONS[from];
    super(
      allowed.length === 0
        ? `an order in "${from}" is final and cannot move to "${to}"`
        : `an order in "${from}" cannot move to "${to}" — allowed: ${allowed.join(', ')}`,
    );
    this.name = 'InvalidOrderTransitionError';
    this.from = from;
    this.to = to;
    this.allowed = allowed;
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return [...ORDER_TRANSITIONS[from]];
}

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}
