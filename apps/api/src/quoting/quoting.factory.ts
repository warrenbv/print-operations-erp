// The quoting composition root: chooses quoting's stores, builds its services, and fills the ports declared in modules/quoting/src/ports.ts.
// The ports are filled from crm, orders, identity, documents and notifications, each in the shape quoting asks for.
// Storage follows docs/decisions/007-persistence-switch-at-the-composition-root.md.
import type { CustomerDefaultsService, CustomerService } from '@erp/crm';
import { createPool } from '@erp/db';
import { DEMO_BRAND, type DocumentService } from '@erp/documents';
import { resolvePersistenceModeFromEnv } from '../config/persistence-guard';
import type { MailLog, MailSink, SendLog } from '@erp/notifications';

import { describeWebBaseUrl } from '../notifications/notifications.factory';
import { sendAndNotify, type FailureNotifier } from '../notifications/notify-sender-of-failure';
import {
  formatWidthIn,
  quoteReference,
  type Quote,
  type QuoteSend,
  type QuoteWithLines,
  type StoredDocument,
} from '@erp/types';
import {
  DrizzleTaxRateRepository,
  InMemoryTaxRateRepository,
  TaxRateService,
  type TaxRateRepository,
  DEFAULT_GRADES,
  DrizzleGradeRepository,
  DrizzlePalletFitRepository,
  DrizzlePricingConfigRepository,
  DrizzlePricingTierRepository,
  DrizzleQuoteApprovalRepository,
  DrizzleQuoteRepository,
  GradeService,
  InMemoryGradeRepository,
  InMemoryPalletFitRepository,
  InMemoryPricingConfigRepository,
  InMemoryPricingTierRepository,
  InMemoryQuoteApprovalRepository,
  InMemoryQuoteRepository,
  PricingConfigService,
  PricingTierService,
  QuotePricingService,
  QuoteService,
  RollCostService,
  TaxCodeLookupService,
  createQuotingDb,
  type GradeRepository,
  type PalletFitRepository,
  type PricingConfigRepository,
  type PricingTierRepository,
  type QuoteApprovalRepository,
  type QuoteRepository,
} from '@erp/quoting';

import type { IdentityStores } from '../auth/auth.factory';
import type { OrdersStores } from '../orders/orders.factory';
import { apiClock } from '../test-clock';
import { createTaxCodeLookup } from './tax-code-lookup-mode';

export const QUOTING_STORES = Symbol('QUOTING_STORES');

export interface QuotingStores {
  grades: GradeRepository;
  palletFits: PalletFitRepository;
  config: PricingConfigRepository;
  tiers: PricingTierRepository;
  quotes: QuoteRepository;

  approvals: QuoteApprovalRepository;

  taxRates: TaxRateRepository;

  close(): Promise<void>;
}

export async function createQuotingStores(): Promise<QuotingStores> {
  const persistence = resolvePersistenceModeFromEnv(process.env);

  if (persistence === 'memory') {
    return {
      grades: new InMemoryGradeRepository(DEFAULT_GRADES),
      palletFits: new InMemoryPalletFitRepository(),
      config: new InMemoryPricingConfigRepository(),
      tiers: new InMemoryPricingTierRepository(),
      // The in-memory quote store holds the approval store, so starting a quote spends its credit-hold exception in the
      // same write: docs/product/requirements.md (R2).
      ...(() => {
        const approvals = new InMemoryQuoteApprovalRepository();
        return { approvals, quotes: new InMemoryQuoteRepository(approvals) };
      })(),

      taxRates: new InMemoryTaxRateRepository(),
      close: async () => {},
    };
  }

  const pool = createPool();
  const db = createQuotingDb(pool);
  return {
    grades: new DrizzleGradeRepository(db),
    palletFits: new DrizzlePalletFitRepository(db),
    config: new DrizzlePricingConfigRepository(db),
    tiers: new DrizzlePricingTierRepository(db),
    quotes: new DrizzleQuoteRepository(db),
    approvals: new DrizzleQuoteApprovalRepository(db),
    taxRates: new DrizzleTaxRateRepository(db),
    close: () => pool.end(),
  };
}

