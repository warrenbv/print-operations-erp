// Conversion of an accepted quote into orders, confirmation, the customer's PO, and the mail an
// order triggers. Rules: docs/product/requirements.md (R9), (R10) and (R11).
// Role checks are on the routes in apps/api/src/orders/orders.controller.ts, not here.
import { newId } from '@erp/db';
import type {
  CapturePurchaseOrderRequest,
  CreateOrderLine,
  CreateOrderRequest,
  CreateOrdersRequest,
  CountAndOldest,
  Order,
  OrderLine,
  OrderStatus,
  OrderTotals,
  OrderTransition,
  OrderWithLines,
  StoredDocument,
} from '@erp/types';
import {
  INITIAL_ORDER_STATUS,
  perPoundProductPrice,
  toDecimal,
  toMeasure,
  toMoney,
} from '@erp/types';

import { assertTransition } from '../order-state-machine';
import { orderTotals } from '../order-totals';
import {
  EmptyQuoteError,
  PerPoundLineNeedsRollWeightError,
  MissingConfirmationDetailsError,
  NoConfirmationRecipientError,
  NoProductionManagerError,
  OrderNotConfirmedError,
  OrderedWeightOnPerRollQuoteLineError,
  PerPoundLineNeedsPoundsError,
  StaleAggregateError,
  UnknownQuoteError,
  UnknownQuoteLineError,
  type Clock,
  type ConfirmationIssued,
  type CustomerRecipients,
  type OrderConfirmationNotifier,
  type OrderListParams,
  type ProductionManagerRecipients,
  type OrderReceivedNotified,
  type OrderReceivedNotifier,
  type OrderPatch,
  type OrderRepository,
  type NewOrderLine,
  type QuoteLookup,
} from '../ports';

export interface OrderServiceOptions {
  orders: OrderRepository;
  quotes: QuoteLookup;

  recipients?: CustomerRecipients;

  notifier?: OrderConfirmationNotifier;

  productionManagers?: ProductionManagerRecipients;

  orderNotifier?: OrderReceivedNotifier;
  clock: Clock;
}

function plannedPallets(
  line: Pick<OrderLine, 'quantityRolls' | 'pallets'>,
  rolls: number,
): number | null {
  if (line.pallets === null) return null;
  if (line.pallets <= 0 || line.quantityRolls <= 0) return line.pallets;
  const rollsPerPallet = Math.ceil(line.quantityRolls / line.pallets);
  return Math.ceil(rolls / rollsPerPallet);
}

function plannedWeight(
  line: Pick<OrderLine, 'quantityRolls' | 'estimatedWeightLb' | 'rollWeightLb'>,
  rolls: number,
): string {
  if (line.rollWeightLb !== undefined) {
    return toMeasure(toDecimal(line.rollWeightLb).times(rolls));
  }
  return toMeasure(toDecimal(line.estimatedWeightLb).times(rolls).div(line.quantityRolls));
}

// Create orders may take a different number of rolls, or pounds, than the quote line. The unit price
// and unit cost stay as quoted, only the extended figures are recomputed, and freight stays at the
// quoted amount.
function requantified(
  line: Pick<
    OrderLine,
    | 'quantityRolls'
    | 'pallets'
    | 'estimatedWeightLb'
    | 'rollWeightLb'
    | 'pricingBasis'
    | 'pricePerRoll'
    | 'productPricePerLb'
    | 'totalCostPerRoll'
    | 'freightResult'
  >,
  rolls: number,
  pounds: string | undefined,
): Pick<
  OrderLine,
  'pallets' | 'estimatedWeightLb' | 'extendedPrice' | 'extendedCost' | 'extendedMargin'
> {
  const rollsMoved = rolls !== line.quantityRolls;
  const quantity = toDecimal(String(rolls));

  const productExtended =
    line.pricingBasis === 'per_pound' &&
    line.productPricePerLb !== undefined &&
    pounds !== undefined
      ? perPoundProductPrice(line.productPricePerLb, pounds)
      : toDecimal(line.pricePerRoll).times(quantity);
  const extendedPrice = productExtended.plus(toDecimal(line.freightResult.invoiceTotal));
  const extendedCost = toDecimal(line.totalCostPerRoll)
    .times(quantity)
    .plus(toDecimal(line.freightResult.cost));
  return {
    pallets: rollsMoved ? plannedPallets(line, rolls) : line.pallets,
    estimatedWeightLb: rollsMoved ? plannedWeight(line, rolls) : line.estimatedWeightLb,
    extendedPrice: toMoney(extendedPrice),
    extendedCost: toMoney(extendedCost),

    extendedMargin: toMoney(extendedPrice.minus(extendedCost)),
  };
}

