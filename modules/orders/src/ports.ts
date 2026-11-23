// The ports the order service depends on, the shapes it asks other modules to fill, and its errors.
// OrderRepository adapters are in modules/orders/src/adapters/, held to one suite in
// modules/orders/test/contracts/order-repository.contract.ts.
import type {
  CapturePurchaseOrderRequest,
  CountAndOldest,
  Order,
  OrderLine,
  OrderStatus,
  OrderTransition,
  OrderWithLines,
  QueueSort,
  StoredDocument,
} from '@erp/types';

export { StaleAggregateError } from '@erp/db';

export interface Clock {
  now(): Date;
}

export type NewOrderLine = Omit<OrderLine, 'id' | 'orderId' | 'createdAt' | 'updatedAt'>;

/**
 * Orders asks quoting for lines in its own `NewOrderLine` shape, not for the quote aggregate.
 * The order keeps the goods and the committed money. How a price was derived stays in quoting,
 * reachable through `quoteLineId`: docs/decisions/002-what-crosses-a-module-boundary.md.
 * The field-by-field mapping is in apps/api/src/orders/orders.factory.ts. It answers null for a
 * quote that is not in a convertible status, and throws `QuoteFailsSendChecksError` for one that
 * is but no longer passes the checks a send makes.
 */
export interface QuoteLookup {
  findConvertible(quoteId: string): Promise<{
    id: string;
    customerId: string;

    salesRep?: string;
    lines: readonly NewOrderLine[];
  } | null>;
}

/**
 * A quote in a convertible status that fails a check a send makes: a line below the margin floor
 * with no override, a hand-set price with no live approval, or no lead time. The rules are
 * docs/product/requirements.md (R6), docs/product/requirements.md (R7) and
 * docs/product/requirements.md (R5).
 */
export class QuoteFailsSendChecksError extends Error {
  readonly quoteId: string;
  readonly check: 'below-floor' | 'override-not-approved' | 'no-lead-time';
  readonly lines: readonly number[];
  constructor(
    quoteId: string,
    check: 'below-floor' | 'override-not-approved' | 'no-lead-time',
    lines: readonly number[] = [],
  ) {
    super(
      `quote "${quoteId}" no longer passes the checks a sent quote must pass (${check}), ` +
        'so it cannot be converted',
    );
    this.name = 'QuoteFailsSendChecksError';
    this.quoteId = quoteId;
    this.check = check;
    this.lines = lines;
  }
}

export class EmptyQuoteError extends Error {
  readonly quoteId: string;
  constructor(quoteId: string) {
    super(`quote "${quoteId}" has no lines to convert`);
    this.name = 'EmptyQuoteError';
    this.quoteId = quoteId;
  }
}

export class PerPoundLineNeedsRollWeightError extends Error {
  readonly quoteId: string;
  readonly lineNumber: number;
  constructor(quoteId: string, lineNumber: number) {
    super(
      `line ${String(lineNumber)} is priced per pound but carries no estimated roll weight, ` +
        'so its price per roll cannot be reconstructed - re-save the quote line before converting',
    );
    this.name = 'PerPoundLineNeedsRollWeightError';
    this.quoteId = quoteId;
    this.lineNumber = lineNumber;
  }
}

export class UnknownQuoteError extends Error {
  readonly quoteId: string;
  constructor(quoteId: string) {
    super(`no convertible quote with id "${quoteId}"`);
    this.name = 'UnknownQuoteError';
    this.quoteId = quoteId;
  }
}

export class UnknownQuoteLineError extends Error {
  readonly quoteId: string;
  readonly quoteLineId: string;
  constructor(quoteId: string, quoteLineId: string) {
    super(`quote "${quoteId}" has no line "${quoteLineId}"`);
    this.name = 'UnknownQuoteLineError';
    this.quoteId = quoteId;
    this.quoteLineId = quoteLineId;
  }
}

export class OrderedWeightOnPerRollQuoteLineError extends Error {
  readonly quoteId: string;
  readonly quoteLineId: string;
  readonly lineNumber: number;
  constructor(quoteId: string, quoteLineId: string, lineNumber: number) {
    super(
      `line ${String(lineNumber)} of quote "${quoteId}" is sold by the roll and takes no pounds`,
    );
    this.name = 'OrderedWeightOnPerRollQuoteLineError';
    this.quoteId = quoteId;
    this.quoteLineId = quoteLineId;
    this.lineNumber = lineNumber;
  }
}

export class PerPoundLineNeedsPoundsError extends Error {
  readonly quoteId: string;
  readonly quoteLineId: string;
  readonly lineNumber: number;
  constructor(quoteId: string, quoteLineId: string, lineNumber: number) {
    super(
      `line ${String(lineNumber)} of quote "${quoteId}" is sold by the pound: ` +
        'the pounds ordered are required',
    );
    this.name = 'PerPoundLineNeedsPoundsError';
    this.quoteId = quoteId;
    this.quoteLineId = quoteLineId;
    this.lineNumber = lineNumber;
  }
}

export class MissingConfirmationDetailsError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`confirming an order requires: ${missing.join(', ')}`);
    this.name = 'MissingConfirmationDetailsError';
    this.missing = missing;
  }
}