export async function createGradeService(stores: QuotingStores): Promise<GradeService> {
  return new GradeService({
    grades: stores.grades,
    quotes: stores.quotes,
    palletFits: stores.palletFits,
    clock: apiClock,
  });
}

export async function createPricingConfigService(
  stores: QuotingStores,
): Promise<PricingConfigService> {
  return new PricingConfigService({ config: stores.config, clock: apiClock });
}

export async function createPricingTierService(stores: QuotingStores): Promise<PricingTierService> {
  return new PricingTierService({ tiers: stores.tiers, clock: apiClock });
}

export async function createRollCostService(stores: QuotingStores): Promise<RollCostService> {
  return new RollCostService({
    grades: stores.grades,
    config: stores.config,
    palletFits: stores.palletFits,
  });
}

export async function createQuotePricingService(
  stores: QuotingStores,
  rollCost: RollCostService,
): Promise<QuotePricingService> {
  return new QuotePricingService({
    rollCost,
    tiers: stores.tiers,
    config: stores.config,
  });
}

function quoteMessage(quote: Quote, stored: StoredDocument, bytes: Uint8Array) {
  return {
    subject: `Quote ${quoteReference(quote)} from ${DEMO_BRAND.name}`,
    textBody:
      `Your quote is attached.\n\n` +
      `If anything looks wrong, reply to this message and we will revise it.\n`,
    attachments: [{ filename: stored.filename, contentType: stored.contentType, bytes }],
  };
}

function quoteSentAlert(quote: QuoteWithLines, send: QuoteSend, customerName: string) {
  const itemised = quote.lines
    .map(
      (line) =>
        `  line ${line.lineNumber}: ${formatWidthIn(line.rollWidthIn)} × ${line.footageVariant}` +
        `${line.overwrap ? ' · overwrapped' : ''} — ${line.quantityRolls} rolls`,
    )
    .join('\n');

  return {
    subject: `Quote ${quoteReference(quote)} sent to ${customerName}`,
    textBody: [
      `${send.actor} has emailed quote ${quoteReference(quote)} to ${customerName}.`,
      ...(itemised === '' ? [] : ['', itemised]),
      '',
      'Nothing is committed yet — this is the work to expect if the PO follows.',
      '',
    ].join('\n'),
  };
}

function leadTimePagePath(quoteId: string): string {
  return `/quoting/quotes/${quoteId}#lead-time`;
}

function leadTimeNeededMessage(
  quote: Pick<QuoteWithLines, 'id' | 'quoteNumber' | 'versionNumber' | 'salesRep' | 'lines'>,
  naming: {
    readonly customerName: string;

    readonly actor: string;

    readonly webBaseUrl: string | undefined;
  },
) {
  const reference = quoteReference(quote);
  const rep = quote.salesRep ?? naming.actor;
  const lines = quote.lines.length === 1 ? '1 line' : `${quote.lines.length} lines`;
  const whereToOpen =
    naming.webBaseUrl === undefined
      ? 'Open it from Needs a lead time, under Production.'
      : `Enter the lead time: ${naming.webBaseUrl}${leadTimePagePath(quote.id)}`;
  return {
    subject: `${reference} needs a lead time`,
    textBody: [
      `Quote ${reference} for ${naming.customerName} is priced and waiting on a lead time.`,
      '',
      `Sales rep: ${rep}`,
      `Lines: ${lines}`,
      '',
      whereToOpen,
      '',
    ].join('\n'),
  };
}
// Order lookups go in chunks, which keeps the id list of any one query bounded.
const QUOTE_ID_CHUNK = 1000;

