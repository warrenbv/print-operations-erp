// Which order acts the reader's roles allow. It reads the same role lists the API checks,
// in packages/types/src/roles.ts, so the page offers only acts the API accepts.
import {
  ORDER_CONFIRMATION_SEND_ROLES,
  ORDER_CONFIRM_ROLES,
  type ErpRole,
  type OrderLine,
  type OrderStatus,
} from '@erp/types';

export function mayConfirm(roles: readonly ErpRole[]): boolean {
  return ORDER_CONFIRM_ROLES.some((role) => roles.includes(role));
}

export function maySendConfirmation(roles: readonly ErpRole[]): boolean {
  return ORDER_CONFIRMATION_SEND_ROLES.some((role) => roles.includes(role));
}

export function confirmationIssuable(status: OrderStatus): boolean {
  return status === 'confirmed';
}

export function perPoundCount(lines: readonly OrderLine[]): number {
  return lines.filter((line) => line.pricingBasis === 'per_pound').length;
}
