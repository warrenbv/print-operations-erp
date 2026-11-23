// The day an order is due: the confirmation day plus the committed lead time in calendar days, weekends
// included: docs/product/requirements.md (R11) and docs/product/decisions.md.
import { addCalendarDays, businessDayOf, type Order } from '@erp/types';

export function dueDay(
  order: Pick<Order, 'confirmedAt' | 'confirmedLeadTimeDays'>,
): string | undefined {
  return order.confirmedAt === undefined || order.confirmedLeadTimeDays === undefined
    ? undefined
    : addCalendarDays(businessDayOf(order.confirmedAt), order.confirmedLeadTimeDays);
}
