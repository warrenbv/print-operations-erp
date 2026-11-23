// Order status and document labels, and an order's name: its job number once confirmed, else the quote it came from.
import { type Order, type OrderStatus, shortId, type StoredDocumentSummary } from '@erp/types';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  converted: 'Converted',
  confirmed: 'Confirmed',
};

export const DOCUMENT_KIND_LABELS: Record<StoredDocumentSummary['kind'], string> = {
  quote: 'Quote',
  order_confirmation: 'Order confirmation',
  purchase_order: 'Customer PO',
};

export function orderName(
  order: { readonly id: string; readonly jobNumber?: string | undefined },
  quoteRef: string | null | undefined,
): string {
  if (order.jobNumber !== undefined) return `Order ${order.jobNumber}`;
  if (quoteRef !== null && quoteRef !== undefined) return `Order from ${quoteRef}`;
  return `Order ${shortId(order.id)}`;
}

export function byDeliveryDate(
  a: Pick<Order, 'requestedDate' | 'createdAt'>,
  b: Pick<Order, 'requestedDate' | 'createdAt'>,
): number {
  if (a.requestedDate !== b.requestedDate) {
    if (a.requestedDate === undefined) return 1;
    if (b.requestedDate === undefined) return -1;
    return a.requestedDate.localeCompare(b.requestedDate);
  }
  return b.createdAt.localeCompare(a.createdAt);
}
