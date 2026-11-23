// The orders composition root: the order store, the messages orders sends, and the ports declared in modules/orders/src/ports.ts.
// Those ports are filled from quoting, crm, identity, documents and notifications.
// A quote line is copied into an order line field by field: docs/decisions/002-what-crosses-a-module-boundary.md.
import type { ContactService, CustomerService } from '@erp/crm';
import { createPool } from '@erp/db';
import { DEMO_BRAND, type DocumentService } from '@erp/documents';
import type { MailLog, MailSink, SendLog } from '@erp/notifications';

import { recipientsForRole } from '../crm/recipients-for-role';
import { describeWebBaseUrl } from '../notifications/notifications.factory';
import { sendAndNotify, type FailureNotifier } from '../notifications/notify-sender-of-failure';
import { apiClock } from '../test-clock';
import { orderSubjectLabel, quoteReference, type Order, type StoredDocument } from '@erp/types';
import { resolvePersistenceModeFromEnv } from '../config/persistence-guard';
import {
  DrizzleOrderRepository,
  InMemoryOrderRepository,
  OrderService,
  QuoteFailsSendChecksError,
  createOrdersDb,
  type OrderRepository,
} from '@erp/orders';
import {
  BelowFloorQuoteError,
  OverrideNotApprovedError,
  QuoteHasNoLeadTimeError,
  QuoteNotPrintableError,
  isConvertible,
  type QuoteService,
} from '@erp/quoting';

import type { IdentityStores } from '../auth/auth.factory';

export const ORDERS_STORES = Symbol('ORDERS_STORES');

export interface OrdersStores {
  orders: OrderRepository;

  close(): Promise<void>;
}

export async function createOrdersStores(): Promise<OrdersStores> {
  const persistence = resolvePersistenceModeFromEnv(process.env);

  if (persistence === 'memory') {
    return {
      orders: new InMemoryOrderRepository(),
      close: async () => {},
    };
  }

  const pool = createPool();
  const db = createOrdersDb(pool);
  return {
    orders: new DrizzleOrderRepository(db),
    close: () => pool.end(),
  };
}

export function orderReceivedMessage(
  order: Pick<Order, 'id' | 'poNumber' | 'jobNumber'>,
  naming: {
    readonly customerName: string;

    readonly quoteRef: string | undefined;

    readonly webBaseUrl: string | undefined;
  },
) {
  const po = order.poNumber === undefined ? '' : ` (PO ${order.poNumber})`;
  const name =
    naming.quoteRef === undefined
      ? `Order ${orderSubjectLabel(order)} for ${naming.customerName}`
      : `Order from ${naming.quoteRef} for ${naming.customerName}`;
  const whereToOpen =
    naming.webBaseUrl === undefined
      ? 'Open it from Orders, under Production.'
      : `Open the order: ${naming.webBaseUrl}${orderPagePath(order.id)}`;
  return {
    subject: `New order to confirm: ${name}${po}`,
    textBody: [
      `A new order came in: ${name}${po}.`,
      '',
      'Confirm material and lead time to release it to production.',
      '',
      whereToOpen,
      '',
    ].join('\n'),
  };
}

export function orderPagePath(orderId: string): string {
  return `/orders/${encodeURIComponent(orderId)}`;
}

function confirmationMessage(order: Order, stored: StoredDocument, bytes: Uint8Array) {
  const reference = order.jobNumber ?? order.id;
  return {
    subject: `Order Confirmation ${reference} from ${DEMO_BRAND.name}`,
    textBody:
      `Your order is confirmed and the confirmation is attached.\n\n` +
      (order.poNumber === undefined ? '' : `Your PO: ${order.poNumber}\n`) +
      `If anything looks wrong, reply to this message and we will correct it ` +
      `before the job runs.\n`,
    attachments: [{ filename: stored.filename, contentType: stored.contentType, bytes }],
  };
}

// A quote in a convertible status is offered only while it still passes the gates a send passes. `printableQuote` in
// modules/quoting/src/services/quote-service.ts checks them and only reads. A quote that left the printable statuses
// since the first read answers null, as any quote that is not convertible does.
async function quoteStillPassingTheGates(quotes: QuoteService, quoteId: string) {
  try {
    return await quotes.printableQuote(quoteId);
  } catch (err) {
    if (err instanceof BelowFloorQuoteError) {
      throw new QuoteFailsSendChecksError(
        quoteId,
        'below-floor',
        err.lines.map((line) => line.lineNumber),
      );
    }
    if (err instanceof OverrideNotApprovedError) {
      throw new QuoteFailsSendChecksError(quoteId, 'override-not-approved', err.lines);
    }
    if (err instanceof QuoteHasNoLeadTimeError) {
      throw new QuoteFailsSendChecksError(quoteId, 'no-lead-time');
    }
    if (err instanceof QuoteNotPrintableError) {
      return null;
    }
    throw err;
  }
}

