// The orders module's public surface. Only apps/api imports it: modules/orders/README.md.
export {
  OrderService,
  type OrderServiceOptions,
  type TransitionContext,
} from './services/order-service';

export { InvalidOrderTransitionError } from './order-state-machine';

export { orderTotals } from './order-totals';

export { formatJobNumber, JOB_NUMBER_PREFIX } from './job-number';

export {
  EmptyQuoteError,
  PerPoundLineNeedsRollWeightError,
  MissingConfirmationDetailsError,
  NoConfirmationRecipientError,
  NoProductionManagerError,
  OrderedWeightOnPerRollQuoteLineError,
  OrderNotConfirmedError,
  PerPoundLineNeedsPoundsError,
  QuoteFailsSendChecksError,
  StaleAggregateError,
  UnknownQuoteError,
  UnknownQuoteLineError,
  type Clock,
  type ConfirmationIssued,
  type CustomerRecipients,
  type OrderConfirmationNotifier,
  type ProductionManagerAudience,
  type ProductionManagerRecipients,
  type OrderReceivedNotified,
  type OrderReceivedNotifier,
  type NewOrder,
  type NewOrderLine,
  type OrderListParams,
  type OrderPatch,
  type OrderRepository,
  type QuoteLookup,
} from './ports';

export { systemClock } from './adapters/system-clock';
export { InMemoryOrderRepository } from './adapters/in-memory/in-memory-order-repository';

export { createOrdersDb, type OrdersDb } from './data/orders-db';
export { DrizzleOrderRepository } from './adapters/drizzle/drizzle-order-repository';