export async function createQuoteService(
  stores: QuotingStores,
  pricing: QuotePricingService,
  customers: CustomerService,
  orders: OrdersStores,
  documents: DocumentService,
  mail: MailSink,
  identity: IdentityStores,
  sendLog: SendLog,
  notifySender: FailureNotifier,
  customerDefaults: CustomerDefaultsService,
  log: MailLog,
): Promise<QuoteService> {
  const webBaseUrl = describeWebBaseUrl();
  return new QuoteService({
    quotes: stores.quotes,
    pricing,
    approvals: stores.approvals,
    customers: {
      exists: async (customerId) => (await customers.findById(customerId)) !== null,
      // False for a customer on credit hold: docs/product/requirements.md (R2).
      mayQuote: async (customerId) => customers.mayQuote(customerId),

      hasBillingAddress: async (customerId) => customers.hasBillingAddress(customerId),

      billingState: async (customerId) => customers.billingState(customerId),

      agreedPrice: async (customerId, gradeId, rollWidthIn) =>
        customerDefaults.agreedPrice(customerId, gradeId, rollWidthIn),
    },

    orders: {
      existsForQuote: async (quoteId) => orders.orders.existsForQuote(quoteId),

      quoteIdsWithOrders: async (quoteIds) => {
        const found = new Set<string>();
        for (let at = 0; at < quoteIds.length; at += QUOTE_ID_CHUNK) {
          const chunk = quoteIds.slice(at, at + QUOTE_ID_CHUNK);
          for (const order of await orders.orders.list({ quoteIds: chunk })) {
            found.add(order.quoteId);
          }
        }
        return [...found];
      },
    },

    notifier: {
      quoteSent: async (quote, document, to, actor) => {
        const bytes = await documents.read(document);

        const submission = await sendAndNotify(
          { mail, sendLog, log, notifySender },
          { to, ...quoteMessage(quote, document, bytes) },
          {
            subject: { type: 'quote', id: quote.id, label: quoteReference(quote) },

            audience: 'customer',

            actor,
          },
        );
        return {
          recipients: to,
          messageId: submission.messageId,
          acceptedByRelayAt: submission.acceptedByRelayAt,
        };
      },
    },

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
    productionNotifier: {
      quoteSentToCustomer: async (quote, send, to) => {
        const customer = await customers.findById(quote.customerId);

        const submission = await sendAndNotify(
          { mail, sendLog, log, notifySender },
          { to, ...quoteSentAlert(quote, send, customer?.name ?? quote.customerId) },
          {
            subject: { type: 'quote', id: quote.id, label: quoteReference(quote) },

            audience: 'internal',

            actor: send.actor,
          },
        );

        return {
          recipients: to,
          messageId: submission.messageId,
          notifiedAt: submission.acceptedByRelayAt,
        };
      },

      leadTimeNeeded: async (quote, to, actor) => {
        const customer = await customers.findById(quote.customerId);
        const submission = await sendAndNotify(
          { mail, sendLog, log, notifySender },
          {
            to,
            ...leadTimeNeededMessage(quote, {
              customerName: customer?.name ?? quote.customerId,
              actor,
              webBaseUrl,
            }),
          },
          {
            subject: { type: 'quote', id: quote.id, label: quoteReference(quote) },
            audience: 'internal',
            kind: 'lead-time-request',
            actor,
          },
        );
        return {
          recipients: to,
          messageId: submission.messageId,
          notifiedAt: submission.acceptedByRelayAt,
        };
      },
    },

    // Production is asked for a lead time once per quote. The send log is the record of having asked.
    leadTimeRequests: {
      alreadyAsked: async (quoteId) =>
        (await sendLog.latestFor({ type: 'quote', id: quoteId }, { kind: 'lead-time-request' })) !==
        undefined,
    },

    taxJurisdictions: createTaxRateService(stores),
    clock: apiClock,
  });
}

export function createTaxRateService(stores: QuotingStores): TaxRateService {
  return new TaxRateService(stores.taxRates);
}

export function createTaxCodeLookupService(stores: QuotingStores): TaxCodeLookupService {
  return new TaxCodeLookupService(createTaxCodeLookup(process.env), createTaxRateService(stores));
}