export async function createOrderService(
  stores: OrdersStores,
  quotes: QuoteService,
  documents: DocumentService,
  contacts: ContactService,
  mail: MailSink,
  identity: IdentityStores,
  customers: CustomerService,
  sendLog: SendLog,
  notifySender: FailureNotifier,
  log: MailLog,
): Promise<OrderService> {
  const webBaseUrl = describeWebBaseUrl();
  return new OrderService({
    orders: stores.orders,

    recipients: {
      emailsFor: async (customerId) =>
        recipientsForRole(contacts, customerId, 'order_confirmation'),
    },

    // Holders with no email address are returned by name, so a failed alert can say who needs one.
    productionManagers: {
      audience: async () => {
        const holders = await identity.users.listByRole('ProductionManager');

        const emails: string[] = [];
        const withoutEmail: string[] = [];
        for (const holder of holders) {
          if (holder.email === undefined || holder.email === null) {
            withoutEmail.push(holder.username);
          } else {
            emails.push(holder.email);
          }
        }
        return { emails, withoutEmail };
      },
    },
    orderNotifier: {
      orderReceived: async (order, to) => {
        const customer = await customers.findById(order.customerId);

        const quote = await quotes.findById(order.quoteId);
        const message = orderReceivedMessage(order, {
          customerName: customer?.name ?? order.customerId,
          quoteRef: quote === null ? undefined : quoteReference(quote),
          webBaseUrl,
        });
        const submission = await sendAndNotify(
          { mail, sendLog, log, notifySender },
          { to, ...message },
          {
            subject: { type: 'order', id: order.id, label: orderSubjectLabel(order) },

            audience: 'internal',
            // The alert's actor is whoever converted, read from the order's first transition.
            actor: (await stores.orders.history(order.id))[0]?.actor ?? 'system',
          },
        );
        return {
          recipients: to,
          messageId: submission.messageId,
          notifiedAt: submission.acceptedByRelayAt,
        };
      },
    },

    notifier: {
      confirmationIssued: async (order, document, to, actor) => {
        const bytes = await documents.read(document);
        const submission = await sendAndNotify(
          { mail, sendLog, log, notifySender },
          { to, ...confirmationMessage(order, document, bytes) },
          {
            subject: { type: 'order', id: order.id, label: orderSubjectLabel(order) },

            audience: 'customer',

            actor,
          },
        );

        return {
          recipients: to,
          messageId: submission.messageId,
          issuedAt: submission.acceptedByRelayAt,
        };
      },
    },

    quotes: {
      // Only a quote in a convertible status that still passes the send gates is offered. The order keeps its own copy
      // of the quoted lines and prices: docs/product/requirements.md (R9). The copy is field by field, never a spread,
      // so nothing of how a price was derived crosses unless it is named here:
      // docs/decisions/002-what-crosses-a-module-boundary.md.
      findConvertible: async (quoteId) => {
        const found = await quotes.findWithLines(quoteId);
        if (found === null || !isConvertible(found.status)) {
          return null;
        }
        const quote = await quoteStillPassingTheGates(quotes, quoteId);
        if (quote === null || !isConvertible(quote.status)) {
          return null;
        }
        return {
          id: quote.id,
          customerId: quote.customerId,

          ...(quote.salesRep === undefined ? {} : { salesRep: quote.salesRep }),
          lines: quote.lines.map((line) => ({
            lineNumber: line.lineNumber,
            quoteLineId: line.id,

            gradeId: line.gradeId,
            footageVariant: line.footageVariant,

            feetPerRoll: line.cost.feetPerRoll,
            rollWidthIn: line.rollWidthIn,

            customWidth: line.customWidth ?? false,
            quantityRolls: line.quantityRolls,
            overwrap: line.overwrap,
            pallets: line.pallets,
            estimatedWeightLb: line.estimatedWeightLb,

            revenueCategory: line.revenueCategory,

            printed: line.printed,

            ...(line.customerPartNumber === undefined
              ? {}
              : { customerPartNumber: line.customerPartNumber }),
            ...(line.customerDescription === undefined
              ? {}
              : { customerDescription: line.customerDescription }),
            taxStatus: line.taxStatus,
            ...(line.taxJurisdiction === undefined
              ? {}
              : { taxJurisdiction: line.taxJurisdiction }),

            ...(line.deliveryAddress === undefined
              ? {}
              : { deliveryAddress: line.deliveryAddress }),

            pricingBasis: line.pricingBasis,

            ...(line.orderedWeightLb === undefined
              ? {}
              : { orderedWeightLb: line.orderedWeightLb }),

            pricePerRoll: line.pricePerRoll,

            ...(line.productPricePerLb === undefined
              ? {}
              : { productPricePerLb: line.productPricePerLb }),

            totalCostPerRoll: line.cost.totalCostPerRoll,
            extendedPrice: line.extendedPrice,
            extendedCost: line.extendedCost,
            extendedMargin: line.extendedMargin,

            rollWeightLb: line.cost.rollWeightLb,
            paperCostPerLb: line.cost.paperCostPerLb,
            paperCostPerRoll: line.cost.paperCostPerRoll,

            freight: line.freight,
            freightResult: line.freightResult,
          })),
        };
      },
    },
    clock: apiClock,
  });
}