function chosenLines(
  quoteId: string,
  quoteLines: readonly NewOrderLine[],
  requested: readonly CreateOrderLine[],
): NewOrderLine[] {
  const byQuoteLine = new Map(
    quoteLines.flatMap((line) =>
      line.quoteLineId === undefined ? [] : [[line.quoteLineId, line] as const],
    ),
  );
  const wanted = new Map<string, CreateOrderLine>();
  for (const asked of requested) {
    const line = byQuoteLine.get(asked.quoteLineId);
    if (line === undefined) {
      throw new UnknownQuoteLineError(quoteId, asked.quoteLineId);
    }
    const perPound = line.pricingBasis === 'per_pound';
    if (!perPound && asked.orderedWeightLb !== undefined) {
      throw new OrderedWeightOnPerRollQuoteLineError(quoteId, asked.quoteLineId, line.lineNumber);
    }
    if (perPound && asked.orderedWeightLb === undefined) {
      throw new PerPoundLineNeedsPoundsError(quoteId, asked.quoteLineId, line.lineNumber);
    }
    wanted.set(asked.quoteLineId, asked);
  }

  return quoteLines.flatMap((line) => {
    const asked = line.quoteLineId === undefined ? undefined : wanted.get(line.quoteLineId);
    if (asked === undefined) return [];
    const pounds =
      asked.orderedWeightLb === undefined
        ? line.orderedWeightLb
        : toMeasure(toDecimal(asked.orderedWeightLb));
    const poundsMoved =
      pounds !== undefined &&
      (line.orderedWeightLb === undefined ||
        !toDecimal(pounds).eq(toDecimal(line.orderedWeightLb)));
    if (asked.quantityRolls === line.quantityRolls && !poundsMoved) {
      return [line];
    }
    return [
      {
        ...line,
        quantityRolls: asked.quantityRolls,
        ...(pounds === undefined ? {} : { orderedWeightLb: pounds }),
        ...requantified(line, asked.quantityRolls, pounds),
      },
    ];
  });
}

type ConvertibleQuote = NonNullable<Awaited<ReturnType<QuoteLookup['findConvertible']>>>;

function checkedLines(
  quoteId: string,
  quoteLines: readonly NewOrderLine[],
  requested: readonly CreateOrderLine[] | undefined,
): readonly NewOrderLine[] {
  const lines = requested === undefined ? quoteLines : chosenLines(quoteId, quoteLines, requested);
  for (const line of lines) {
    if (line.pricingBasis === 'per_pound' && line.rollWeightLb === undefined) {
      throw new PerPoundLineNeedsRollWeightError(quoteId, line.lineNumber);
    }
  }
  return lines;
}

export interface TransitionContext {
  actor: string;

  confirmedLeadTimeDays?: number;

  expectedLockVersion?: number;
}

export class OrderService {
  readonly #orders: OrderRepository;
  readonly #quotes: QuoteLookup;
  readonly #recipients: CustomerRecipients | undefined;
  readonly #notifier: OrderConfirmationNotifier | undefined;
  readonly #productionManagers: ProductionManagerRecipients | undefined;
  readonly #orderNotifier: OrderReceivedNotifier | undefined;
  readonly #clock: Clock;

  constructor(options: OrderServiceOptions) {
    this.#orders = options.orders;
    this.#quotes = options.quotes;
    this.#recipients = options.recipients;
    this.#notifier = options.notifier;
    this.#productionManagers = options.productionManagers;
    this.#orderNotifier = options.orderNotifier;
    this.#clock = options.clock;
  }