/** Addresses of the customer's contacts tagged `order_confirmation`, wired in apps/api/src/orders/orders.factory.ts. */
export interface CustomerRecipients {
  emailsFor(customerId: string): Promise<readonly string[]>;
}

export interface ProductionManagerRecipients {
  audience(): Promise<ProductionManagerAudience>;
}

/** Holders of the ProductionManager role. Holders with no email address are listed apart so a failure can name them. */
export interface ProductionManagerAudience {
  emails: readonly string[];

  withoutEmail: readonly string[];
}

export interface OrderReceivedNotified {
  recipients: readonly string[];
  messageId: string;
  notifiedAt: Date;
}

export interface OrderReceivedNotifier {
  orderReceived(order: OrderWithLines, to: readonly string[]): Promise<OrderReceivedNotified>;
}

export interface ConfirmationIssued {
  recipients: readonly string[];

  messageId: string;
  issuedAt: Date;
}

/** `actor` is the user who sent the confirmation, which is not always the user who confirmed the order. */
export interface OrderConfirmationNotifier {
  confirmationIssued(
    order: Order,
    document: StoredDocument,
    to: readonly string[],
    actor: string,
  ): Promise<ConfirmationIssued>;
}

export class OrderNotConfirmedError extends Error {
  readonly orderId: string;
  readonly status: OrderStatus;
  constructor(orderId: string, status: OrderStatus) {
    super(`order "${orderId}" is ${status}; a confirmation may only be issued once confirmed`);
    this.name = 'OrderNotConfirmedError';
    this.orderId = orderId;
    this.status = status;
  }
}

export class NoProductionManagerError extends Error {
  readonly orderId: string;

  readonly reason: 'no-holders' | 'no-addresses';

  readonly holdersWithoutEmail: readonly string[];

  constructor(orderId: string, holdersWithoutEmail: readonly string[] = []) {
    const reason = holdersWithoutEmail.length === 0 ? 'no-holders' : 'no-addresses';
    super(
      reason === 'no-holders'
        ? `order "${orderId}" was converted but no user holds ProductionManager, ` +
            'so nobody was notified'
        : `order "${orderId}" was converted but no holder of ProductionManager has an ` +
            `email address, so nobody was notified (${holdersWithoutEmail.join(', ')})`,
    );
    this.name = 'NoProductionManagerError';
    this.orderId = orderId;
    this.reason = reason;
    this.holdersWithoutEmail = holdersWithoutEmail;
  }
}

export class NoConfirmationRecipientError extends Error {
  readonly orderId: string;
  readonly customerId: string;
  constructor(orderId: string, customerId: string) {
    super(
      `order "${orderId}" cannot be confirmed to customer "${customerId}": ` +
        'no contact is tagged for order confirmations',
    );
    this.name = 'NoConfirmationRecipientError';
    this.orderId = orderId;
    this.customerId = customerId;
  }
}

export interface NewOrder {
  quoteId: string;
  customerId: string;
  salesRep?: string;

  requestedDate?: string;
}

export interface NewOrderWrite extends NewOrder {
  id: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  lines: readonly (NewOrderLine & { id: string })[];

  opening: Omit<OrderTransition, 'orderId'>;

  purchaseOrder?: { poNumber: string; capturedBy: string };
}

export type PurchaseOrderCapture = Omit<CapturePurchaseOrderRequest, 'lockVersion'>;

export interface OrderPatch {
  jobNumber?: string;
  confirmedLeadTimeDays?: number;

  confirmedBy?: string;
  confirmedAt?: Date;
}

export interface OrderListParams {
  status?: readonly OrderStatus[];
  customerId?: string;

  quoteIds?: readonly string[];

  poNumber?: string;

  salesRep?: string;

  sort?: QueueSort;

  limit?: number;
}

export interface OrderRepository {
  /**
   * Writes every order with its lines, opening history row and PO in one transaction. All or none.
   * Conversion to one order and to several both write through it.
   */
  createMany(inputs: readonly NewOrderWrite[]): Promise<readonly OrderWithLines[]>;
  findById(id: string): Promise<Order | null>;

  findWithLines(id: string): Promise<OrderWithLines | null>;

  linesByOrderIds(orderIds: readonly string[]): Promise<readonly OrderLine[]>;

  existsForQuote(quoteId: string): Promise<boolean>;

  /** Takes the next value of a counter that never repeats. A confirmation that fails after minting leaves a gap. */
  mintJobNumber(): Promise<string>;

  list(params: OrderListParams): Promise<readonly Order[]>;

  countAndOldest(params: Omit<OrderListParams, 'sort' | 'limit'>): Promise<CountAndOldest<Order>>;

  /**
   * Writes the status, the patch and one history row together, and moves `lockVersion`.
   * It does not check that the move is legal. `OrderService` does that first.
   * A call without `expectedLockVersion` checks nothing. The confirm route always sends it:
   * docs/decisions/006-optimistic-concurrency.md.
   */
  transition(
    id: string,
    to: OrderStatus,
    patch: OrderPatch,
    entry: Omit<OrderTransition, 'orderId'>,
    updatedAt: Date,
    expectedLockVersion?: number,
  ): Promise<Order | null>;

  capturePurchaseOrder(
    id: string,
    po: PurchaseOrderCapture,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<OrderWithLines | null>;

  history(orderId: string): Promise<readonly OrderTransition[]>;
}