  /**
   * Creates one order from a convertible quote, copying its lines at the quoted prices:
   * docs/product/requirements.md (R9). Any signed-in user may convert, and `context.actor` is the
   * session user, recorded on the history row and the PO: docs/product/requirements.md (R10).
   * The order, its opening history row and the PO are one `createMany` write, all or none.
   */
  async createFromQuote(
    request: CreateOrderRequest,
    context: { actor: string },
  ): Promise<OrderWithLines> {
    const quote = await this.#convertibleQuote(request.quoteId);
    const lines = checkedLines(request.quoteId, quote.lines, request.lines);

    const now = this.#clock.now();
    const id = newId();

    const [order] = await this.#orders.createMany([
      {
        id,
        quoteId: request.quoteId,

        customerId: quote.customerId,

        ...(quote.salesRep === undefined ? {} : { salesRep: quote.salesRep }),

        ...(request.requestedDate === undefined ? {} : { requestedDate: request.requestedDate }),
        status: INITIAL_ORDER_STATUS,
        createdAt: now,
        updatedAt: now,

        lines: lines.map((line) => ({ ...line, id: newId() })),

        opening: {
          id: newId(),
          from: null,
          to: INITIAL_ORDER_STATUS,
          reason: 'converted from quote',
          actor: context.actor,
          at: now.toISOString(),
        },
        ...(request.poNumber === undefined
          ? {}
          : { purchaseOrder: { poNumber: request.poNumber, capturedBy: context.actor } }),
      },
    ]);
    if (order === undefined) {
      throw new Error(`creating order "${id}" returned no order`);
    }
    return order;
  }

  /** One order per delivery date, written together by `createMany`. Each carries the same PO number. */
  async createOrdersFromQuote(
    request: CreateOrdersRequest,
    context: { actor: string },
  ): Promise<readonly OrderWithLines[]> {
    const quote = await this.#convertibleQuote(request.quoteId);
    const planned = request.deliveries.map((delivery) => ({
      requestedDate: delivery.requestedDate,
      lines: checkedLines(request.quoteId, quote.lines, delivery.lines),
    }));

    const now = this.#clock.now();
    return this.#orders.createMany(
      planned.map((delivery) => {
        const id = newId();
        return {
          id,
          quoteId: request.quoteId,

          customerId: quote.customerId,
          ...(quote.salesRep === undefined ? {} : { salesRep: quote.salesRep }),
          requestedDate: delivery.requestedDate,
          status: INITIAL_ORDER_STATUS,
          createdAt: now,
          updatedAt: now,

          lines: delivery.lines.map((line) => ({ ...line, id: newId() })),

          opening: {
            id: newId(),
            from: null,
            to: INITIAL_ORDER_STATUS,
            reason: 'converted from quote',
            actor: context.actor,
            at: now.toISOString(),
          },
          ...(request.poNumber === undefined
            ? {}
            : { purchaseOrder: { poNumber: request.poNumber, capturedBy: context.actor } }),
        };
      }),
    );
  }

  async #convertibleQuote(quoteId: string): Promise<ConvertibleQuote> {
    const quote = await this.#quotes.findConvertible(quoteId);
    if (quote === null) {
      throw new UnknownQuoteError(quoteId);
    }
    if (quote.lines.length === 0) {
      throw new EmptyQuoteError(quoteId);
    }
    return quote;
  }

  async findById(id: string): Promise<Order | null> {
    return this.#orders.findById(id);
  }

  async findWithLines(id: string): Promise<OrderWithLines | null> {
    return this.#orders.findWithLines(id);
  }

  /**
   * Checks that an order confirmation may be sent: the order is confirmed and the customer has a
   * contact tagged `order_confirmation`. The API calls it before rendering the document, then
   * calls `issueConfirmation` with the stored result.
   */
  async confirmationIssuable(
    orderId: string,
  ): Promise<{ order: Order; to: readonly string[] } | null> {
    const recipientsPort = this.#recipients;
    if (recipientsPort === undefined || this.#notifier === undefined) {
      throw new Error('this OrderService was constructed without confirmation delivery');
    }

    const order = await this.#orders.findById(orderId);
    if (order === null) {
      return null;
    }

    if (order.status !== 'confirmed') {
      throw new OrderNotConfirmedError(order.id, order.status);
    }

    const to = await recipientsPort.emailsFor(order.customerId);
    if (to.length === 0) {
      throw new NoConfirmationRecipientError(order.id, order.customerId);
    }

    return { order, to };
  }

  async issueConfirmation(
    orderId: string,
    document: StoredDocument,
    context: { actor: string },
  ): Promise<ConfirmationIssued | null> {
    const issuable = await this.confirmationIssuable(orderId);
    if (issuable === null) {
      return null;
    }

    const notifier = this.#notifier as OrderConfirmationNotifier;
    return notifier.confirmationIssued(issuable.order, document, issuable.to, context.actor);
  }

  async capturePurchaseOrder(
    id: string,
    request: CapturePurchaseOrderRequest,
  ): Promise<OrderWithLines | null> {
    return this.#orders.capturePurchaseOrder(id, request, this.#clock.now(), request.lockVersion);
  }

  /**
   * Mails the Production Managers that an order is waiting for them. Throws
   * `NoProductionManagerError` when nobody can be reached. The API logs that and keeps the order.
   */
  async notifyOrderReceived(orderId: string): Promise<OrderReceivedNotified | null> {
    const recipientsPort = this.#productionManagers;
    const notifier = this.#orderNotifier;
    if (recipientsPort === undefined || notifier === undefined) {
      throw new Error('this OrderService was constructed without order notification');
    }

    const order = await this.#orders.findWithLines(orderId);
    if (order === null) {
      return null;
    }

    const { emails, withoutEmail } = await recipientsPort.audience();
    if (emails.length === 0) {
      throw new NoProductionManagerError(order.id, withoutEmail);
    }

    return notifier.orderReceived(order, emails);
  }

  async list(params: OrderListParams = {}): Promise<readonly Order[]> {
    return this.#orders.list(params);
  }

  async countAndOldest(
    params: Omit<OrderListParams, 'sort' | 'limit'> = {},
  ): Promise<CountAndOldest<Order>> {
    return this.#orders.countAndOldest(params);
  }

  async linesByOrderIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, readonly OrderLine[]>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const lines = await this.#orders.linesByOrderIds(unique);

    const byOrder = new Map<string, OrderLine[]>();
    for (const line of lines) {
      const bucket = byOrder.get(line.orderId);
      if (bucket === undefined) {
        byOrder.set(line.orderId, [line]);
      } else {
        bucket.push(line);
      }
    }
    return byOrder;
  }

  async totals(id: string): Promise<OrderTotals | null> {
    const order = await this.#orders.findWithLines(id);
    return order === null ? null : orderTotals(order.lines);
  }

  async totalsByIds(ids: readonly string[]): Promise<ReadonlyMap<string, OrderTotals>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const lines = await this.#orders.linesByOrderIds(unique);

    const byOrder = new Map<string, OrderLine[]>();
    for (const line of lines) {
      const bucket = byOrder.get(line.orderId);
      if (bucket === undefined) {
        byOrder.set(line.orderId, [line]);
      } else {
        bucket.push(line);
      }
    }

    return new Map([...byOrder].map(([orderId, group]) => [orderId, orderTotals(group)]));
  }

  async history(orderId: string): Promise<readonly OrderTransition[]> {
    return this.#orders.history(orderId);
  }

  async transition(
    id: string,
    request: { to: OrderStatus },
    context: TransitionContext,
  ): Promise<Order | null> {
    const order = await this.#orders.findById(id);
    if (order === null) {
      return null;
    }

    assertTransition(order.status, request.to);

    const patch: OrderPatch = {};

    if (request.to === 'confirmed') {
      const missing: string[] = [];
      if (context.confirmedLeadTimeDays === undefined) missing.push('confirmedLeadTimeDays');
      if (missing.length > 0) {
        throw new MissingConfirmationDetailsError(missing);
      }
    }

    // The move was checked on the version read, so it is written only at that version:
    // docs/decisions/006-optimistic-concurrency.md.
    const expected = context.expectedLockVersion;
    if (expected !== undefined && order.lockVersion !== expected) {
      throw new StaleAggregateError('order', id, expected, order.lockVersion);
    }

    // Confirmation commits a lead time in calendar days and takes the job number:
    // docs/product/requirements.md (R11) and docs/product/decisions.md. The number is minted before
    // the guarded write, so a write that lands between the read and the guarded write leaves a gap
    // in the sequence.
    if (request.to === 'confirmed' && context.confirmedLeadTimeDays !== undefined) {
      patch.confirmedLeadTimeDays = context.confirmedLeadTimeDays;

      patch.confirmedBy = context.actor;
      patch.confirmedAt = this.#clock.now();

      patch.jobNumber = await this.#orders.mintJobNumber();
    }

    const now = this.#clock.now();
    return this.#orders.transition(
      id,
      request.to,
      patch,
      {
        id: newId(),
        from: order.status,
        to: request.to,
        actor: context.actor,
        at: now.toISOString(),
      },
      now,
      context.expectedLockVersion,
    );
  }
}
