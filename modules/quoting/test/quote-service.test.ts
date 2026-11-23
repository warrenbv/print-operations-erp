// Tests the quote service on in-memory adapters: creation under credit hold, line pricing and its
// refusals, the send gates, approvals and floor overrides, lead time, sends and revisions. The
// rules come from docs/product/requirements.md. Subject:
// modules/quoting/src/services/quote-service.ts.
import type {
  AgreedPriceTerms,
  NewTaxRate,
  Quote,
  QuoteLineInput,
  QuoteSend,
  QuoteStatus,
  QuoteWithLines,
  StoredDocument,
} from '@erp/types';
import { roundToCents, sum, toDecimal, toMoney } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { InMemoryGradeRepository } from '../src/adapters/in-memory/in-memory-grade-repository';
import { InMemoryPalletFitRepository } from '../src/adapters/in-memory/in-memory-pallet-fit-repository';
import { InMemoryPricingConfigRepository } from '../src/adapters/in-memory/in-memory-pricing-config-repository';
import { InMemoryPricingTierRepository } from '../src/adapters/in-memory/in-memory-pricing-tier-repository';
import { InMemoryQuoteApprovalRepository } from '../src/adapters/in-memory/in-memory-quote-approval-repository';
import { InMemoryQuoteRepository } from '../src/adapters/in-memory/in-memory-quote-repository';
import { InMemoryTaxRateRepository } from '../src/adapters/in-memory/in-memory-tax-rate-repository';
import {
  BelowFloorQuoteError,
  FloorOverrideAlreadyApprovedError,
  NoProductionManagerError,
  NothingBelowFloorError,
  NothingToApproveError,
  OverrideAlreadyApprovedError,
  OverrideNotApprovedError,
  QuoteHasNoRecipientsError,
  QuoteHasOrderError,
  LineEnteredMarginBelowFloorError,
  LineEnteredMarginHandSetPriceError,
  LineEnteredMarginTierOverrideError,
  LineJurisdictionMismatchError,
  LinePerPoundHandSetPriceError,
  LinePerPoundNeedsOrderedWeightError,
  LinePerRollOrderedWeightError,
  LinePerPoundNeedsRollWeightError,
  LinePerRollHandSetPoundPriceError,
  QuoteNotEditableError,
  QuoteHasNoLeadTimeError,
  QuoteNeedsLeadTimeError,
  QuoteNotPrintableError,
  QuoteNotRevisableError,
  QuoteRedistributionNotConfirmedError,
  StaleAggregateError,
  CustomerNotOnCreditHoldError,
  CustomerBillingAddressRequiredError,
  CustomerOnCreditHoldError,
  UnknownCustomerError,
  UnknownFootageVariantError,
  UnknownTaxJurisdictionError,
  WidthNotStockedError,
} from '../src/ports';
import type {
  CustomerLookup,
  OrderLookup,
  ProductionManagerNotifier,
  LeadTimeRequestLog,
  ProductionManagerRecipients,
  QuoteNotifier,
  QuoteRepository,
} from '../src/ports';
import { InvalidQuoteTransitionError } from '../src/quote-state-machine';
import { QuotePricingService } from '../src/services/quote-pricing-service';
import { QuoteService } from '../src/services/quote-service';
import { RollCostService } from '../src/services/roll-cost-service';
import { TaxRateService } from '../src/services/tax-rate-service';
import { familyStockWidths } from './fixtures';

const CUSTOMER = 'customer-acme';
const GRADE = 'grade-kraft-30';

const WEIGHTLESS_GRADE = 'grade-kraft-weightless';

function makeClock(start = '2026-08-07T09:00:00.000Z') {
  let current = new Date(start);
  return {
    now: () => current,
    set: (iso: string) => {
      current = new Date(iso);
    },
  };
}

const customers: CustomerLookup = {
  exists: async (id) => id === CUSTOMER,

  mayQuote: async () => true,

  hasBillingAddress: async () => true,

  billingState: async () => 'ID',
  agreedPrice: async () => undefined,
};

const heldCustomers: CustomerLookup = {
  exists: async (id) => id === CUSTOMER,
  mayQuote: async () => false,
  hasBillingAddress: async () => true,
  billingState: async () => 'ID',
  agreedPrice: async () => undefined,
};

const addresslessCustomers: CustomerLookup = {
  exists: async (id) => id === CUSTOMER,
  mayQuote: async () => true,
  hasBillingAddress: async () => false,
  billingState: async () => 'ID',
  agreedPrice: async () => undefined,
};

const heldAddresslessCustomers: CustomerLookup = {
  exists: async (id) => id === CUSTOMER,
  mayQuote: async () => false,
  hasBillingAddress: async () => false,
  billingState: async () => 'ID',
  agreedPrice: async () => undefined,
};

const convertedQuoteIds = new Set<string>();
const orders: OrderLookup = {
  existsForQuote: async (quoteId) => convertedQuoteIds.has(quoteId),
  quoteIdsWithOrders: async (quoteIds) => {
    batchReads.push([...quoteIds]);
    return quoteIds.filter((id) => convertedQuoteIds.has(id));
  },
};

const batchReads: string[][] = [];

const RENDER = (): Promise<StoredDocument> => Promise.resolve(STORED_QUOTE);

const STORED_QUOTE: StoredDocument = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'quote',
  subject: { type: 'quote', id: 'quote-1' },
  filename: 'quote-1.pdf',
  storagePath: 'quote/quote-1.pdf',
  contentType: 'application/pdf',
  byteSize: 3_481,
  checksumSha256: 'a'.repeat(64),
  documentAt: '2026-08-17T09:00:00.000Z',
  storedAt: '2026-08-17T09:00:00.000Z',
  source: 'generated',
  uploadedBy: null,
  originalFilename: null,
};

const RELAY_AT = new Date('2026-08-17T09:05:00.000Z');
const PM_AT = new Date('2026-08-17T09:05:04.000Z');

function makeNotifiers() {
  const sent: { quote: QuoteWithLines; document: StoredDocument; to: readonly string[] }[] = [];
  const announced: { quote: QuoteWithLines; send: QuoteSend; to: readonly string[] }[] = [];

  const asked: { quote: QuoteWithLines; to: readonly string[]; actor: string }[] = [];

  const askedIds = new Set<string>();
  let holders: readonly string[] = ['pm@org.example.test'];

  let holdersWithoutEmail: readonly string[] = [];
  let relayRefuses: Error | null = null;

  return {
    sent,

    announced,
    asked,

    markAsked: (quoteId: string) => {
      askedIds.add(quoteId);
    },
    setProductionManagers: (emails: readonly string[], withoutEmail: readonly string[] = []) => {
      holders = emails;

      holdersWithoutEmail = withoutEmail;
    },

    refuseNextSend: (error: Error) => {
      relayRefuses = error;
    },
    notifier: {
      quoteSent: async (quote: QuoteWithLines, document: StoredDocument, to: readonly string[]) => {
        if (relayRefuses !== null) {
          const error = relayRefuses;
          relayRefuses = null;
          throw error;
        }
        sent.push({ quote, document, to });
        return {
          recipients: to,
          messageId: `<send-${sent.length}@erp.org.example.test>`,
          acceptedByRelayAt: RELAY_AT,
        };
      },
    } satisfies QuoteNotifier,
    productionManagers: {
      audience: async () => ({ emails: holders, withoutEmail: holdersWithoutEmail }),
    } satisfies ProductionManagerRecipients,
    productionNotifier: {
      quoteSentToCustomer: async (
        quote: QuoteWithLines,
        send: QuoteSend,
        to: readonly string[],
      ) => {
        announced.push({ quote, send, to });
        return {
          recipients: to,
          messageId: `<pm-${announced.length}@erp.org.example.test>`,
          notifiedAt: PM_AT,
        };
      },
      leadTimeNeeded: async (quote: QuoteWithLines, to: readonly string[], actor: string) => {
        asked.push({ quote, to, actor });

        askedIds.add(quote.id);
        return {
          recipients: to,
          messageId: `<lead-time-${asked.length}@erp.org.example.test>`,
          notifiedAt: PM_AT,
        };
      },
    } satisfies ProductionManagerNotifier,
    leadTimeRequests: {
      alreadyAsked: async (quoteId: string) => askedIds.has(quoteId),
    } satisfies LeadTimeRequestLog,
  };
}

async function makeService(clock = makeClock(), customerLookup: CustomerLookup = customers) {
  const grades = new InMemoryGradeRepository();
  await grades.create({
    id: GRADE,
    productFamily: 'kraft',
    code: '35#',
    basisWeightLb: '35.0000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '900.0000',
    footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1500.0000' }],
    widths: familyStockWidths('kraft'),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });

  await grades.create({
    id: WEIGHTLESS_GRADE,
    productFamily: 'kraft',
    code: '0#',
    basisWeightLb: '0.0000',
    reamAreaDivisor: '432.0000',
    paperCostPerTonne: '900.0000',
    footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1500.0000' }],
    widths: familyStockWidths('kraft'),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });

  const config = new InMemoryPricingConfigRepository();
  const tiers = new InMemoryPricingTierRepository();
  const pricing = new QuotePricingService({
    rollCost: new RollCostService({
      grades,
      config,
      palletFits: new InMemoryPalletFitRepository(),
    }),
    tiers,
    config,
  });

  const approvals = new InMemoryQuoteApprovalRepository();
  const quotes = new InMemoryQuoteRepository(approvals);
  convertedQuoteIds.clear();
  batchReads.length = 0;
  const mail = makeNotifiers();

  const taxRates = new InMemoryTaxRateRepository(LOADED_TAX_RATES);
  const service = new QuoteService({
    quotes,
    pricing,
    customers: customerLookup,
    approvals,
    orders,
    notifier: mail.notifier,
    productionManagers: mail.productionManagers,
    productionNotifier: mail.productionNotifier,
    leadTimeRequests: mail.leadTimeRequests,
    taxJurisdictions: new TaxRateService(taxRates),
    clock,
  });

  return { service, quotes, approvals, pricing, tiers, config, clock, mail, taxRates };
}

const LOADED_TAX_RATES: readonly NewTaxRate[] = [
  { jurisdiction: 'ID', rate: '0.060000', effectiveFrom: '2001-01-01', source: 'statute' },
  {
    jurisdiction: 'WA-9020',
    rate: '0.082000',
    effectiveFrom: '2026-10-01',
    source: 'wa_dor',
    name: 'SAMPLE CITY',
  },
];

const LEAD_TIME_SETTER = 'dev-production-manager';

async function withLeadTime(service: QuoteService, quoteId: string, days = 10): Promise<void> {
  const quote = await service.findById(quoteId);
  await service.setLeadTime(
    quoteId,
    { leadTimeDays: days, lockVersion: quote?.lockVersion ?? 1 },
    LEAD_TIME_SETTER,
  );
}

const line = (over: Record<string, unknown> = {}) => ({
  gradeId: GRADE,
  footageVariant: 'long',
  rollWidthIn: 24,
  quantityRolls: 100,
  overwrap: false,

  pricingBasis: 'per_roll' as const,

  freight: { mode: 'pickup' as const },

  revenueCategory: 'print' as const,
  printed: false,
  taxTreatment: { taxStatus: 'id_tax' as const, taxJurisdiction: 'ID' },
  ...over,
});

async function saveLines(service: QuoteService, quoteId: string, lines: readonly QuoteLineInput[]) {
  const current = await service.findById(quoteId);
  return service.setLines(quoteId, lines, current?.lockVersion ?? 1);
}

async function decideNow(
  service: QuoteService,
  id: string,
  kind: 'approve' | 'reject',
  over: { actor?: string; reason?: string } = {},
) {
  const current = await service.findById(id);
  const request = {
    actor: 'bmanager',
    lockVersion: current?.lockVersion ?? 1,
    ...over,
  };
  return kind === 'approve'
    ? service.approveOverride(id, request)
    : service.rejectOverride(id, { ...request, reason: over.reason ?? 'no reason given' });
}

async function moveNow(service: QuoteService, id: string, to: QuoteStatus, actor = SALES_REP) {
  const current = await service.findById(id);
  return service.transition(id, to, current?.lockVersion ?? 1, actor);
}

const SALES_REP = 'dev-sales';

async function decideFloorNow(
  service: QuoteService,
  id: string,
  kind: 'approve' | 'reject',
  over: { actor?: string; reason?: string } = {},
) {
  const current = await service.findById(id);
  const request = {
    actor: 'dev-admin',
    lockVersion: current?.lockVersion ?? 1,
    reason: 'finance agreed this margin for the account',
    ...over,
  };
  return kind === 'approve'
    ? service.approveFloorOverride(id, request)
    : service.rejectFloorOverride(id, request);
}

describe('QuoteService.create', () => {
  it('opens a quote in draft with no lines', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    expect(quote.status).toBe('draft');
    expect(quote.customerId).toBe(CUSTOMER);
    expect((await service.findWithLines(quote.id))?.lines).toEqual([]);
  });

  it('mints the id itself rather than taking one', async () => {
    const { service } = await makeService();
    const a = await service.create({ customerId: CUSTOMER });
    const b = await service.create({ customerId: CUSTOMER });

    expect(a.id).not.toBe(b.id);
  });

  it('numbers every new quote, each one its own', async () => {
    const { service } = await makeService();
    const a = await service.create({ customerId: CUSTOMER });
    const b = await service.create({ customerId: CUSTOMER });

    expect(a.quoteNumber).toBeGreaterThan(0);
    expect(b.quoteNumber).toBeGreaterThan(a.quoteNumber);
    expect((await service.list({ quoteNumber: a.quoteNumber })).map((q) => q.id)).toEqual([a.id]);
  });

  it('carries sales rep and notes when given', async () => {
    const { service } = await makeService();
    const quote = await service.create({
      customerId: CUSTOMER,
      salesRep: 'jsmith',
      notes: 'rush',
    });

    expect(quote).toMatchObject({ salesRep: 'jsmith', notes: 'rush' });
  });

  it('refuses a customer that does not exist', async () => {
    const { service } = await makeService();

    await expect(service.create({ customerId: 'customer-nobody' })).rejects.toThrow(
      UnknownCustomerError,
    );
  });

  it('writes nothing when the customer check fails', async () => {
    const { service, quotes } = await makeService();
    await expect(service.create({ customerId: 'customer-nobody' })).rejects.toThrow();

    expect(await quotes.list({})).toEqual([]);
  });

  it('refuses a customer with no billing address', async () => {
    const { service } = await makeService(makeClock(), addresslessCustomers);

    await expect(service.create({ customerId: CUSTOMER })).rejects.toThrow(
      CustomerBillingAddressRequiredError,
    );
  });

  it('names the customer and points at the fix, rather than failing bare', async () => {
    const { service } = await makeService(makeClock(), addresslessCustomers);

    await expect(service.create({ customerId: CUSTOMER })).rejects.toMatchObject({
      customerId: CUSTOMER,
      message: expect.stringContaining('billing address'),
    });
  });

  it('writes no quote for a customer with no billing address', async () => {
    const { service, quotes } = await makeService(makeClock(), addresslessCustomers);

    await expect(service.create({ customerId: CUSTOMER })).rejects.toThrow();

    expect(await quotes.list({})).toEqual([]);
  });

  it('refuses on the address before the credit-hold path can spend an approval', async () => {
    const { service, quotes, approvals } = await makeService(makeClock(), heldAddresslessCustomers);
    const asked = await service.requestApproval(CUSTOMER, {
      reason: 'PO in hand',
      requestedBy: 'jsmith',
    });
    await service.decideApproval(asked.id, { decision: 'approved', decidedBy: 'bmanager' });

    await expect(service.create({ customerId: CUSTOMER })).rejects.toThrow(
      CustomerBillingAddressRequiredError,
    );

    expect(await quotes.list({})).toEqual([]);

    expect((await approvals.findById(asked.id))?.spentByQuoteId).toBeUndefined();
  });

  it('refuses a customer on credit hold', async () => {
    const { service } = await makeService(makeClock(), heldCustomers);

    await expect(service.create({ customerId: CUSTOMER })).rejects.toThrow(
      CustomerOnCreditHoldError,
    );
  });

  it('names the customer and points at the approval path, rather than failing bare', async () => {
    const { service } = await makeService(makeClock(), heldCustomers);

    await expect(service.create({ customerId: CUSTOMER })).rejects.toMatchObject({
      customerId: CUSTOMER,
      message: expect.stringContaining('credit hold'),
    });
    await expect(service.create({ customerId: CUSTOMER })).rejects.toMatchObject({
      message: expect.stringContaining('approve'),
    });
  });

  it('writes no quote for a held customer', async () => {
    const { service, quotes } = await makeService(makeClock(), heldCustomers);

    await expect(service.create({ customerId: CUSTOMER })).rejects.toThrow();

    expect(await quotes.list({})).toEqual([]);
  });

  it('creates one quote for a held customer holding an approval, and spends it', async () => {
    const { service, approvals } = await makeService(makeClock(), heldCustomers);
    const asked = await service.requestApproval(CUSTOMER, {
      reason: 'PO in hand',
      requestedBy: 'jsmith',
    });
    await service.decideApproval(asked.id, { decision: 'approved', decidedBy: 'bmanager' });

    const quote = await service.create({ customerId: CUSTOMER });

    expect(quote.customerId).toBe(CUSTOMER);

    expect((await approvals.findById(asked.id))?.spentByQuoteId).toBe(quote.id);
  });

  it('blocks the SECOND quote again — one approval, one quote', async () => {
    const { service } = await makeService(makeClock(), heldCustomers);
    const asked = await service.requestApproval(CUSTOMER, {
      reason: 'PO in hand',
      requestedBy: 'jsmith',
    });
    await service.decideApproval(asked.id, { decision: 'approved', decidedBy: 'bmanager' });
    await service.create({ customerId: CUSTOMER });

    await expect(service.create({ customerId: CUSTOMER })).rejects.toThrow(
      CustomerOnCreditHoldError,
    );
  });

  it('does not let a merely pending request through', async () => {
    const { service } = await makeService(makeClock(), heldCustomers);
    await service.requestApproval(CUSTOMER, { reason: 'PO in hand', requestedBy: 'jsmith' });

    await expect(service.create({ customerId: CUSTOMER })).rejects.toThrow(
      CustomerOnCreditHoldError,
    );
  });

  it('does not let a rejected request through', async () => {
    const { service } = await makeService(makeClock(), heldCustomers);
    const asked = await service.requestApproval(CUSTOMER, {
      reason: 'PO in hand',
      requestedBy: 'jsmith',
    });
    await service.decideApproval(asked.id, {
      decision: 'rejected',
      decidedBy: 'bmanager',
      reason: '90 days out',
    });

    await expect(service.create({ customerId: CUSTOMER })).rejects.toThrow(
      CustomerOnCreditHoldError,
    );
  });

  it('refuses a request for a customer who is not held', async () => {
    const { service } = await makeService();

    await expect(
      service.requestApproval(CUSTOMER, { reason: 'why not', requestedBy: 'jsmith' }),
    ).rejects.toThrow(CustomerNotOnCreditHoldError);
  });

  it('refuses a request for a customer that does not exist', async () => {
    const { service } = await makeService(makeClock(), heldCustomers);

    await expect(
      service.requestApproval('customer-nobody', { reason: 'x', requestedBy: 'jsmith' }),
    ).rejects.toThrow(UnknownCustomerError);
  });

  it('refuses to approve a request for a customer released while it queued', async () => {
    let held = true;
    const releasable: CustomerLookup = {
      exists: async (id) => id === CUSTOMER,
      mayQuote: async () => !held,
      hasBillingAddress: async () => true,
      billingState: async () => 'ID',
      agreedPrice: async () => undefined,
    };
    const { service } = await makeService(makeClock(), releasable);
    const asked = await service.requestApproval(CUSTOMER, {
      reason: 'PO in hand',
      requestedBy: 'jsmith',
    });

    held = false;

    await expect(
      service.decideApproval(asked.id, { decision: 'approved', decidedBy: 'bmanager' }),
    ).rejects.toThrow(CustomerNotOnCreditHoldError);
  });

  it('still allows REJECTING a request for a customer released meanwhile', async () => {
    let held = true;
    const releasable: CustomerLookup = {
      exists: async (id) => id === CUSTOMER,
      mayQuote: async () => !held,
      hasBillingAddress: async () => true,
      billingState: async () => 'ID',
      agreedPrice: async () => undefined,
    };
    const { service } = await makeService(makeClock(), releasable);
    const asked = await service.requestApproval(CUSTOMER, {
      reason: 'PO in hand',
      requestedBy: 'jsmith',
    });

    held = false;

    await expect(
      service.decideApproval(asked.id, {
        decision: 'rejected',
        decidedBy: 'bmanager',
        reason: 'no longer needed, account released',
      }),
    ).resolves.toMatchObject({ status: 'rejected' });
  });

  it('lists what is waiting on a decision', async () => {
    const { service } = await makeService(makeClock(), heldCustomers);
    await service.requestApproval(CUSTOMER, { reason: 'one', requestedBy: 'jsmith' });

    expect(await service.listPendingApprovals()).toHaveLength(1);
  });

  it('tells an unknown customer apart from a held one', async () => {
    const { service } = await makeService(makeClock(), heldCustomers);

    await expect(service.create({ customerId: 'customer-nobody' })).rejects.toThrow(
      UnknownCustomerError,
    );
  });
});

describe('QuoteService.setLines stock and custom widths', () => {
  it('refuses a width the paper is not stocked in, naming the line', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const attempt = saveLines(service, quote.id, [line(), line({ rollWidthIn: 17 })]);
    await expect(attempt).rejects.toBeInstanceOf(WidthNotStockedError);
    await expect(attempt).rejects.toMatchObject({ lineNumber: 2, rollWidthIn: 17 });
  });

  it('prices and marks a custom width when the line asks for one', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [
      line({ rollWidthIn: 17, customWidth: true }),
    ]);
    const stored = saved?.lines[0];

    expect(stored?.rollWidthIn).toBe(17);
    expect(stored?.customWidth).toBe(true);

    expect(stored?.cost.rollsPerPallet).toBe(54);
    expect(Number(stored?.pricePerRoll)).toBeGreaterThan(0);
  });

  it('saves a ticked box on a stocked width as a stock width', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [
      line({ rollWidthIn: 24, customWidth: true }),
    ]);
    expect(saved?.lines[0]?.customWidth).toBe(false);
  });
});

describe('QuoteService.setLines', () => {
  it('prices the lines and stores what it priced', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line()]);
    const stored = saved?.lines[0];

    expect(stored?.lineNumber).toBe(1);
    expect(stored?.gradeId).toBe(GRADE);
    expect(stored?.quantityRolls).toBe(100);

    expect(Number(stored?.pricePerRoll)).toBeGreaterThan(0);
    expect(Number(stored?.extendedPrice)).toBeGreaterThan(0);
  });

  it('stores the basis and the price per pound of a per-pound line', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [
      line({ pricingBasis: 'per_pound', orderedWeightLb: '1000.0000' }),
    ]);
    const stored = saved?.lines[0];

    expect(stored?.pricingBasis).toBe('per_pound');
    expect(Number(stored?.productPricePerLb)).toBeGreaterThan(0);

    expect(Number(stored?.pricePerRoll)).toBeGreaterThan(0);

    expect(stored?.quantityRolls).toBe(100);
    expect(stored?.orderedWeightLb).toBe('1000.0000');
    expect(stored?.extendedPrice).toBe(
      toMoney(toDecimal(stored?.productPricePerLb ?? '0').times('1000')),
    );
  });

  it("stores the customer's part number and description as typed, each on its own", async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [
      line({ customerPartNumber: 'LN-1300-C', customerDescription: 'CEDAR CORE SHEET' }),
      line({ customerPartNumber: 'LN-870' }),
      line(),
    ]);

    expect(saved?.lines[0]).toMatchObject({
      customerPartNumber: 'LN-1300-C',
      customerDescription: 'CEDAR CORE SHEET',
    });
    expect(saved?.lines[1]?.customerPartNumber).toBe('LN-870');
    expect(saved?.lines[1]).not.toHaveProperty('customerDescription');
    expect(saved?.lines[2]).not.toHaveProperty('customerPartNumber');
    expect(saved?.lines[2]).not.toHaveProperty('customerDescription');

    expect(saved?.lines[0]?.extendedPrice).toBe(saved?.lines[2]?.extendedPrice);
  });

  it('refuses a per-pound line with no pounds ordered, naming the line', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const rows = [line(), line({ pricingBasis: 'per_pound' })];

    await expect(saveLines(service, quote.id, rows)).rejects.toThrow(
      LinePerPoundNeedsOrderedWeightError,
    );
    await expect(saveLines(service, quote.id, rows)).rejects.toThrow(/line 2/);
  });

  it('refuses pounds ordered on a per-roll line, naming the line', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const rows = [line({ orderedWeightLb: '1000.0000' })];

    await expect(saveLines(service, quote.id, rows)).rejects.toThrow(LinePerRollOrderedWeightError);
    await expect(saveLines(service, quote.id, rows)).rejects.toThrow(/line 1/);
  });

  it('stores no price per pound on a per-roll line', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line()]);

    expect(saved?.lines[0]?.pricingBasis).toBe('per_roll');

    expect(saved?.lines[0]?.productPricePerLb).toBeUndefined();
  });

  it('refuses a per-pound line whose roll weight is zero, naming the line', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    const before = await service.findById(quote.id);

    const rows = [
      line(),
      line({ pricingBasis: 'per_pound', orderedWeightLb: '1000.0000', gradeId: WEIGHTLESS_GRADE }),
    ];

    await expect(saveLines(service, quote.id, rows)).rejects.toThrow(
      LinePerPoundNeedsRollWeightError,
    );
    await expect(saveLines(service, quote.id, rows)).rejects.toThrow(/line 2/);

    const after = await service.findWithLines(quote.id);
    expect(after?.lines).toHaveLength(1);
    expect(after?.lockVersion).toBe(before?.lockVersion);
  });

  it('prices a weightless roll per ROLL without complaint', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line({ gradeId: WEIGHTLESS_GRADE })]);

    expect(saved?.lines[0]?.pricingBasis).toBe('per_roll');
    expect(saved?.lines[0]?.estimatedWeightLb).toBe('0.0000');
  });

  it('refuses a per-pound line that also carries a hand-set price', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const rows = [
      line({
        pricingBasis: 'per_pound',
        orderedWeightLb: '1000.0000',
        overridePricePerRoll: '11.7500',
      }),
    ];

    await expect(saveLines(service, quote.id, rows)).rejects.toThrow(LinePerPoundHandSetPriceError);
    await expect(saveLines(service, quote.id, rows)).rejects.toThrow(/line 1/);

    expect(
      (await saveLines(service, quote.id, [line({ overridePricePerRoll: '11.7500' })]))?.lines[0]
        ?.pricePerRoll,
    ).toBe('11.7500');
    expect(
      (
        await saveLines(service, quote.id, [
          line({ pricingBasis: 'per_pound', orderedWeightLb: '1000.0000' }),
        ])
      )?.lines[0]?.pricingBasis,
    ).toBe('per_pound');
  });

  it('stores a hand-set price per pound, and what it replaced', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [
      line({
        pricingBasis: 'per_pound',
        orderedWeightLb: '1000.0000',
        overridePricePerLb: '1.0700',
      }),
    ]);
    const stored = saved?.lines[0];

    expect(stored?.overridePricePerLb).toBe('1.0700');
    expect(stored?.productPricePerLb).toBe('1.0700');
    expect(stored?.priceSource).toBe('manual');

    expect(stored?.basePricePerLb).toBeDefined();
    expect(stored?.basePricePerLb).not.toBe('1.0700');
  });

  it('refuses a per-roll line carrying a hand-set price per pound, naming the line', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const rows = [line(), line({ overridePricePerLb: '1.0700' })];

    await expect(saveLines(service, quote.id, rows)).rejects.toThrow(
      LinePerRollHandSetPoundPriceError,
    );
    await expect(saveLines(service, quote.id, rows)).rejects.toThrow(/line 2/);

    expect((await service.findWithLines(quote.id))?.lines).toHaveLength(0);
  });

  it('stores the cost build-up beside the price', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line()]);

    expect(saved?.lines[0]?.cost).toMatchObject({
      rollWeightLb: expect.any(String),
      paperCostPerRoll: expect.any(String),
      hardwareCostPerRoll: expect.any(String),
      totalCostPerRoll: expect.any(String),
    });
  });

  it('snapshots the tier rather than referencing it', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line()]);
    expect(saved?.lines[0]?.tier).toMatchObject({
      code: expect.any(String),
      marginPct: expect.any(String),
      source: 'auto',
    });
  });

  it('records that a person chose the tier when one was overridden', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line({ tierOverrideCode: 'retail' })]);

    expect(saved?.lines[0]?.tier.source).toBe('override');
    expect(saved?.lines[0]?.tierOverrideCode).toBe('retail');
  });

  it('numbers lines 1-based in the order supplied', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [
      line({ quantityRolls: 10 }),
      line({ quantityRolls: 20 }),
      line({ quantityRolls: 30 }),
    ]);

    expect(saved?.lines.map((l) => l.lineNumber)).toEqual([1, 2, 3]);
    expect(saved?.lines.map((l) => l.quantityRolls)).toEqual([10, 20, 30]);
  });

  it('replaces wholesale rather than appending', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line(), line()]);

    const saved = await saveLines(service, quote.id, [line({ quantityRolls: 7 })]);

    expect(saved?.lines).toHaveLength(1);
    expect(saved?.lines[0]?.quantityRolls).toBe(7);
  });

  it('returns null for an unknown quote', async () => {
    const { service } = await makeService();
    expect(await saveLines(service, 'quote-nobody', [line()])).toBeNull();
  });

  it('refuses to write onto a quote that has been sent', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    await expect(saveLines(service, quote.id, [line()])).rejects.toThrow(QuoteNotEditableError);
  });

  it('still allows edits while an override is pending', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await moveNow(service, quote.id, 'override_requested');

    const saved = await saveLines(service, quote.id, [line({ quantityRolls: 42 })]);
    expect(saved?.lines[0]?.quantityRolls).toBe(42);
  });

  it('leaves the existing lines alone when a later line fails to price', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ quantityRolls: 11 })]);

    await expect(
      saveLines(service, quote.id, [line(), line({ footageVariant: 'nope' })]),
    ).rejects.toThrow(UnknownFootageVariantError);

    const after = await service.findWithLines(quote.id);
    expect(after?.lines).toHaveLength(1);
    expect(after?.lines[0]?.quantityRolls).toBe(11);
  });

  it('leaves the existing lines alone when a line names a missing grade', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ quantityRolls: 11 })]);

    expect(await saveLines(service, quote.id, [line({ gradeId: 'grade-gone' })])).toBeNull();

    const after = await service.findWithLines(quote.id);
    expect(after?.lines[0]?.quantityRolls).toBe(11);
  });

  it('refuses a save made against a generation the quote has left', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    const asBothSawIt = quote.lockVersion;

    await service.setLines(quote.id, [line()], asBothSawIt);

    await expect(
      service.setLines(quote.id, [line({ quantityRolls: 7 })], asBothSawIt),
    ).rejects.toThrow(StaleAggregateError);
  });

  it('leaves the lines from the first save in place when the second is refused', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    const asBothSawIt = quote.lockVersion;

    await service.setLines(quote.id, [line(), line({ quantityRolls: 6 })], asBothSawIt);
    await service
      .setLines(quote.id, [line({ quantityRolls: 7 })], asBothSawIt)
      .catch(() => undefined);

    const after = await service.findWithLines(quote.id);
    expect(after?.lines).toHaveLength(2);
    expect(after?.lines[1]?.quantityRolls).toBe(6);
  });

  it('says which generation it expected and which it found', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await service.setLines(quote.id, [line()], quote.lockVersion);

    const failure = (await service
      .setLines(quote.id, [line()], quote.lockVersion)
      .catch((error: unknown) => error)) as StaleAggregateError;
    expect(failure.expected).toBe(quote.lockVersion);
    expect(failure.actual).toBe(quote.lockVersion + 1);
  });
});

describe('QuoteService — the stored calculation', () => {
  it('reloads the price it was quoted at after the tier margin changes', async () => {
    const { service, tiers } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    const saved = await saveLines(service, quote.id, [line()]);
    const quotedPrice = saved?.lines[0]?.pricePerRoll;

    await withLeadTime(service, quote.id);

    await moveNow(service, quote.id, 'quoted');

    const usedTier = saved?.lines[0]?.tier.code as string;
    await tiers.update(usedTier, { marginPct: '0.475000' }, new Date(), 'test:tier-edit');

    const reloaded = await service.findWithLines(quote.id);
    expect(reloaded?.lines[0]?.pricePerRoll).toBe(quotedPrice);
  });

  it('reloads the price it was quoted at after paper cost changes', async () => {
    const { service, quotes, pricing } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    const saved = await saveLines(service, quote.id, [line()]);
    const quotedPrice = saved?.lines[0]?.pricePerRoll;

    const repriced = await pricing.priceLine(line());
    expect(repriced?.pricePerRoll).toBe(quotedPrice);

    const stored = await quotes.findWithLines(quote.id);
    expect(stored?.lines[0]?.pricePerRoll).toBe(quotedPrice);
  });

  it('keeps the margin it was priced at, not the tier/s current one', async () => {
    const { service, tiers } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    const saved = await saveLines(service, quote.id, [line()]);
    const quotedTierMargin = saved?.lines[0]?.tier.marginPct;

    const usedTier = saved?.lines[0]?.tier.code as string;
    await tiers.update(usedTier, { marginPct: '0.985000' }, new Date(), 'test:tier-edit');

    const reloaded = await service.findWithLines(quote.id);
    expect(reloaded?.lines[0]?.tier.marginPct).toBe(quotedTierMargin);
  });
});

describe('QuoteService.transition', () => {
  it('moves a quote through a legal edge', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    await withLeadTime(service, quote.id);

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('refuses to send a quote with no lead time', async () => {
    const { service, quotes } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(QuoteNeedsLeadTimeError);

    expect((await quotes.findById(quote.id))?.status).toBe('draft');
  });

  it('sends once a lead time is entered, with no revision needed', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(QuoteNeedsLeadTimeError);

    await withLeadTime(service, quote.id);

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('blocks an illegal move before it reaches storage', async () => {
    const { service, quotes } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await moveNow(service, quote.id, 'closed_lost');

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(InvalidQuoteTransitionError);
    expect((await quotes.findById(quote.id))?.status).toBe('closed_lost');
  });

  it('refuses to close a converted quote as lost', async () => {
    const { service, quotes } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');
    convertedQuoteIds.add(quote.id);

    await expect(moveNow(service, quote.id, 'closed_lost')).rejects.toThrow(QuoteHasOrderError);

    expect((await quotes.findById(quote.id))?.status).toBe('quoted');
  });

  it('still allows closing an unconverted quote as lost', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    expect((await moveNow(service, quote.id, 'closed_lost'))?.status).toBe('closed_lost');
  });

  it('does not ask about orders for any other move', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');
    convertedQuoteIds.add(quote.id);

    expect((await moveNow(service, quote.id, 'superseded'))?.status).toBe('superseded');
  });

  it('returns null for an unknown id', async () => {
    const { service } = await makeService();
    expect(await moveNow(service, 'quote-nobody', 'quoted')).toBeNull();
  });

  it('does not let a sent quote go back to draft', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    await expect(moveNow(service, quote.id, 'draft')).rejects.toThrow(InvalidQuoteTransitionError);
  });

  it('stamps updatedAt from the clock', async () => {
    const clock = makeClock('2026-08-07T09:00:00.000Z');
    const { service } = await makeService(clock);
    const quote = await service.create({ customerId: CUSTOMER });

    clock.set('2026-08-07T15:30:00.000Z');
    await withLeadTime(service, quote.id);
    const moved = await moveNow(service, quote.id, 'quoted');

    expect(moved?.updatedAt).toBe('2026-08-07T15:30:00.000Z');
  });

  it('refuses a move made against figures that have since changed', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    const stale = (await service.findById(quote.id))!.lockVersion;

    await saveLines(service, quote.id, [line({ quantityRolls: 7 })]);

    await expect(service.transition(quote.id, 'closed_lost', stale, SALES_REP)).rejects.toThrow(
      StaleAggregateError,
    );

    expect((await service.findById(quote.id))?.status).toBe('draft');
  });

  it('lets the same move through once the caller has re-read', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    const stale = (await service.findById(quote.id))!.lockVersion;
    await saveLines(service, quote.id, [line({ quantityRolls: 7 })]);

    await expect(service.transition(quote.id, 'closed_lost', stale, SALES_REP)).rejects.toThrow(
      StaleAggregateError,
    );
    expect((await moveNow(service, quote.id, 'closed_lost'))?.status).toBe('closed_lost');
  });

  it('reports an illegal move as illegal, not as staleness', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    const stale = (await service.findById(quote.id))!.lockVersion;

    await moveNow(service, quote.id, 'override_requested');

    await expect(
      service.transition(quote.id, 'override_requested', stale, SALES_REP),
    ).rejects.toThrow(InvalidQuoteTransitionError);
  });

  it('still moves a quote the SYSTEM re-drafts, with no token of its own', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '73.2500' })]);
    await moveNow(service, quote.id, 'override_requested');

    const approved = await decideNow(service, quote.id, 'approve');

    expect(approved?.status).toBe('draft');
    expect(approved?.overrideApprovedBy).toBe('bmanager');
  });
});

describe('QuoteService.totals', () => {
  it('sums the stored line figures at the cent they are shown at', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    const saved = await saveLines(service, quote.id, [
      line({ quantityRolls: 100 }),
      line({ quantityRolls: 250 }),
    ]);

    const totals = await service.totals(quote.id);
    const lines = saved?.lines ?? [];
    const expected = sum(
      lines.map((l) => roundToCents(l.extendedPrice)),
      'money',
    );

    expect(totals?.extendedPrice).toBe(expected);

    expect(roundToCents(totals?.extendedPrice ?? '')).toBe(totals?.extendedPrice);
  });

  it('reports margin as price minus cost, so the three figures agree', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line(), line({ quantityRolls: 7 })]);

    const totals = await service.totals(quote.id);
    expect(Number(totals?.extendedMargin)).toBeCloseTo(
      Number(totals?.extendedPrice) - Number(totals?.extendedCost),
      4,
    );
  });

  it('is zero, not null, for a quote with no lines', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    expect(await service.totals(quote.id)).toMatchObject({
      extendedPrice: '0.0000',
      extendedCost: '0.0000',
      extendedMargin: '0.0000',
    });
  });

  it('returns null for an unknown quote', async () => {
    const { service } = await makeService();
    expect(await service.totals('quote-nobody')).toBeNull();
  });
});

describe('QuoteService.list', () => {
  it('filters by customer', async () => {
    const { service } = await makeService();
    await service.create({ customerId: CUSTOMER });
    await service.create({ customerId: CUSTOMER });

    expect(await service.list({ customerIds: [CUSTOMER] })).toHaveLength(2);
    expect(await service.list({ customerIds: ['customer-other'] })).toEqual([]);
  });

  it('filters by status', async () => {
    const { service } = await makeService();
    const a = await service.create({ customerId: CUSTOMER });
    await service.create({ customerId: CUSTOMER });
    await withLeadTime(service, a.id);
    await moveNow(service, a.id, 'quoted');

    expect(await service.list({ status: 'quoted' })).toHaveLength(1);
    expect(await service.list({ status: 'draft' })).toHaveLength(1);
  });

  describe('converted: false', () => {
    async function threeSent() {
      const clock = makeClock('2026-10-01T16:00:00.000Z');
      const ctx = await makeService(clock);
      const ids: string[] = [];
      for (const at of ['2026-10-01', '2026-10-02', '2026-10-03']) {
        clock.set(`${at}T16:00:00.000Z`);
        const quote = await ctx.service.create({ customerId: CUSTOMER });
        await withLeadTime(ctx.service, quote.id);
        await moveNow(ctx.service, quote.id, 'quoted');
        ids.push(quote.id);
      }
      const [oldest, middle, newest] = ids as [string, string, string];
      return { ...ctx, oldest, middle, newest };
    }

    it('lists only the quotes no order was converted from', async () => {
      const { service, oldest, middle, newest } = await threeSent();
      convertedQuoteIds.add(middle);

      const listed = await service.list({ status: 'quoted', converted: false });
      expect(listed.map((q) => q.id).sort()).toEqual([oldest, newest].sort());

      expect(await service.list({ status: 'quoted' })).toHaveLength(3);
    });

    it('counts them and names the oldest, in one batched order read', async () => {
      const { service, oldest, middle } = await threeSent();
      convertedQuoteIds.add(oldest);
      batchReads.length = 0;

      const counted = await service.countAndOldest({ status: 'quoted', converted: false });
      expect(counted.count).toBe(2);

      expect(counted.oldest?.id).toBe(middle);
      expect(batchReads).toHaveLength(1);
      expect(batchReads[0]).toHaveLength(3);
    });

    it('cuts the limit after the filter, so a converted row never shortens the page', async () => {
      const { service, oldest, middle } = await threeSent();
      convertedQuoteIds.add(oldest);

      const page = await service.list({
        status: 'quoted',
        converted: false,
        sort: 'oldest',
        limit: 1,
      });
      expect(page.map((q) => q.id)).toEqual([middle]);
    });

    it('answers zero with no oldest when every match has an order', async () => {
      const { service, oldest, middle, newest } = await threeSent();
      for (const id of [oldest, middle, newest]) convertedQuoteIds.add(id);

      expect(await service.countAndOldest({ status: 'quoted', converted: false })).toEqual({
        count: 0,
        oldest: null,
      });
    });

    it('asks orders nothing when no quote matches', async () => {
      const { service } = await makeService();
      batchReads.length = 0;

      expect(await service.countAndOldest({ status: 'quoted', converted: false })).toEqual({
        count: 0,
        oldest: null,
      });
      expect(batchReads).toEqual([]);
    });
  });
});

describe('QuoteService.revise', () => {
  async function sent(clock = makeClock()) {
    const ctx = await makeService(clock);
    const quote = await ctx.service.create({ customerId: CUSTOMER, salesRep: 'jsmith' });
    await saveLines(ctx.service, quote.id, [
      line({ quantityRolls: 100 }),
      line({ quantityRolls: 40 }),
    ]);
    await withLeadTime(ctx.service, quote.id);
    await moveNow(ctx.service, quote.id, 'quoted');
    return { ...ctx, quote };
  }

  async function sentThenChanged(clock = makeClock()) {
    const state = { held: false, addressed: true, exists: true };
    const lookup: CustomerLookup = {
      exists: async (id) => state.exists && id === CUSTOMER,
      mayQuote: async () => !state.held,
      hasBillingAddress: async () => state.addressed,
      billingState: async () => 'ID',
      agreedPrice: async () => undefined,
    };
    const ctx = await makeService(clock, lookup);
    const quote = await ctx.service.create({ customerId: CUSTOMER, salesRep: 'jsmith' });
    await saveLines(ctx.service, quote.id, [line({ quantityRolls: 100 })]);
    await withLeadTime(ctx.service, quote.id);
    await moveNow(ctx.service, quote.id, 'quoted');
    return { ...ctx, quote, state };
  }

  it('refuses to revise for a customer put on credit hold after the quote was sent', async () => {
    const { service, quote, state } = await sentThenChanged();
    state.held = true;

    await expect(service.revise(quote.id)).rejects.toThrow(CustomerOnCreditHoldError);
  });

  it('writes no version when the customer is held', async () => {
    const { service, quotes, quote, state } = await sentThenChanged();
    state.held = true;

    await expect(service.revise(quote.id)).rejects.toThrow();

    const chain = await quotes.list({});
    expect(chain).toHaveLength(1);
    expect(chain[0]?.id).toBe(quote.id);
  });

  it('still revises once the hold is lifted', async () => {
    const { service, quote, state } = await sentThenChanged();
    state.held = true;
    await expect(service.revise(quote.id)).rejects.toThrow();

    state.held = false;
    const revised = await service.revise(quote.id);

    expect(revised?.versionNumber).toBe(2);
  });

  it('refuses on the billing address before the credit hold, when both are wrong', async () => {
    const { service, quote, state } = await sentThenChanged();
    state.held = true;
    state.addressed = false;

    await expect(service.revise(quote.id)).rejects.toThrow(CustomerBillingAddressRequiredError);
  });

  it('does not re-check existence, because crm cannot delete a customer', async () => {
    const { service, quote, state } = await sentThenChanged();
    state.exists = false;

    const revised = await service.revise(quote.id);
    expect(revised?.versionNumber).toBe(2);
  });

  it('mints v2 as a draft and supersedes v1', async () => {
    const { service, quote } = await sent();

    const v2 = await service.revise(quote.id);

    expect(v2).toMatchObject({ versionNumber: 2, status: 'draft', rootQuoteId: quote.id });
    expect((await service.findById(quote.id))?.status).toBe('superseded');
  });

  it('keeps the quote number, so v2 is the same quote to the person reading it', async () => {
    const { service, quote } = await sent();

    const other = await service.create({ customerId: CUSTOMER });

    const v2 = await service.revise(quote.id);

    expect(other.quoteNumber).not.toBe(quote.quoteNumber);
    expect(v2?.quoteNumber).toBe(quote.quoteNumber);
  });

  it('copies the lines forward at the prices v1 was quoted at', async () => {
    const { service, quote } = await sent();
    const before = await service.findWithLines(quote.id);

    const v2 = await service.revise(quote.id);

    expect(v2?.lines).toHaveLength(2);
    expect(v2?.lines.map((l) => l.pricePerRoll)).toEqual(before?.lines.map((l) => l.pricePerRoll));
    expect(v2?.lines.map((l) => l.extendedPrice)).toEqual(
      before?.lines.map((l) => l.extendedPrice),
    );
    expect(v2?.lines[0]?.tier).toEqual(before?.lines[0]?.tier);
  });

  it('does not re-price even after the tier table moves', async () => {
    const { service, quote, tiers } = await sent();
    const before = await service.findWithLines(quote.id);
    const usedTier = before?.lines[0]?.tier.code as string;

    await tiers.update(usedTier, { marginPct: '0.715000' }, new Date(), 'test:tier-edit');
    const v2 = await service.revise(quote.id);

    expect(v2?.lines[0]?.pricePerRoll).toBe(before?.lines[0]?.pricePerRoll);
    expect(v2?.lines[0]?.tier.marginPct).toBe(before?.lines[0]?.tier.marginPct);
  });

  it('gives v2 fresh line ids — they are new rows', async () => {
    const { service, quote } = await sent();
    const before = await service.findWithLines(quote.id);

    const v2 = await service.revise(quote.id);

    const oldIds = new Set(before?.lines.map((l) => l.id));
    for (const l of v2?.lines ?? []) {
      expect(oldIds.has(l.id)).toBe(false);
      expect(l.quoteId).toBe(v2?.id);
    }

    expect(v2?.lines.map((l) => l.lineNumber)).toEqual(before?.lines.map((l) => l.lineNumber));
  });

  it('leaves v1 readable at its own prices', async () => {
    const { service, quote } = await sent();
    const before = await service.findWithLines(quote.id);

    await service.revise(quote.id);
    const after = await service.findWithLines(quote.id);

    expect(after?.status).toBe('superseded');
    expect(after?.lines.map((l) => l.pricePerRoll)).toEqual(
      before?.lines.map((l) => l.pricePerRoll),
    );
  });

  it('carries the customer and sales rep forward', async () => {
    const { service, quote } = await sent();
    const v2 = await service.revise(quote.id);

    expect(v2).toMatchObject({ customerId: CUSTOMER, salesRep: 'jsmith' });
  });

  it('takes a new note, or carries the old one', async () => {
    const { service } = await makeService();
    const a = await service.create({ customerId: CUSTOMER, notes: 'original' });
    await withLeadTime(service, a.id);
    await moveNow(service, a.id, 'quoted');
    expect((await service.revise(a.id))?.notes).toBe('original');

    const b = await service.create({ customerId: CUSTOMER, notes: 'original' });
    await withLeadTime(service, b.id);
    await moveNow(service, b.id, 'quoted');
    expect((await service.revise(b.id, { notes: 'revised per call' }))?.notes).toBe(
      'revised per call',
    );
  });

  it('refuses to revise anything that was not sent', async () => {
    const { service } = await makeService();
    const draft = await service.create({ customerId: CUSTOMER });

    await expect(service.revise(draft.id)).rejects.toThrow(QuoteNotRevisableError);

    await moveNow(service, draft.id, 'closed_lost');
    await expect(service.revise(draft.id)).rejects.toThrow(QuoteNotRevisableError);
  });

  it('refuses to revise an already-superseded version', async () => {
    const { service, quote } = await sent();
    await service.revise(quote.id);

    await expect(service.revise(quote.id)).rejects.toThrow(QuoteNotRevisableError);
  });

  it('returns null for an unknown quote', async () => {
    const { service } = await makeService();
    expect(await service.revise('quote-nobody')).toBeNull();
  });

  it('chains a third version onto the second', async () => {
    const { service, quote } = await sent();
    const v2 = await service.revise(quote.id);
    await withLeadTime(service, v2!.id);
    await moveNow(service, v2!.id, 'quoted');
    const v3 = await service.revise(v2!.id);

    expect(v3?.versionNumber).toBe(3);
    expect(v3?.rootQuoteId).toBe(quote.id);
    expect((await service.versions(v3!.id)).map((q) => q.versionNumber)).toEqual([1, 2, 3]);
  });

  it('leaves exactly one live version in a chain', async () => {
    const { service, quote } = await sent();
    const v2 = await service.revise(quote.id);
    await withLeadTime(service, v2!.id);
    await moveNow(service, v2!.id, 'quoted');
    await service.revise(v2!.id);

    const live = (await service.versions(quote.id)).filter((q) => q.status !== 'superseded');
    expect(live).toHaveLength(1);
    expect(live[0]?.versionNumber).toBe(3);
  });

  it('finds the whole chain from any version, not just the root', async () => {
    const { service, quote } = await sent();
    const v2 = await service.revise(quote.id);

    expect((await service.versions(v2!.id)).map((q) => q.versionNumber)).toEqual([1, 2]);
    expect((await service.versions(quote.id)).map((q) => q.versionNumber)).toEqual([1, 2]);
  });

  it('is empty for an unknown quote rather than throwing', async () => {
    const { service } = await makeService();
    expect(await service.versions('quote-nobody')).toEqual([]);
  });

  it('lets v2 be edited like any other draft', async () => {
    const { service, quote } = await sent();
    const v2 = await service.revise(quote.id);

    const edited = await saveLines(service, v2!.id, [line({ quantityRolls: 7 })]);
    expect(edited?.lines).toHaveLength(1);
    expect(edited?.lines[0]?.quantityRolls).toBe(7);
  });
});

describe('QuoteService — the margin floor', () => {
  async function belowFloorQuote() {
    const ctx = await makeService();
    const probe = await ctx.service.create({ customerId: CUSTOMER });
    const priced = await saveLines(ctx.service, probe.id, [line()]);
    const tierCode = priced?.lines[0]?.tier.code as string;

    await ctx.tiers.update(tierCode, { marginPct: '0.078000' }, new Date(), 'test:tier-edit');

    const quote = await ctx.service.create({ customerId: CUSTOMER });
    const saved = await saveLines(ctx.service, quote.id, [line()]);
    expect(saved?.lines[0]?.floor.status).toBe('below_floor');

    return { ...ctx, quote, tierCode };
  }

  it('refuses to send a draft carrying a below-floor line', async () => {
    const { service, quote } = await belowFloorQuote();

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);
  });

  it('reports a below-floor line BEFORE a missing lead time', async () => {
    const { service, quote } = await belowFloorQuote();

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);
  });

  it('names the line and what it would take to clear', async () => {
    const { service, quote } = await belowFloorQuote();

    try {
      await withLeadTime(service, quote.id);
      await moveNow(service, quote.id, 'quoted');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BelowFloorQuoteError);
      const typed = err as BelowFloorQuoteError;
      expect(typed.lines).toHaveLength(1);
      expect(typed.lines[0]?.lineNumber).toBe(1);
      expect(Number(typed.lines[0]?.minimumPricePerRoll)).toBeGreaterThan(0);
      expect(typed.message).toContain('override');
    }
  });

  it('leaves the quote in draft when it blocks', async () => {
    const { service, quote } = await belowFloorQuote();

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow();

    expect((await service.findById(quote.id))?.status).toBe('draft');
  });

  it('is not released by requesting approval — only by an Admin deciding', async () => {
    const { service, quote } = await belowFloorQuote();

    await moveNow(service, quote.id, 'override_requested');

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);
    expect((await service.findById(quote.id))?.status).toBe('override_requested');
  });

  it('blocks from every state, not just draft', async () => {
    const { service, quote } = await belowFloorQuote();

    for (const from of ['draft', 'override_requested'] as const) {
      const current = (await service.findById(quote.id))?.status;
      if (current !== from) {
        await moveNow(service, quote.id, from);
      }
      await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);
    }
  });

  it('clears when the Billing Manager lowers the floor and the line re-prices', async () => {
    const { service, quote, config } = await belowFloorQuote();

    await config.update({ marginFloorPct: '0.044000' }, new Date());

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);

    const repriced = await saveLines(service, quote.id, [line()]);
    expect(repriced?.lines[0]?.floor.status).toBe('ok');
    await withLeadTime(service, quote.id);
    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('does not block a quote whose lines all clear', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line(), line({ quantityRolls: 40 })]);

    await withLeadTime(service, quote.id);

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('does not block an empty quote', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    await withLeadTime(service, quote.id);

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('does not block the other moves out of draft', async () => {
    const { service, quote } = await belowFloorQuote();

    expect((await moveNow(service, quote.id, 'closed_lost'))?.status).toBe('closed_lost');
  });

  it('judges the stored verdict, not a fresh one', async () => {
    const { service, quote, tiers, tierCode } = await belowFloorQuote();

    await tiers.update(tierCode, { marginPct: '0.336000' }, new Date(), 'test:tier-edit');

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);
  });

  it('clears once the offending line is re-priced', async () => {
    const { service, quote, tiers, tierCode } = await belowFloorQuote();
    await tiers.update(tierCode, { marginPct: '0.336000' }, new Date(), 'test:tier-edit');

    const repriced = await saveLines(service, quote.id, [line()]);
    expect(repriced?.lines[0]?.floor.status).toBe('ok');

    await withLeadTime(service, quote.id);

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('reports only the lines that actually fail', async () => {
    const { service, quote } = await belowFloorQuote();

    await saveLines(service, quote.id, [line(), line({ quantityRolls: 40 })]);

    try {
      await withLeadTime(service, quote.id);
      await moveNow(service, quote.id, 'quoted');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as BelowFloorQuoteError).lines.map((l) => l.lineNumber)).toEqual([1, 2]);
    }
  });
});

describe('QuoteService.sendability', () => {
  it('says yes for a quote that clears', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    expect(await service.sendability(quote.id)).toEqual({ sendable: true });
  });

  it('says no and why, without throwing', async () => {
    const ctx = await makeService();
    const probe = await ctx.service.create({ customerId: CUSTOMER });
    const priced = await saveLines(ctx.service, probe.id, [line()]);
    await ctx.tiers.update(
      priced?.lines[0]?.tier.code as string,
      { marginPct: '0.078000' },
      new Date(),
      'test:tier-edit',
    );

    const quote = await ctx.service.create({ customerId: CUSTOMER });
    await saveLines(ctx.service, quote.id, [line()]);

    const verdict = await ctx.service.sendability(quote.id);
    expect(verdict).toMatchObject({ sendable: false });
    expect(verdict && 'belowFloor' in verdict ? verdict.belowFloor : []).toHaveLength(1);
  });

  it('agrees with what transition does', async () => {
    const ctx = await makeService();
    const probe = await ctx.service.create({ customerId: CUSTOMER });
    const priced = await saveLines(ctx.service, probe.id, [line()]);
    await ctx.tiers.update(
      priced?.lines[0]?.tier.code as string,
      { marginPct: '0.078000' },
      new Date(),
      'test:tier-edit',
    );

    const quote = await ctx.service.create({ customerId: CUSTOMER });
    await saveLines(ctx.service, quote.id, [line()]);

    const verdict = await ctx.service.sendability(quote.id);
    const blocked = await moveNow(ctx.service, quote.id, 'quoted')
      .then(() => null)
      .catch((e: unknown) => e as BelowFloorQuoteError);

    expect(verdict).toMatchObject({ sendable: false });
    expect(blocked?.lines.map((l) => l.lineNumber)).toEqual(
      verdict && 'belowFloor' in verdict ? verdict.belowFloor.map((l) => l.lineNumber) : [],
    );
  });

  it('returns null for an unknown quote', async () => {
    const { service } = await makeService();
    expect(await service.sendability('quote-nobody')).toBeNull();
  });
});

describe('QuoteService — a hand-set price', () => {
  it('stores the typed price, its source, and the tier answer', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line({ overridePricePerRoll: '87.0000' })]);
    const stored = saved?.lines[0];

    expect(stored?.pricePerRoll).toBe('87.0000');
    expect(stored?.priceSource).toBe('manual');
    expect(stored?.overridePricePerRoll).toBe('87.0000');

    expect(Number(stored?.basePricePerRoll)).toBeGreaterThan(0);
    expect(stored?.basePricePerRoll).not.toBe('87.0000');
  });

  it('marks engine-priced lines as tier, with no override stored', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line()]);

    expect(saved?.lines[0]?.priceSource).toBe('tier');
    expect(saved?.lines[0]).not.toHaveProperty('overridePricePerRoll');
  });

  it('cannot be used to get under the absolute floor', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    const saved = await saveLines(service, quote.id, [line({ overridePricePerRoll: '0.0900' })]);

    expect(saved?.lines[0]?.floor.status).toBe('below_floor');
    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);
  });

  it('sends once approved, when the typed price clears the floor', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '87.0000' })]);
    await decideNow(service, quote.id, 'approve');

    await withLeadTime(service, quote.id);

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('carries a hand-set price forward through a revision', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '87.0000' })]);
    await decideNow(service, quote.id, 'approve');
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    const v2 = await service.revise(quote.id);

    expect(v2?.lines[0]?.priceSource).toBe('manual');
    expect(v2?.lines[0]?.overridePricePerRoll).toBe('87.0000');
    expect(v2?.lines[0]?.pricePerRoll).toBe('87.0000');
  });
});

describe('QuoteService — a hand-set price at the customer agreed price', () => {
  function agreedLookup(agreed: AgreedPriceTerms | undefined) {
    const asked: string[] = [];
    const lookup: CustomerLookup = {
      ...customers,
      agreedPrice: async (customerId, gradeId, rollWidthIn) => {
        asked.push(`${gradeId}|${String(rollWidthIn)}`);
        return customerId === CUSTOMER && gradeId === GRADE && rollWidthIn === 24
          ? agreed
          : undefined;
      },
    };
    return { lookup, asked };
  }

  const perPound = (over: Record<string, unknown> = {}) =>
    line({ pricingBasis: 'per_pound', orderedWeightLb: '1000.0000', ...over });

  it('stores a per-pound line at the agreed price as agreed, and it sends with no approval', async () => {
    const { lookup } = agreedLookup({ basis: 'per_pound', price: '1.0700' });
    const { service } = await makeService(makeClock(), lookup);
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [perPound({ overridePricePerLb: '1.07' })]);

    expect(saved?.lines[0]?.priceSource).toBe('agreed');
    expect(saved?.lines[0]?.overridePricePerLb).toBe('1.07');
    expect(saved?.lines[0]?.floor.status).toBe('ok');

    await withLeadTime(service, quote.id);
    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('stores a per-roll line at a per-roll agreed price as agreed', async () => {
    const { lookup } = agreedLookup({ basis: 'per_roll', price: '87.0000' });
    const { service } = await makeService(makeClock(), lookup);
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line({ overridePricePerRoll: '87' })]);

    expect(saved?.lines[0]?.priceSource).toBe('agreed');
    expect(saved?.lines[0]?.pricePerRoll).toBe('87.0000');
    await expect(decideNow(service, quote.id, 'approve')).rejects.toThrow(NothingToApproveError);
  });

  it('keeps a figure one step off the agreed price manual, in either direction', async () => {
    const { lookup } = agreedLookup({ basis: 'per_pound', price: '1.0700' });
    const { service } = await makeService(makeClock(), lookup);
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [
      perPound({ overridePricePerLb: '1.0701' }),
      perPound({ overridePricePerLb: '1.0699' }),
    ]);

    expect(saved?.lines.map((l) => l.priceSource)).toEqual(['manual', 'manual']);
    await withLeadTime(service, quote.id);
    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(OverrideNotApprovedError);
  });

  it('gives nothing to a line in the other basis, another width, or with no agreed price', async () => {
    const poundAgreed = agreedLookup({ basis: 'per_pound', price: '87.0000' });
    const { service } = await makeService(makeClock(), poundAgreed.lookup);
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [
      line({ overridePricePerRoll: '87.0000' }),

      perPound({ rollWidthIn: 36, overridePricePerLb: '87.0000' }),
    ]);
    expect(saved?.lines.map((l) => l.priceSource)).toEqual(['manual', 'manual']);

    const none = await makeService(makeClock(), agreedLookup(undefined).lookup);
    const other = await none.service.create({ customerId: CUSTOMER });
    const plain = await saveLines(none.service, other.id, [
      perPound({ overridePricePerLb: '1.0700' }),
    ]);
    expect(plain?.lines[0]?.priceSource).toBe('manual');
  });

  it('owes approval for the other hand-set line only', async () => {
    const { lookup } = agreedLookup({ basis: 'per_pound', price: '1.0700' });
    const { service } = await makeService(makeClock(), lookup);
    const quote = await service.create({ customerId: CUSTOMER });

    await saveLines(service, quote.id, [
      perPound({ overridePricePerLb: '1.0700' }),
      perPound({ overridePricePerLb: '1.1850' }),
    ]);
    await withLeadTime(service, quote.id);

    const refused = moveNow(service, quote.id, 'quoted');
    await expect(refused).rejects.toThrow(OverrideNotApprovedError);
    await expect(refused).rejects.toMatchObject({ lines: [2] });

    await moveNow(service, quote.id, 'override_requested');
    const requested = (await service.overrideDecisions(quote.id)).filter(
      (d) => d.decision === 'requested',
    );
    expect(requested.map((d) => d.kind)).toEqual(['price']);
    await decideNow(service, quote.id, 'approve');
    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('keeps the floor: an agreed price under it is below_floor and waits on an Admin', async () => {
    const { lookup } = agreedLookup({ basis: 'per_roll', price: '0.0900' });
    const { service } = await makeService(makeClock(), lookup);
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line({ overridePricePerRoll: '0.0900' })]);

    expect(saved?.lines[0]?.priceSource).toBe('agreed');
    expect(saved?.lines[0]?.floor.status).toBe('below_floor');
    await withLeadTime(service, quote.id);
    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);

    await moveNow(service, quote.id, 'override_requested');
    const requested = (await service.overrideDecisions(quote.id)).filter(
      (d) => d.decision === 'requested',
    );
    expect(requested.map((d) => d.kind)).toEqual(['floor']);

    await decideFloorNow(service, quote.id, 'approve');
    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('asks crm once per paper and width, and only for a line with a typed price', async () => {
    const { lookup, asked } = agreedLookup({ basis: 'per_pound', price: '1.0700' });
    const { service } = await makeService(makeClock(), lookup);
    const quote = await service.create({ customerId: CUSTOMER });

    await saveLines(service, quote.id, [
      perPound({ overridePricePerLb: '1.0700' }),
      perPound({ overridePricePerLb: '1.1850' }),
      perPound({ rollWidthIn: 36, overridePricePerLb: '1.0700' }),

      perPound({ rollWidthIn: 12 }),
    ]);

    expect(asked).toEqual([`${GRADE}|24`, `${GRADE}|36`]);
  });

  it('judges a stored line again only when the lines are next saved', async () => {
    const state: { agreed: AgreedPriceTerms | undefined } = {
      agreed: { basis: 'per_pound', price: '1.0700' },
    };
    const lookup: CustomerLookup = { ...customers, agreedPrice: async () => state.agreed };
    const { service } = await makeService(makeClock(), lookup);
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [perPound({ overridePricePerLb: '1.0700' })]);

    state.agreed = { basis: 'per_pound', price: '1.0250' };
    expect((await service.findWithLines(quote.id))?.lines[0]?.priceSource).toBe('agreed');

    const resaved = await saveLines(service, quote.id, [
      perPound({ overridePricePerLb: '1.0700' }),
    ]);
    expect(resaved?.lines[0]?.priceSource).toBe('manual');
  });
});

describe('QuoteService — a margin entered manually', () => {
  it('stores the margin, its price, the tier volume chose, and the source', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line({ marginOverridePct: '0.437000' })]);
    const stored = saved?.lines[0];

    expect(stored?.priceSource).toBe('margin');
    expect(stored?.marginOverridePct).toBe('0.437000');
    expect(stored?.marginPct).toBe('0.437000');
    expect(stored?.marginPricePerRoll).toBe(stored?.pricePerRoll);

    expect(stored?.tier.source).toBe('auto');
    expect(stored).not.toHaveProperty('tierOverrideCode');
    expect(stored?.basePricePerRoll).not.toBe(stored?.pricePerRoll);
  });

  it('refuses one under the floor when the line is saved, naming the floor', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    const refused = saveLines(service, quote.id, [line(), line({ marginOverridePct: '0.064000' })]);

    await expect(refused).rejects.toThrow(LineEnteredMarginBelowFloorError);
    await expect(refused).rejects.toMatchObject({
      lineNumber: 2,
      marginOverridePct: '0.064000',
      floorPct: '0.120000',
      message: expect.stringContaining('is under the 12% margin floor'),
    });

    expect((await service.findWithLines(quote.id))?.lines).toHaveLength(1);
  });

  it('saves one at exactly the floor', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [line({ marginOverridePct: '0.120000' })]);

    expect(saved?.lines[0]?.floor.status).toBe('ok');
  });

  it('sends with no approval asked, like a forced tier', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ marginOverridePct: '0.437000' })]);
    await withLeadTime(service, quote.id);

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('gives the Billing Manager nothing to approve', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ marginOverridePct: '0.437000' })]);

    await expect(decideNow(service, quote.id, 'approve')).rejects.toThrow(NothingToApproveError);
  });

  it('carries the margin forward through a revision', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    const saved = await saveLines(service, quote.id, [line({ marginOverridePct: '0.437000' })]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    const v2 = await service.revise(quote.id);

    expect(v2?.lines[0]?.priceSource).toBe('margin');
    expect(v2?.lines[0]?.marginOverridePct).toBe('0.437000');
    expect(v2?.lines[0]?.marginPricePerRoll).toBe(saved?.lines[0]?.marginPricePerRoll);
    expect(v2?.lines[0]?.pricePerRoll).toBe(saved?.lines[0]?.pricePerRoll);
  });

  it('refuses it beside a hand-set price, naming the row', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const refused = saveLines(service, quote.id, [
      line(),
      line({ marginOverridePct: '0.437000', overridePricePerRoll: '87.0000' }),
    ]);

    await expect(refused).rejects.toThrow(LineEnteredMarginHandSetPriceError);
    await expect(refused).rejects.toMatchObject({ lineNumber: 2 });
  });

  it('refuses it beside a forced tier, naming the row', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const refused = saveLines(service, quote.id, [
      line({ marginOverridePct: '0.437000', tierOverrideCode: 'volume_5' }),
    ]);

    await expect(refused).rejects.toThrow(LineEnteredMarginTierOverrideError);
    await expect(refused).rejects.toMatchObject({ lineNumber: 1 });
  });
});

describe('QuoteService — override approval', () => {
  async function withOverride() {
    const ctx = await makeService();
    const quote = await ctx.service.create({ customerId: CUSTOMER });
    const saved = await saveLines(ctx.service, quote.id, [
      line({ overridePricePerRoll: '87.0000' }),
    ]);
    expect(saved?.lines[0]?.priceSource).toBe('manual');
    return { ...ctx, quote };
  }

  it('refuses to send a hand-set price without approval', async () => {
    const { service, quote } = await withOverride();

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(OverrideNotApprovedError);
  });

  it('names the lines that need approving', async () => {
    const { service, quote } = await withOverride();

    try {
      await withLeadTime(service, quote.id);
      await moveNow(service, quote.id, 'quoted');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as OverrideNotApprovedError).lines).toEqual([1]);
    }
  });

  it('holds a hand-set price per POUND at the same gate', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    const saved = await saveLines(service, quote.id, [
      line({
        pricingBasis: 'per_pound',
        orderedWeightLb: '1000.0000',
        overridePricePerLb: '1.0700',
      }),
    ]);

    expect(saved?.lines[0]?.priceSource).toBe('manual');
    expect(saved?.lines[0]?.overridePricePerLb).toBe('1.0700');

    expect(saved?.lines[0]?.pricePerRoll).toBe('37.4500');

    try {
      await moveNow(service, quote.id, 'quoted');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OverrideNotApprovedError);
      expect((err as OverrideNotApprovedError).lines).toEqual([1]);
    }

    await decideNow(service, quote.id, 'approve');
    await withLeadTime(service, quote.id);
    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('sends once the Billing Manager approves', async () => {
    const { service, quote } = await withOverride();

    const approved = await decideNow(service, quote.id, 'approve');
    expect(approved?.overrideApprovedBy).toBe('bmanager');

    await withLeadTime(service, quote.id);

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('takes the quote out of the approval queue once it is approved', async () => {
    const { service, quote } = await withOverride();
    await moveNow(service, quote.id, 'override_requested');

    const approved = await decideNow(service, quote.id, 'approve');

    expect(approved?.status).toBe('draft');

    expect(approved?.overrideApprovedBy).toBe('bmanager');
    const queue = await service.list({ status: 'override_requested' });
    expect(queue.map((q) => q.id)).not.toContain(quote.id);
  });

  it('refuses a second approval of an approval that already stands', async () => {
    const { service, quote } = await withOverride();
    await moveNow(service, quote.id, 'override_requested');
    await decideNow(service, quote.id, 'approve');

    await expect(decideNow(service, quote.id, 'approve')).rejects.toThrow(
      OverrideAlreadyApprovedError,
    );

    expect((await service.overrideDecisions(quote.id)).map((d) => d.decision)).toEqual([
      'requested',
      'approved',
    ]);
  });

  it('refuses a rejection of an approval that already stands', async () => {
    const { service, quote } = await withOverride();
    await moveNow(service, quote.id, 'override_requested');
    await decideNow(service, quote.id, 'approve');

    await expect(
      decideNow(service, quote.id, 'reject', { reason: 'changed my mind' }),
    ).rejects.toThrow(OverrideAlreadyApprovedError);
    expect((await service.findById(quote.id))?.overrideApprovedBy).toBe('bmanager');
    expect((await service.overrideDecisions(quote.id)).map((d) => d.decision)).toEqual([
      'requested',
      'approved',
    ]);
  });

  it('records who approved, when, and why', async () => {
    const { service, quote } = await withOverride();
    await decideNow(service, quote.id, 'approve', { reason: 'match a competitor' });

    const log = await service.overrideDecisions(quote.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      decision: 'approved',
      kind: 'price',
      actor: 'bmanager',
      reason: 'match a competitor',
    });
  });

  it('revokes the approval when the quote is edited afterwards', async () => {
    const { service, quote } = await withOverride();
    await decideNow(service, quote.id, 'approve');

    await saveLines(service, quote.id, [line({ overridePricePerRoll: '73.2500' })]);

    expect((await service.findById(quote.id))?.overrideApprovedBy).toBeUndefined();
    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(OverrideNotApprovedError);
  });

  it('logs the revocation rather than dropping it silently', async () => {
    const { service, quote } = await withOverride();
    await decideNow(service, quote.id, 'approve');
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '73.2500' })]);

    const log = await service.overrideDecisions(quote.id);
    expect(log.map((d) => d.decision)).toEqual(['approved', 'revoked']);
    expect(log[1]?.reason).toContain('changed after approval');

    expect(log.map((d) => d.kind)).toEqual(['price', 'price']);
  });

  it('takes a second approval after a revocation', async () => {
    const { service, quote } = await withOverride();
    await decideNow(service, quote.id, 'approve');
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '73.2500' })]);

    await decideNow(service, quote.id, 'approve', { reason: 'still fine' });

    await withLeadTime(service, quote.id);

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
    expect((await service.overrideDecisions(quote.id)).map((d) => d.decision)).toEqual([
      'approved',
      'revoked',
      'approved',
    ]);
  });

  it('does not revoke anything when there was no approval', async () => {
    const { service, quote } = await withOverride();
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '73.2500' })]);

    expect(await service.overrideDecisions(quote.id)).toEqual([]);
  });

  it('rejects with a reason and returns to draft', async () => {
    const { service, quote } = await withOverride();
    await moveNow(service, quote.id, 'override_requested');

    const rejected = await decideNow(service, quote.id, 'reject', {
      reason: 'too thin for this account',
    });

    expect(rejected?.status).toBe('draft');
    expect(rejected?.overrideApprovedBy).toBeUndefined();
    const log = await service.overrideDecisions(quote.id);
    expect(log[log.length - 1]).toMatchObject({
      decision: 'rejected',
      reason: 'too thin for this account',
    });
  });

  it('refuses to approve a quote with nothing hand-set', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    await expect(decideNow(service, quote.id, 'approve')).rejects.toThrow(NothingToApproveError);
  });

  it('leaves engine-priced quotes alone entirely', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    await withLeadTime(service, quote.id);

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('does not let approval rescue a below-floor quote', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '0.0900' })]);

    await decideNow(service, quote.id, 'approve');

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);
  });

  it('does not carry an approval onto a revision', async () => {
    const { service, quote } = await withOverride();
    await decideNow(service, quote.id, 'approve');
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    const v2 = await service.revise(quote.id);

    expect(v2?.overrideApprovedBy).toBeUndefined();
    await expect(moveNow(service, v2!.id, 'quoted')).rejects.toThrow(OverrideNotApprovedError);
  });

  it('returns null for an unknown quote', async () => {
    const { service } = await makeService();
    expect(await decideNow(service, 'quote-nobody', 'approve')).toBeNull();
    expect(await decideNow(service, 'quote-nobody', 'reject', { reason: 'x' })).toBeNull();
  });

  describe('printableQuote', () => {
    it('returns the quote once it has been sent', async () => {
      const { service } = await makeService();
      const quote = await service.create({ customerId: CUSTOMER });
      await saveLines(service, quote.id, [line()]);
      await withLeadTime(service, quote.id);
      await moveNow(service, quote.id, 'quoted');

      const printable = await service.printableQuote(quote.id);

      expect(printable?.id).toBe(quote.id);
      expect(printable?.status).toBe('quoted');
    });

    it('refuses a draft', async () => {
      const { service } = await makeService();
      const quote = await service.create({ customerId: CUSTOMER });
      await saveLines(service, quote.id, [line()]);

      await expect(service.printableQuote(quote.id)).rejects.toThrow(QuoteNotPrintableError);
    });

    it('names the status it refused, so the reason is actionable', async () => {
      const { service } = await makeService();
      const quote = await service.create({ customerId: CUSTOMER });

      try {
        await service.printableQuote(quote.id);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(QuoteNotPrintableError);
        expect((err as QuoteNotPrintableError).status).toBe('draft');
      }
    });

    it('prints a superseded quote, at the figures it was quoted at', async () => {
      const { service } = await makeService();
      const quote = await service.create({ customerId: CUSTOMER });
      await saveLines(service, quote.id, [line()]);
      await withLeadTime(service, quote.id);
      await moveNow(service, quote.id, 'quoted');
      await service.revise(quote.id);

      const printable = await service.printableQuote(quote.id);

      expect(printable?.status).toBe('superseded');
      expect(printable?.versionNumber).toBe(1);
    });

    it('refuses a below-floor line on an already-sent quote', async () => {
      const { service, quotes, tiers } = await makeService();

      const probe = await service.create({ customerId: CUSTOMER });
      const priced = await saveLines(service, probe.id, [line()]);
      const tierCode = priced?.lines[0]?.tier.code as string;
      await tiers.update(tierCode, { marginPct: '0.078000' }, new Date(), 'test:tier-edit');

      const quote = await service.create({ customerId: CUSTOMER });
      const saved = await saveLines(service, quote.id, [line()]);
      expect(saved?.lines[0]?.floor.status).toBe('below_floor');

      await quotes.transition(quote.id, 'quoted', new Date());

      await expect(service.printableQuote(quote.id)).rejects.toThrow(BelowFloorQuoteError);
    });

    it('returns null for an unknown id rather than throwing', async () => {
      const { service } = await makeService();
      expect(await service.printableQuote('quote-nobody')).toBeNull();
    });
  });
});

describe('QuoteService — an Admin overrides the floor', () => {
  async function belowFloorQuote() {
    const ctx = await makeService();
    const probe = await ctx.service.create({ customerId: CUSTOMER });
    const priced = await saveLines(ctx.service, probe.id, [line()]);

    await ctx.tiers.update(
      priced?.lines[0]?.tier.code as string,
      { marginPct: '0.078000' },
      new Date(),
      'test:tier-edit',
    );
    const quote = await ctx.service.create({ customerId: CUSTOMER });
    const saved = await saveLines(ctx.service, quote.id, [line()]);
    expect(saved?.lines[0]?.floor.status).toBe('below_floor');
    expect(saved?.lines[0]?.priceSource).toBe('tier');
    return { ...ctx, quote };
  }

  async function owesBoth() {
    const ctx = await makeService();
    const quote = await ctx.service.create({ customerId: CUSTOMER });
    const saved = await saveLines(ctx.service, quote.id, [
      line({ overridePricePerRoll: '0.0900' }),
    ]);
    expect(saved?.lines[0]?.priceSource).toBe('manual');
    expect(saved?.lines[0]?.floor.status).toBe('below_floor');
    return { ...ctx, quote };
  }

  it('refuses a below-floor quote at send without the override and sends it with one', async () => {
    const { service, quote } = await belowFloorQuote();
    await withLeadTime(service, quote.id);

    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);

    const overridden = await decideFloorNow(service, quote.id, 'approve');
    expect(overridden?.floorOverrideBy).toBe('dev-admin');
    expect(overridden?.floorOverrideAt).toBeDefined();

    expect((await service.findWithLines(quote.id))?.lines[0]?.floor.status).toBe('below_floor');

    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('records an approval and a rejection with their reasons, kind floor', async () => {
    const { service, quote } = await belowFloorQuote();
    await moveNow(service, quote.id, 'override_requested');
    await decideFloorNow(service, quote.id, 'reject', { reason: 'too thin for this account' });
    await moveNow(service, quote.id, 'override_requested');
    await decideFloorNow(service, quote.id, 'approve', { reason: 'strategic account' });

    const decided = (await service.overrideDecisions(quote.id)).filter(
      (d) => d.decision !== 'requested',
    );
    expect(decided).toEqual([
      expect.objectContaining({
        decision: 'rejected',
        kind: 'floor',
        actor: 'dev-admin',
        reason: 'too thin for this account',
      }),
      expect.objectContaining({
        decision: 'approved',
        kind: 'floor',
        actor: 'dev-admin',
        reason: 'strategic account',
      }),
    ]);
  });

  it('refuses a second approval of an override that already stands', async () => {
    const { service, quote } = await belowFloorQuote();
    await decideFloorNow(service, quote.id, 'approve');

    await expect(decideFloorNow(service, quote.id, 'approve')).rejects.toThrow(
      FloorOverrideAlreadyApprovedError,
    );
    await expect(decideFloorNow(service, quote.id, 'approve')).rejects.toMatchObject({
      overriddenBy: 'dev-admin',
    });
  });

  it('refuses a rejection after the override was approved', async () => {
    const { service, quote } = await belowFloorQuote();
    await decideFloorNow(service, quote.id, 'approve');

    await expect(decideFloorNow(service, quote.id, 'reject')).rejects.toThrow(
      FloorOverrideAlreadyApprovedError,
    );
    expect((await service.findById(quote.id))?.floorOverrideBy).toBe('dev-admin');
  });

  it('refuses to approve a quote with no line below the floor', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    await expect(decideFloorNow(service, quote.id, 'approve')).rejects.toThrow(
      NothingBelowFloorError,
    );
    expect(await service.overrideDecisions(quote.id)).toEqual([]);
  });

  it('is revoked by an edit, which logs it as revoked kind floor', async () => {
    const { service, quote } = await belowFloorQuote();
    await decideFloorNow(service, quote.id, 'approve');

    await saveLines(service, quote.id, [line()]);

    expect((await service.findById(quote.id))?.floorOverrideBy).toBeUndefined();
    expect((await service.findById(quote.id))?.floorOverrideAt).toBeUndefined();
    const log = await service.overrideDecisions(quote.id);
    expect(log[log.length - 1]).toMatchObject({
      decision: 'revoked',
      kind: 'floor',
      actor: 'system:edit',
      reason: 'quote lines were changed after the floor was overridden',
    });
    await withLeadTime(service, quote.id);
    await expect(moveNow(service, quote.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);
  });

  it('revokes both live pairs on one edit, each under its own kind', async () => {
    const { service, quote } = await owesBoth();
    await decideNow(service, quote.id, 'approve');
    await decideFloorNow(service, quote.id, 'approve');

    await saveLines(service, quote.id, [line({ overridePricePerRoll: '0.1100' })]);

    const after = await service.findById(quote.id);
    expect(after?.overrideApprovedBy).toBeUndefined();
    expect(after?.floorOverrideBy).toBeUndefined();
    const revoked = (await service.overrideDecisions(quote.id)).filter(
      (d) => d.decision === 'revoked',
    );
    expect(revoked.map((d) => d.kind).sort()).toEqual(['floor', 'price']);
  });

  it('is not inherited by a revision, and neither is the price approval', async () => {
    const { service, quote } = await owesBoth();
    await decideNow(service, quote.id, 'approve');
    await decideFloorNow(service, quote.id, 'approve');
    await withLeadTime(service, quote.id);
    expect((await moveNow(service, quote.id, 'quoted'))?.status).toBe('quoted');

    const v2 = await service.revise(quote.id);

    expect(v2?.overrideApprovedBy).toBeUndefined();
    expect(v2?.floorOverrideBy).toBeUndefined();
    expect(v2?.floorOverrideAt).toBeUndefined();
    await expect(moveNow(service, v2!.id, 'quoted')).rejects.toThrow(BelowFloorQuoteError);

    expect((await service.findById(quote.id))?.floorOverrideBy).toBe('dev-admin');
  });

  it('needs both when the quote owes both: neither decision releases the other', async () => {
    const floorOnly = await owesBoth();
    await withLeadTime(floorOnly.service, floorOnly.quote.id);
    await decideFloorNow(floorOnly.service, floorOnly.quote.id, 'approve');
    await expect(moveNow(floorOnly.service, floorOnly.quote.id, 'quoted')).rejects.toThrow(
      OverrideNotApprovedError,
    );

    const priceOnly = await owesBoth();
    await withLeadTime(priceOnly.service, priceOnly.quote.id);
    await decideNow(priceOnly.service, priceOnly.quote.id, 'approve');
    await expect(moveNow(priceOnly.service, priceOnly.quote.id, 'quoted')).rejects.toThrow(
      BelowFloorQuoteError,
    );

    await decideFloorNow(priceOnly.service, priceOnly.quote.id, 'approve');
    expect((await moveNow(priceOnly.service, priceOnly.quote.id, 'quoted'))?.status).toBe('quoted');
  });

  it('keeps the quote in the queue after the floor approval until the price is decided (Q1)', async () => {
    const { service, quote } = await owesBoth();
    await moveNow(service, quote.id, 'override_requested');

    const floorDone = await decideFloorNow(service, quote.id, 'approve');
    expect(floorDone?.status).toBe('override_requested');

    const priceDone = await decideNow(service, quote.id, 'approve');
    expect(priceDone?.status).toBe('draft');
  });

  it('keeps the quote in the queue after the price approval until the floor is decided (Q1)', async () => {
    const { service, quote } = await owesBoth();
    await moveNow(service, quote.id, 'override_requested');

    const priceDone = await decideNow(service, quote.id, 'approve');
    expect(priceDone?.status).toBe('override_requested');
    expect(priceDone?.overrideApprovedBy).toBe('bmanager');

    const floorDone = await decideFloorNow(service, quote.id, 'approve');
    expect(floorDone?.status).toBe('draft');
  });

  it('returns the quote to draft on a rejection even with the other decision open (Q1)', async () => {
    const { service, quote } = await owesBoth();
    await moveNow(service, quote.id, 'override_requested');

    const rejected = await decideFloorNow(service, quote.id, 'reject');

    expect(rejected?.status).toBe('draft');
    expect(rejected?.floorOverrideBy).toBeUndefined();
  });

  it('serves the Admin acting from a draft: approved, and the quote stays a draft', async () => {
    const { service, quote } = await belowFloorQuote();

    const overridden = await decideFloorNow(service, quote.id, 'approve');

    expect(overridden?.status).toBe('draft');
    expect(overridden?.floorOverrideBy).toBe('dev-admin');
  });

  it('is honoured by printableQuote and sendability, so screen, PDF and send agree', async () => {
    const { service, quote } = await belowFloorQuote();
    await withLeadTime(service, quote.id);
    expect(await service.sendability(quote.id)).toMatchObject({ sendable: false });

    await decideFloorNow(service, quote.id, 'approve');
    expect(await service.sendability(quote.id)).toEqual({ sendable: true });

    await moveNow(service, quote.id, 'quoted');
    expect((await service.printableQuote(quote.id))?.id).toBe(quote.id);
  });

  it('does not let a margin entered manually under the floor be saved', async () => {
    const { service, quote } = await belowFloorQuote();
    await decideFloorNow(service, quote.id, 'approve');

    const refused = saveLines(service, quote.id, [line({ marginOverridePct: '0.064000' })]);

    await expect(refused).rejects.toThrow(LineEnteredMarginBelowFloorError);

    expect((await service.findById(quote.id))?.floorOverrideBy).toBe('dev-admin');
  });

  it('returns null for an unknown quote', async () => {
    const { service } = await makeService();
    expect(await decideFloorNow(service, 'quote-nobody', 'approve')).toBeNull();
    expect(await decideFloorNow(service, 'quote-nobody', 'reject')).toBeNull();
  });
});

describe('QuoteService.transition — the request is logged', () => {
  it('logs one requested row when one control is owed', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '87.0000' })]);

    const moved = await moveNow(service, quote.id, 'override_requested');

    expect(moved?.status).toBe('override_requested');
    expect(await service.overrideDecisions(quote.id)).toEqual([
      expect.objectContaining({
        decision: 'requested',
        kind: 'price',
        actor: SALES_REP,
        at: '2026-08-07T09:00:00.000Z',
      }),
    ]);
  });

  it('logs both kinds when the quote owes both', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '0.0900' })]);

    await moveNow(service, quote.id, 'override_requested');

    const log = await service.overrideDecisions(quote.id);
    expect(log.every((d) => d.decision === 'requested' && d.actor === SALES_REP)).toBe(true);
    expect(log.map((d) => d.kind).sort()).toEqual(['floor', 'price']);

    const after = await service.findById(quote.id);
    expect(after?.overrideApprovedBy).toBeUndefined();
    expect(after?.floorOverrideBy).toBeUndefined();
  });

  it('writes new rows for a second request after a rejection', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '87.0000' })]);
    await moveNow(service, quote.id, 'override_requested');
    await decideNow(service, quote.id, 'reject', { reason: 'price it at tier' });

    await moveNow(service, quote.id, 'override_requested', 'dev-sales-2');

    const log = await service.overrideDecisions(quote.id);
    expect(log.map((d) => `${d.decision}:${d.kind}:${d.actor}`)).toEqual([
      `requested:price:${SALES_REP}`,
      'rejected:price:bmanager',
      'requested:price:dev-sales-2',
    ]);
    expect(new Set(log.map((d) => d.id)).size).toBe(3);
  });

  it('writes no row when nothing is owed, and still moves', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    expect((await moveNow(service, quote.id, 'override_requested'))?.status).toBe(
      'override_requested',
    );
    expect(await service.overrideDecisions(quote.id)).toEqual([]);
  });

  it('writes neither the move nor the rows on a stale token', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '87.0000' })]);
    const stale = (await service.findById(quote.id))!.lockVersion;
    await saveLines(service, quote.id, [line({ overridePricePerRoll: '86.0000' })]);

    await expect(
      service.transition(quote.id, 'override_requested', stale, SALES_REP),
    ).rejects.toThrow(StaleAggregateError);

    expect((await service.findById(quote.id))?.status).toBe('draft');
    expect(await service.overrideDecisions(quote.id)).toEqual([]);
  });
});

describe('QuoteService.sendPrecheck', () => {
  const TO = ['buyer@example.com'];

  const sentQuote = async (service: Awaited<ReturnType<typeof makeService>>['service']) => {
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');
    const current = await service.findById(quote.id);
    return { id: quote.id, lockVersion: current!.lockVersion };
  };

  const submission = (over: Partial<Parameters<QuoteService['recordSend']>[1]> = {}) => ({
    messageId: '<msg-1@erp.org.example.test>',
    actor: 'demo-contributor',
    acceptedByRelayAt: new Date('2026-08-17T09:00:00.000Z'),
    ...over,
  });

  it('passes a quoted quote with a recipient', async () => {
    const { service } = await makeService();
    const { id, lockVersion } = await sentQuote(service);

    const quote = await service.sendPrecheck(id, { lockVersion, confirmRedistribute: false }, TO);

    expect(quote?.id).toBe(id);
  });

  it('returns null for an unknown id rather than throwing', async () => {
    const { service } = await makeService();
    expect(
      await service.sendPrecheck(
        'quote-nobody',
        { lockVersion: 1, confirmRedistribute: false },
        TO,
      ),
    ).toBeNull();
  });

  it('asks a draft the transition_s own question', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    const current = await service.findById(quote.id);

    await expect(
      service.sendPrecheck(
        quote.id,
        { lockVersion: current!.lockVersion, confirmRedistribute: false },
        TO,
      ),
    ).rejects.toThrow(QuoteNeedsLeadTimeError);

    await withLeadTime(service, quote.id);
    const ready = await service.findById(quote.id);
    await expect(
      service.sendPrecheck(
        quote.id,
        { lockVersion: ready!.lockVersion, confirmRedistribute: false },
        TO,
      ),
    ).resolves.not.toBeNull();
  });

  it('still refuses a status that can neither move to quoted nor print', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await moveNow(service, quote.id, 'closed_lost');
    const current = await service.findById(quote.id);

    await expect(
      service.sendPrecheck(
        quote.id,
        { lockVersion: current!.lockVersion, confirmRedistribute: false },
        TO,
      ),
    ).rejects.toThrow(QuoteNotPrintableError);
  });

  it('refuses figures the caller never read', async () => {
    const { service } = await makeService();
    const { id, lockVersion } = await sentQuote(service);

    await expect(
      service.sendPrecheck(id, { lockVersion: lockVersion + 1, confirmRedistribute: false }, TO),
    ).rejects.toThrow(StaleAggregateError);
  });

  it('refuses a customer with nowhere to send', async () => {
    const { service } = await makeService();
    const { id, lockVersion } = await sentQuote(service);

    await expect(
      service.sendPrecheck(id, { lockVersion, confirmRedistribute: false }, []),
    ).rejects.toThrow(QuoteHasNoRecipientsError);
  });

  it('lets the first send through without confirmation', async () => {
    const { service } = await makeService();
    const { id, lockVersion } = await sentQuote(service);

    await expect(
      service.sendPrecheck(id, { lockVersion, confirmRedistribute: false }, TO),
    ).resolves.not.toBeNull();
  });

  it('refuses a second send that was not confirmed', async () => {
    const { service } = await makeService();
    const { id, lockVersion } = await sentQuote(service);
    await service.recordSend(id, submission());

    await expect(
      service.sendPrecheck(id, { lockVersion, confirmRedistribute: false }, TO),
    ).rejects.toThrow(QuoteRedistributionNotConfirmedError);
  });

  it('allows the second send once confirmed', async () => {
    const { service } = await makeService();
    const { id, lockVersion } = await sentQuote(service);
    await service.recordSend(id, submission());

    await expect(
      service.sendPrecheck(id, { lockVersion, confirmRedistribute: true }, TO),
    ).resolves.not.toBeNull();
  });

  it('carries the prior sends on the refusal, so the prompt can be specific', async () => {
    const { service } = await makeService();
    const { id, lockVersion } = await sentQuote(service);
    await service.recordSend(id, submission());

    try {
      await service.sendPrecheck(id, { lockVersion, confirmRedistribute: false }, TO);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QuoteRedistributionNotConfirmedError);
      const sends = (err as QuoteRedistributionNotConfirmedError).priorSends;
      expect(sends).toHaveLength(1);
      expect(sends[0]?.acceptedByRelayAt).toBe('2026-08-17T09:00:00.000Z');
    }
  });

  it('refuses an unconfirmed send of a revision when an earlier version went out', async () => {
    const { service } = await makeService();
    const { id } = await sentQuote(service);
    await service.recordSend(id, submission());

    const v2 = await service.revise(id);
    await withLeadTime(service, v2!.id);
    await moveNow(service, v2!.id, 'quoted');
    const current = await service.findById(v2!.id);

    await expect(
      service.sendPrecheck(
        v2!.id,
        { lockVersion: current!.lockVersion, confirmRedistribute: false },
        TO,
      ),
    ).rejects.toThrow(QuoteRedistributionNotConfirmedError);
  });

  it('asks a revision still in draft to confirm redistribution before it moves', async () => {
    const { service } = await makeService();
    const { id } = await sentQuote(service);
    await service.recordSend(id, submission());

    const v2 = await service.revise(id);
    await withLeadTime(service, v2!.id);
    const current = await service.findById(v2!.id);
    const request = { lockVersion: current!.lockVersion, confirmRedistribute: false };

    await expect(service.sendPrecheck(v2!.id, request, TO)).rejects.toThrow(
      QuoteRedistributionNotConfirmedError,
    );
    await expect(
      service.sendPrecheck(v2!.id, { ...request, confirmRedistribute: true }, TO),
    ).resolves.not.toBeNull();
  });

  it('does not let one customer_s send gate another quote', async () => {
    const { service } = await makeService();
    const sent = await sentQuote(service);
    await service.recordSend(sent.id, submission());
    const other = await sentQuote(service);

    await expect(
      service.sendPrecheck(
        other.id,
        { lockVersion: other.lockVersion, confirmRedistribute: false },
        TO,
      ),
    ).resolves.not.toBeNull();
  });

  it('records the submission_s own instant, not the clock', async () => {
    const { service } = await makeService();
    const { id } = await sentQuote(service);
    const relayAt = new Date('2026-08-17T11:14:52.000Z');

    const stored = await service.recordSend(id, submission({ acceptedByRelayAt: relayAt }));

    expect(stored.acceptedByRelayAt).toBe(relayAt.toISOString());
    expect(stored.messageId).toBe('<msg-1@erp.org.example.test>');
  });
});

describe('QuoteService.send', () => {
  const TO = ['buyer@example.com'];

  const sendableQuote = async (service: Awaited<ReturnType<typeof makeService>>['service']) => {
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');
    const current = await service.findById(quote.id);
    return { id: quote.id, lockVersion: current!.lockVersion };
  };

  it('hands the notifier the quote, the stored document and the recipients', async () => {
    const { service, mail } = await makeService();
    const { id, lockVersion } = await sendableQuote(service);

    await service.send(
      id,
      { lockVersion, confirmRedistribute: false },
      TO,
      RENDER,
      'demo-contributor',
    );

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.quote.id).toBe(id);
    expect(mail.sent[0]!.document).toBe(STORED_QUOTE);
    expect(mail.sent[0]!.to).toEqual(TO);

    expect(mail.sent[0]!.quote.lines).toHaveLength(1);
  });

  it('records the send from the receipt, not from the clock', async () => {
    const { service } = await makeService();
    const { id, lockVersion } = await sendableQuote(service);

    const recorded = await service.send(
      id,
      { lockVersion, confirmRedistribute: false },
      TO,
      RENDER,
      'demo-contributor',
    );

    expect(recorded?.messageId).toBe('<send-1@erp.org.example.test>');
    expect(recorded?.actor).toBe('demo-contributor');

    expect(recorded?.acceptedByRelayAt).toBe(RELAY_AT.toISOString());
  });

  it('returns null for an unknown id rather than throwing', async () => {
    const { service, mail } = await makeService();

    const recorded = await service.send(
      'quote-nope',
      { lockVersion: 1, confirmRedistribute: false },
      TO,
      RENDER,
      'demo-contributor',
    );

    expect(recorded).toBeNull();
    expect(mail.sent).toHaveLength(0);
  });

  it('records nothing when the relay refuses the message', async () => {
    const { service, mail } = await makeService();
    const { id, lockVersion } = await sendableQuote(service);
    mail.refuseNextSend(new Error('the relay did not accept the message'));

    await expect(
      service.send(id, { lockVersion, confirmRedistribute: false }, TO, RENDER, 'demo-contributor'),
    ).rejects.toThrow('the relay did not accept the message');

    const quote = await service.findById(id);
    expect(await service.sends(quote!.rootQuoteId)).toHaveLength(0);
  });

  it('refuses a stale lockVersion without calling the notifier', async () => {
    const { service, mail } = await makeService();
    const { id, lockVersion } = await sendableQuote(service);

    await expect(
      service.send(
        id,
        { lockVersion: lockVersion + 1, confirmRedistribute: false },
        TO,
        RENDER,
        'demo-contributor',
      ),
    ).rejects.toBeInstanceOf(StaleAggregateError);
    expect(mail.sent).toHaveLength(0);
  });

  it('refuses a quote with no recipient without calling the notifier', async () => {
    const { service, mail } = await makeService();
    const { id, lockVersion } = await sendableQuote(service);

    await expect(
      service.send(id, { lockVersion, confirmRedistribute: false }, [], RENDER, 'demo-contributor'),
    ).rejects.toBeInstanceOf(QuoteHasNoRecipientsError);
    expect(mail.sent).toHaveLength(0);
  });

  it('refuses an unconfirmed redistribution without calling the notifier', async () => {
    const { service, mail } = await makeService();
    const { id, lockVersion } = await sendableQuote(service);
    await service.send(
      id,
      { lockVersion, confirmRedistribute: false },
      TO,
      RENDER,
      'demo-contributor',
    );

    await expect(
      service.send(id, { lockVersion, confirmRedistribute: false }, TO, RENDER, 'demo-contributor'),
    ).rejects.toBeInstanceOf(QuoteRedistributionNotConfirmedError);
    expect(mail.sent).toHaveLength(1);

    await service.send(
      id,
      { lockVersion, confirmRedistribute: true },
      TO,
      RENDER,
      'demo-contributor',
    );
    expect(mail.sent).toHaveLength(2);
  });

  it('does not announce to production as part of sending', async () => {
    const { service, mail } = await makeService();
    const { id, lockVersion } = await sendableQuote(service);

    await service.send(
      id,
      { lockVersion, confirmRedistribute: false },
      TO,
      RENDER,
      'demo-contributor',
    );

    expect(mail.announced).toHaveLength(0);
  });
});

describe('QuoteService.send — one act from a draft', () => {
  const TO = ['buyer@example.com'];

  const renderSpy = () => {
    const calls: string[] = [];
    const render = async () => {
      calls.push('render');
      return STORED_QUOTE;
    };
    return { calls, render };
  };

  const sendNow = async (
    service: QuoteService,
    id: string,
    render: () => Promise<StoredDocument>,
    over: { recipients?: readonly string[]; confirmRedistribute?: boolean } = {},
  ) => {
    const current = await service.findById(id);
    return service.send(
      id,
      {
        lockVersion: current?.lockVersion ?? 1,
        confirmRedistribute: over.confirmRedistribute ?? false,
      },
      over.recipients ?? TO,
      render,
      'demo-contributor',
    );
  };

  const expectNothingHappened = async (
    service: QuoteService,
    mail: ReturnType<typeof makeNotifiers>,
    calls: string[],
    id: string,
    status: QuoteStatus = 'draft',
  ) => {
    const quote = await service.findById(id);
    expect(quote?.status).toBe(status);
    expect(calls).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);
    expect(await service.sends(quote!.rootQuoteId)).toHaveLength(0);
  };

  it('moves a draft to quoted, renders, emails and records the send', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    const { calls, render } = renderSpy();

    const recorded = await sendNow(service, quote.id, render);

    expect((await service.findById(quote.id))?.status).toBe('quoted');
    expect(calls).toEqual(['render']);
    expect(mail.sent).toHaveLength(1);

    expect(mail.sent[0]!.quote.status).toBe('quoted');
    expect(mail.sent[0]!.document).toBe(STORED_QUOTE);
    expect(recorded?.quoteId).toBe(quote.id);
    expect(await service.sends(quote.rootQuoteId)).toHaveLength(1);
  });

  it('sends an approved hand-set price in the same act', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [
      line({
        pricingBasis: 'per_pound',
        orderedWeightLb: '1000.0000',
        overridePricePerLb: '1.0700',
      }),
    ]);
    await moveNow(service, quote.id, 'override_requested');
    await decideNow(service, quote.id, 'approve');
    await withLeadTime(service, quote.id);
    const { render } = renderSpy();

    await sendNow(service, quote.id, render);

    expect((await service.findById(quote.id))?.status).toBe('quoted');
    expect(mail.sent).toHaveLength(1);
  });

  it('refuses a pending hand-set price and leaves the quote where it was', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [
      line({
        pricingBasis: 'per_pound',
        orderedWeightLb: '1000.0000',
        overridePricePerLb: '1.0700',
      }),
    ]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'override_requested');
    const { calls, render } = renderSpy();

    await expect(sendNow(service, quote.id, render)).rejects.toThrow(OverrideNotApprovedError);
    await expectNothingHappened(service, mail, calls, quote.id, 'override_requested');
  });

  it('refuses a below-floor line and leaves the draft a draft', async () => {
    const { service, mail, tiers } = await makeService();
    const probe = await service.create({ customerId: CUSTOMER });
    const priced = await saveLines(service, probe.id, [line()]);
    await tiers.update(
      priced?.lines[0]?.tier.code as string,
      { marginPct: '0.078000' },
      new Date(),
      'test:tier-edit',
    );
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    const { calls, render } = renderSpy();

    await expect(sendNow(service, quote.id, render)).rejects.toThrow(BelowFloorQuoteError);
    await expectNothingHappened(service, mail, calls, quote.id);
  });

  it('refuses a draft with no lead time, with the transition_s reason', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    const { calls, render } = renderSpy();

    await expect(sendNow(service, quote.id, render)).rejects.toThrow(QuoteNeedsLeadTimeError);
    await expectNothingHappened(service, mail, calls, quote.id);
  });

  it('refuses a draft with nobody to send to', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    const { calls, render } = renderSpy();

    await expect(sendNow(service, quote.id, render, { recipients: [] })).rejects.toThrow(
      QuoteHasNoRecipientsError,
    );
    await expectNothingHappened(service, mail, calls, quote.id);
  });

  it('refuses a stale draft before moving it', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    const current = await service.findById(quote.id);
    const { calls, render } = renderSpy();

    await expect(
      service.send(
        quote.id,
        { lockVersion: current!.lockVersion - 1, confirmRedistribute: false },
        TO,
        render,
        'demo-contributor',
      ),
    ).rejects.toThrow(StaleAggregateError);
    await expectNothingHappened(service, mail, calls, quote.id);
  });

  it('asks before a revised draft goes to a customer holding v1', async () => {
    const { service, mail } = await makeService();
    const v1 = await service.create({ customerId: CUSTOMER });
    await saveLines(service, v1.id, [line()]);
    await withLeadTime(service, v1.id);
    await sendNow(service, v1.id, renderSpy().render);
    const v2 = await service.revise(v1.id);
    await withLeadTime(service, v2!.id);
    const { calls, render } = renderSpy();

    await expect(sendNow(service, v2!.id, render)).rejects.toThrow(
      QuoteRedistributionNotConfirmedError,
    );
    expect((await service.findById(v2!.id))?.status).toBe('draft');
    expect(calls).toHaveLength(0);
    expect(mail.sent).toHaveLength(1);

    await sendNow(service, v2!.id, render, { confirmRedistribute: true });
    expect((await service.findById(v2!.id))?.status).toBe('quoted');
    expect(mail.sent).toHaveLength(2);
  });

  it('puts a draft back to draft when the relay does not take the mail, and rethrows', async () => {
    const clock = makeClock();
    const { service, mail } = await makeService(clock);
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    const before = await service.findById(quote.id);

    clock.set('2026-08-07T11:40:00.000Z');
    const refusal = new Error('the relay did not accept the message');
    mail.refuseNextSend(refusal);

    await expect(sendNow(service, quote.id, renderSpy().render)).rejects.toBe(refusal);

    const after = await service.findById(quote.id);
    expect(after?.status).toBe('draft');
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(after?.lockVersion).toBe(before!.lockVersion + 2);
    expect(mail.sent).toHaveLength(0);
    expect(await service.sends(quote.rootQuoteId)).toHaveLength(0);

    await sendNow(service, quote.id, renderSpy().render);
    expect((await service.findById(quote.id))?.status).toBe('quoted');
    expect(await service.sends(quote.rootQuoteId)).toHaveLength(1);
  });

  it('puts an approved hand-set price back to override_requested when the relay does not take the mail', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [
      line({
        pricingBasis: 'per_pound',
        orderedWeightLb: '1250.0000',
        overridePricePerLb: '1.1300',
      }),
    ]);
    await withLeadTime(service, quote.id);
    await decideNow(service, quote.id, 'approve');
    await moveNow(service, quote.id, 'override_requested');
    const before = await service.findById(quote.id);
    mail.refuseNextSend(new Error('the relay could not be reached'));

    await expect(sendNow(service, quote.id, renderSpy().render)).rejects.toThrow(
      'the relay could not be reached',
    );

    const after = await service.findById(quote.id);
    expect(after?.status).toBe('override_requested');
    expect(after?.overrideApprovedBy).toEqual(before?.overrideApprovedBy);
    expect(await service.sends(quote.rootQuoteId)).toHaveLength(0);
  });

  it('sends another copy of a quoted quote without moving it', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await sendNow(service, quote.id, renderSpy().render);
    const before = await service.findById(quote.id);

    await sendNow(service, quote.id, renderSpy().render, { confirmRedistribute: true });

    const after = await service.findById(quote.id);
    expect(after?.status).toBe('quoted');
    expect(after?.lockVersion).toBe(before?.lockVersion);
    expect(mail.sent).toHaveLength(2);
  });

  const failingRender = () => {
    const failure = Object.assign(
      new Error("EACCES: permission denied, open '/srv/app-data/documents/quote/2026/10/q.pdf'"),
      { code: 'EACCES' },
    );
    const calls: string[] = [];
    const render = async (): Promise<StoredDocument> => {
      calls.push('render');
      throw failure;
    };
    return { failure, calls, render };
  };

  it('puts a draft back to draft when the PDF cannot be filed, and rethrows', async () => {
    const clock = makeClock();
    const { service, mail } = await makeService(clock);
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    const before = await service.findById(quote.id);

    clock.set('2026-08-07T10:00:00.000Z');
    const { failure, calls, render } = failingRender();

    await expect(sendNow(service, quote.id, render)).rejects.toBe(failure);

    const after = await service.findById(quote.id);
    expect(after?.status).toBe('draft');
    expect(after?.updatedAt).toBe(before?.updatedAt);

    expect(after?.lockVersion).toBe(before!.lockVersion + 2);
    expect(calls).toEqual(['render']);
    expect(mail.sent).toHaveLength(0);
    expect(await service.sends(quote.rootQuoteId)).toHaveLength(0);
  });

  it('starts the next send clean after a failed filing', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await expect(sendNow(service, quote.id, failingRender().render)).rejects.toThrow('EACCES');
    const { calls, render } = renderSpy();

    const recorded = await sendNow(service, quote.id, render);

    expect((await service.findById(quote.id))?.status).toBe('quoted');
    expect(calls).toEqual(['render']);
    expect(mail.sent).toHaveLength(1);
    expect(recorded?.quoteId).toBe(quote.id);
    expect(await service.sends(quote.rootQuoteId)).toHaveLength(1);
  });

  it('puts an approved hand-set price back to override_requested, approval intact', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [
      line({
        pricingBasis: 'per_pound',
        orderedWeightLb: '1000.0000',
        overridePricePerLb: '1.0700',
      }),
    ]);

    await withLeadTime(service, quote.id);
    await decideNow(service, quote.id, 'approve');
    await moveNow(service, quote.id, 'override_requested');
    const before = await service.findById(quote.id);
    expect(before?.status).toBe('override_requested');
    expect(before?.overrideApprovedBy).toBeDefined();
    expect(before?.leadTimeDays).toBe(10);

    await expect(sendNow(service, quote.id, failingRender().render)).rejects.toThrow('EACCES');

    const after = await service.findById(quote.id);
    expect(after?.status).toBe('override_requested');
    expect(after?.overrideApprovedBy).toEqual(before?.overrideApprovedBy);
    expect(mail.sent).toHaveLength(0);

    await sendNow(service, quote.id, renderSpy().render);
    expect((await service.findById(quote.id))?.status).toBe('quoted');
    expect(mail.sent).toHaveLength(1);
  });

  it("moves nothing when a quoted quote's re-send cannot render", async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await sendNow(service, quote.id, renderSpy().render);
    const before = await service.findById(quote.id);
    const { failure, render } = failingRender();

    await expect(sendNow(service, quote.id, render, { confirmRedistribute: true })).rejects.toBe(
      failure,
    );

    const after = await service.findById(quote.id);
    expect(after?.status).toBe('quoted');
    expect(after?.lockVersion).toBe(before?.lockVersion);
    expect(mail.sent).toHaveLength(1);
    expect(await service.sends(quote.rootQuoteId)).toHaveLength(1);
  });

  it('leaves a newer act standing when the undo is refused', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    const { failure } = failingRender();

    const render = async (): Promise<StoredDocument> => {
      await moveNow(service, quote.id, 'closed_lost');
      throw failure;
    };

    await expect(sendNow(service, quote.id, render)).rejects.toMatchObject({
      name: 'QuoteSendNotUndoneError',
      reason: 'write-failed',
      cause: failure,
      undoError: expect.any(StaleAggregateError),
    });
    expect((await service.findById(quote.id))?.status).toBe('closed_lost');
    expect(mail.sent).toHaveLength(0);
  });
});

describe('QuoteService.notifyProductionManagers', () => {
  const TO = ['buyer@example.com'];

  const sentQuote = async (service: Awaited<ReturnType<typeof makeService>>['service']) => {
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');
    const current = await service.findById(quote.id);
    return service.send(
      quote.id,
      { lockVersion: current!.lockVersion, confirmRedistribute: false },
      TO,
      RENDER,
      'demo-contributor',
    );
  };

  it('tells every holder of the role, not the customer', async () => {
    const { service, mail } = await makeService();
    mail.setProductionManagers(['pm@org.example.test', 'deputy@org.example.test']);
    const send = await sentQuote(service);

    const notified = await service.notifyProductionManagers(send!);

    expect(notified?.recipients).toEqual(['pm@org.example.test', 'deputy@org.example.test']);
    expect(mail.announced).toHaveLength(1);

    expect(mail.announced[0]!.to).not.toContain('buyer@example.com');
  });

  it('carries the quote, its lines and the send record', async () => {
    const { service, mail } = await makeService();
    const send = await sentQuote(service);

    await service.notifyProductionManagers(send!);

    expect(mail.announced[0]!.quote.id).toBe(send!.quoteId);
    expect(mail.announced[0]!.quote.lines).toHaveLength(1);

    expect(mail.announced[0]!.send.actor).toBe('demo-contributor');
  });

  it('reports that nobody holds the role, and announces nothing', async () => {
    const { service, mail } = await makeService();
    mail.setProductionManagers([]);
    const send = await sentQuote(service);

    await expect(service.notifyProductionManagers(send!)).rejects.toBeInstanceOf(
      NoProductionManagerError,
    );
    expect(mail.announced).toHaveLength(0);

    const quote = await service.findById(send!.quoteId);
    expect(await service.sends(quote!.rootQuoteId)).toHaveLength(1);
  });

  it('separates a held-but-unreachable role from nobody holding it', async () => {
    const { service, mail } = await makeService();
    mail.setProductionManagers([], ['dev-pm']);
    const send = await sentQuote(service);

    await expect(service.notifyProductionManagers(send!)).rejects.toMatchObject({
      reason: 'no-addresses',
      holdersWithoutEmail: ['dev-pm'],
    });
    expect(mail.announced).toHaveLength(0);
  });

  it('reports no-holders when the role is genuinely unheld', async () => {
    const { service, mail } = await makeService();
    mail.setProductionManagers([], []);
    const send = await sentQuote(service);

    await expect(service.notifyProductionManagers(send!)).rejects.toMatchObject({
      reason: 'no-holders',
    });
  });

  it('returns null when the send names a quote that no longer exists', async () => {
    const { service, mail } = await makeService();
    const send = await sentQuote(service);

    const notified = await service.notifyProductionManagers({ ...send!, quoteId: 'quote-gone' });

    expect(notified).toBeNull();
    expect(mail.announced).toHaveLength(0);
  });
});

describe('QuoteService.askProductionForLeadTime', () => {
  it('asks every holder once, on the first priced save of a draft', async () => {
    const { service, mail } = await makeService();
    mail.setProductionManagers(['pm@org.example.test', 'deputy@org.example.test']);
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    const notified = await service.askProductionForLeadTime(quote.id, 'demo-contributor');

    expect(notified?.recipients).toEqual(['pm@org.example.test', 'deputy@org.example.test']);
    expect(mail.asked).toHaveLength(1);
    expect(mail.asked[0]!.quote.lines).toHaveLength(1);

    expect(mail.asked[0]!.actor).toBe('demo-contributor');
  });

  it('does not ask a second time while a request is on the log', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await service.askProductionForLeadTime(quote.id, 'demo-contributor');
    await saveLines(service, quote.id, [line(), line()]);

    expect(await service.askProductionForLeadTime(quote.id, 'demo-contributor')).toBeNull();
    expect(mail.asked).toHaveLength(1);
  });

  it('counts a recorded gap as asked: once means once', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    mail.markAsked(quote.id);

    expect(await service.askProductionForLeadTime(quote.id, 'demo-contributor')).toBeNull();
    expect(mail.asked).toHaveLength(0);
  });

  it('never asks about a quote that already has a lead time', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await withLeadTime(service, quote.id);
    await saveLines(service, quote.id, [line()]);

    expect(await service.askProductionForLeadTime(quote.id, 'demo-contributor')).toBeNull();
    expect(mail.asked).toHaveLength(0);
  });

  it('does not ask while the quote has no priced line', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    expect(await service.askProductionForLeadTime(quote.id, 'demo-contributor')).toBeNull();
    expect(mail.asked).toHaveLength(0);
  });

  it('does not ask about a quote that is no longer a draft', async () => {
    const { service, mail } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await moveNow(service, quote.id, 'closed_lost');

    expect(await service.askProductionForLeadTime(quote.id, 'demo-contributor')).toBeNull();
    expect(mail.asked).toHaveLength(0);
  });

  it('reports that nobody holds the role, and asks nobody', async () => {
    const { service, mail } = await makeService();
    mail.setProductionManagers([], []);
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    await expect(
      service.askProductionForLeadTime(quote.id, 'demo-contributor'),
    ).rejects.toMatchObject({
      name: 'NoProductionManagerError',
      reason: 'no-holders',
      message: expect.stringContaining('needs a lead time'),
    });
    expect(mail.asked).toHaveLength(0);
  });

  it('separates a held-but-unreachable role from nobody holding it', async () => {
    const { service, mail } = await makeService();
    mail.setProductionManagers([], ['dev-pm']);
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    await expect(
      service.askProductionForLeadTime(quote.id, 'demo-contributor'),
    ).rejects.toMatchObject({
      reason: 'no-addresses',
      holdersWithoutEmail: ['dev-pm'],
    });
  });

  it('answers null for a quote that does not exist', async () => {
    const { service } = await makeService();

    expect(await service.askProductionForLeadTime('quote-gone', 'demo-contributor')).toBeNull();
  });
});

describe('QuoteService.setLeadTime', () => {
  it('records the days a person entered', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await service.setLeadTime(
      quote.id,
      {
        leadTimeDays: 14,
        lockVersion: quote.lockVersion,
      },
      LEAD_TIME_SETTER,
    );

    expect(saved?.leadTimeDays).toBe(14);
  });

  it('records who entered it and when', async () => {
    const { service, clock } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    expect(quote.leadTimeSetBy).toBeUndefined();
    expect(quote.leadTimeSetAt).toBeUndefined();

    const saved = await service.setLeadTime(
      quote.id,
      { leadTimeDays: 14, lockVersion: quote.lockVersion },
      'dev-production',
    );

    expect(saved?.leadTimeSetBy).toBe('dev-production');
    expect(saved?.leadTimeSetAt).toBe(clock.now().toISOString());
  });

  it('accepts zero — same-day turnaround is a real answer', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await service.setLeadTime(
      quote.id,
      {
        leadTimeDays: 0,
        lockVersion: quote.lockVersion,
      },
      LEAD_TIME_SETTER,
    );

    expect(saved?.leadTimeDays).toBe(0);
  });

  it('is overwritable while the quote is still a draft', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    const first = await service.setLeadTime(
      quote.id,
      {
        leadTimeDays: 5,
        lockVersion: quote.lockVersion,
      },
      LEAD_TIME_SETTER,
    );

    const second = await service.setLeadTime(
      quote.id,
      {
        leadTimeDays: 9,
        lockVersion: first?.lockVersion ?? 0,
      },
      LEAD_TIME_SETTER,
    );

    expect(second?.leadTimeDays).toBe(9);
  });

  it('refuses once the quote has gone out', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    const current = await service.findById(quote.id);
    await expect(
      service.setLeadTime(
        quote.id,
        {
          leadTimeDays: 3,
          lockVersion: current?.lockVersion ?? 0,
        },
        LEAD_TIME_SETTER,
      ),
    ).rejects.toThrow(QuoteNotEditableError);
  });

  it('refuses figures the caller never read', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    await expect(
      service.setLeadTime(
        quote.id,
        { leadTimeDays: 7, lockVersion: quote.lockVersion + 99 },
        LEAD_TIME_SETTER,
      ),
    ).rejects.toThrow(StaleAggregateError);
  });

  it('returns null for a quote that does not exist', async () => {
    const { service } = await makeService();
    expect(
      await service.setLeadTime(
        'quote-nobody',
        { leadTimeDays: 7, lockVersion: 1 },
        LEAD_TIME_SETTER,
      ),
    ).toBeNull();
  });

  it('does NOT revoke a live override approval', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    await saveLines(service, quote.id, [line({ overridePricePerRoll: '73.2500' })]);
    const approved = await decideNow(service, quote.id, 'approve');
    expect(approved?.overrideApprovedBy).toBeDefined();

    const after = await service.setLeadTime(
      quote.id,
      {
        leadTimeDays: 4,
        lockVersion: approved?.lockVersion ?? 0,
      },
      LEAD_TIME_SETTER,
    );

    expect(after?.overrideApprovedBy).toBe(approved?.overrideApprovedBy);
    expect(after?.overrideApprovedAt).toBe(approved?.overrideApprovedAt);
  });
});

describe('printableQuote — the lead-time gate', () => {
  it('refuses a quote with no lead time', async () => {
    const { service, quotes } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    await quotes.transition(quote.id, 'quoted', new Date());

    await expect(service.printableQuote(quote.id)).rejects.toThrow(QuoteHasNoLeadTimeError);
  });

  it('gates RENDERING, not only sending', async () => {
    const { service, quotes } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await quotes.transition(quote.id, 'quoted', new Date());

    await expect(service.printableQuote(quote.id)).rejects.toThrow(QuoteHasNoLeadTimeError);
  });

  it('reports a below-floor line BEFORE a missing lead time', async () => {
    const { service, quotes, tiers } = await makeService();
    const probe = await service.create({ customerId: CUSTOMER });
    const priced = await saveLines(service, probe.id, [line()]);
    const tierCode = priced?.lines[0]?.tier.code as string;
    await tiers.update(tierCode, { marginPct: '0.078000' }, new Date(), 'test:tier-edit');

    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await quotes.transition(quote.id, 'quoted', new Date());

    await expect(service.printableQuote(quote.id)).rejects.toThrow(BelowFloorQuoteError);
  });

  it('passes once a lead time is set', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id, 12);
    await moveNow(service, quote.id, 'quoted');

    const printable = await service.printableQuote(quote.id);

    expect(printable?.leadTimeDays).toBe(12);
  });

  it('passes with a zero lead time — absent and zero are different', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id, 0);
    await moveNow(service, quote.id, 'quoted');

    expect((await service.printableQuote(quote.id))?.leadTimeDays).toBe(0);
  });
});

describe('setLines - a jurisdiction must belong to the ship-to state', () => {
  it('saves a line whose jurisdiction matches its own delivery address', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [
      line({
        taxTreatment: { taxStatus: 'wa_tax' as const, taxJurisdiction: 'WA-9020' },
        deliveryAddress: {
          line1: '400 Warehouse Way',
          city: 'Sample Harbor',
          state: 'WA',
          postalCode: '98000',
        },
      }),
    ]);

    expect(saved?.lines[0]?.taxJurisdiction).toBe('WA-9020');
  });

  it('refuses a Washington jurisdiction on an Oregon delivery', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    await expect(
      saveLines(service, quote.id, [
        line({
          taxTreatment: { taxStatus: 'wa_tax' as const, taxJurisdiction: 'WA-9020' },
          deliveryAddress: {
            line1: '1 Riverside',
            city: 'Demo Port',
            state: 'OR',
            postalCode: '97000',
          },
        }),
      ]),
    ).rejects.toThrow(LineJurisdictionMismatchError);
  });

  it('names the line, the jurisdiction and the destination in the refusal', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const failure = (await saveLines(service, quote.id, [
      line(),
      line({
        taxTreatment: { taxStatus: 'wa_tax' as const, taxJurisdiction: 'WA-9020' },
        deliveryAddress: {
          line1: '1 Riverside',
          city: 'Demo Port',
          state: 'OR',
          postalCode: '97000',
        },
      }),
    ]).catch((error: unknown) => error)) as LineJurisdictionMismatchError;

    expect(failure.lineNumber).toBe(2);
    expect(failure.taxJurisdiction).toBe('WA-9020');
    expect(failure.shipToState).toBe('OR');
  });

  it('writes nothing when a later line is refused', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    await expect(
      saveLines(service, quote.id, [
        line({ quantityRolls: 7 }),
        line({
          taxTreatment: { taxStatus: 'wa_tax' as const, taxJurisdiction: 'WA-9020' },
          deliveryAddress: {
            line1: '1 Riverside',
            city: 'Demo Port',
            state: 'OR',
            postalCode: '97000',
          },
        }),
      ]),
    ).rejects.toThrow(LineJurisdictionMismatchError);

    const after = await service.findWithLines(quote.id);
    expect(after?.lines).toHaveLength(1);
    expect(after?.lines[0]?.quantityRolls).toBe(100);
  });

  it('falls back to the billing state when the line names no address', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    await expect(
      saveLines(service, quote.id, [
        line({ taxTreatment: { taxStatus: 'wa_tax' as const, taxJurisdiction: 'WA-9020' } }),
      ]),
    ).rejects.toThrow(LineJurisdictionMismatchError);
  });

  it('accepts a non-taxable line to any destination', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [
      line({
        taxTreatment: { taxStatus: 'non_tax' as const },
        deliveryAddress: {
          line1: '1 Riverside',
          city: 'Demo Port',
          state: 'OR',
          postalCode: '97000',
        },
      }),
    ]);

    expect(saved?.lines[0]?.taxStatus).toBe('non_tax');
  });

  it('lets a revision copy a line the rule would now refuse', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [
      line({
        taxTreatment: { taxStatus: 'wa_tax' as const, taxJurisdiction: 'WA-9020' },
        deliveryAddress: {
          line1: '400 Warehouse Way',
          city: 'Sample Harbor',
          state: 'WA',
          postalCode: '98000',
        },
      }),
    ]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    const revised = await service.revise(quote.id);

    expect(revised?.lines[0]?.taxJurisdiction).toBe('WA-9020');
  });
});

describe('setLines - a tax jurisdiction must have a rate loaded', () => {
  const inWashington = (taxJurisdiction: string) =>
    line({
      taxTreatment: { taxStatus: 'wa_tax' as const, taxJurisdiction },
      deliveryAddress: {
        line1: '400 Warehouse Way',
        city: 'Sample Harbor',
        state: 'WA',
        postalCode: '98000',
      },
    });

  it('refuses a key with no rate, naming the line and the key, and writes nothing', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);

    const failure = (await saveLines(service, quote.id, [
      line({ quantityRolls: 7 }),
      inWashington('WA-9040'),
    ]).catch((error: unknown) => error)) as UnknownTaxJurisdictionError;

    expect(failure).toBeInstanceOf(UnknownTaxJurisdictionError);
    expect(failure.lineNumber).toBe(2);
    expect(failure.taxJurisdiction).toBe('WA-9040');
    const after = await service.findWithLines(quote.id);
    expect(after?.lines).toHaveLength(1);
    expect(after?.lines[0]?.quantityRolls).toBe(100);
  });

  it('accepts a key whose only rate starts in a later quarter', async () => {
    const { service, taxRates } = await makeService();
    await taxRates.importRates([
      { jurisdiction: 'WA-9040', rate: '0.113000', effectiveFrom: '2091-01-01', source: 'wa_dor' },
    ]);
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await saveLines(service, quote.id, [inWashington('WA-9040')]);

    expect(saved?.lines[0]?.taxJurisdiction).toBe('WA-9040');
  });

  it('reports a key from the wrong state before a missing rate', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    await expect(
      saveLines(service, quote.id, [
        line({ taxTreatment: { taxStatus: 'wa_tax' as const, taxJurisdiction: 'WA-9040' } }),
      ]),
    ).rejects.toThrow(LineJurisdictionMismatchError);
  });
});

describe('QuoteService - freight in the price per roll', () => {
  it('saves the flag with the lines, moving the token once', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    const saved = await service.setLines(quote.id, [line()], quote.lockVersion, {
      freightInRollPrice: true,
    });

    expect(saved?.freightInRollPrice).toBe(true);
    expect(saved?.lockVersion).toBe(quote.lockVersion + 1);
  });

  it('leaves the flag alone on a save that does not name it, as the Lines step does', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await service.setLines(quote.id, [line()], quote.lockVersion, { freightInRollPrice: true });

    const saved = await saveLines(service, quote.id, [line({ quantityRolls: 60 })]);

    expect(saved?.freightInRollPrice).toBe(true);
  });

  it('starts a new quote with freight apart', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });

    expect(quote.freightInRollPrice).toBe(false);
  });

  it('carries the flag onto a revision, as every other figure is carried', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await service.setLines(quote.id, [line()], quote.lockVersion, { freightInRollPrice: true });
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    const revised = await service.revise(quote.id);

    expect(revised?.freightInRollPrice).toBe(true);
  });

  it('carries freight apart onto a revision of a quote that never set it', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    const revised = await service.revise(quote.id);

    expect(revised?.freightInRollPrice).toBe(false);
  });
});

describe('QuoteService.setLines - the revocation is part of the save', () => {
  // A service over the same quotes whose every write other than the line save fails, as a
  // database that goes away after the lines are written would.
  function withFailingFollowUps(ctx: Awaited<ReturnType<typeof makeService>>): QuoteService {
    const quotes = new Proxy(ctx.quotes, {
      get(target, prop) {
        if (prop === 'recordOverrideDecision' || prop === 'transition') {
          return async () => {
            throw new Error('the database went away');
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return new QuoteService({
      quotes,
      pricing: ctx.pricing,
      customers,
      approvals: ctx.approvals,
      orders,
      notifier: ctx.mail.notifier,
      productionManagers: ctx.mail.productionManagers,
      productionNotifier: ctx.mail.productionNotifier,
      leadTimeRequests: ctx.mail.leadTimeRequests,
      taxJurisdictions: new TaxRateService(ctx.taxRates),
      clock: ctx.clock,
    });
  }

  it('never leaves new prices under the approval granted for the old ones', async () => {
    const ctx = await makeService();
    const quote = await ctx.service.create({ customerId: CUSTOMER });
    await saveLines(ctx.service, quote.id, [line({ overridePricePerRoll: '79.2500' })]);
    await decideNow(ctx.service, quote.id, 'approve');
    expect((await ctx.service.findById(quote.id))?.overrideApprovedBy).toBe('bmanager');

    const outcome = await saveLines(withFailingFollowUps(ctx), quote.id, [
      line({ overridePricePerRoll: '81.6000' }),
    ]).then(
      (saved) => saved,
      (err: unknown) => err,
    );

    const stored = await ctx.service.findWithLines(quote.id);
    expect(stored?.lines.map((l) => l.overridePricePerRoll)).toEqual(['81.6000']);
    expect(stored?.overrideApprovedBy).toBeUndefined();
    expect(outcome).toEqual(stored);
    await withLeadTime(ctx.service, quote.id);
    await expect(moveNow(ctx.service, quote.id, 'quoted')).rejects.toThrow(
      OverrideNotApprovedError,
    );
  });

  it('takes a queued quote back to draft in the same save', async () => {
    const ctx = await makeService();
    const quote = await ctx.service.create({ customerId: CUSTOMER });
    const saved = await saveLines(ctx.service, quote.id, [
      line({ overridePricePerRoll: '0.0450' }),
    ]);
    expect(saved?.lines[0]?.floor.status).toBe('below_floor');
    await moveNow(ctx.service, quote.id, 'override_requested');
    await decideNow(ctx.service, quote.id, 'approve');
    const queued = await ctx.service.findById(quote.id);
    expect(queued?.status).toBe('override_requested');
    expect(queued?.overrideApprovedBy).toBe('bmanager');

    await saveLines(withFailingFollowUps(ctx), quote.id, [
      line({ overridePricePerRoll: '0.0475' }),
    ]).catch(() => null);

    const stored = await ctx.service.findWithLines(quote.id);
    expect(stored?.lines.map((l) => l.overridePricePerRoll)).toEqual(['0.0475']);
    expect(stored?.overrideApprovedBy).toBeUndefined();
    expect(stored?.status).toBe('draft');
    const log = await ctx.service.overrideDecisions(quote.id);
    expect(log.filter((d) => d.decision === 'revoked')).toMatchObject([
      {
        kind: 'price',
        actor: 'system:edit',
        reason: 'quote lines were changed after approval',
      },
    ]);
  });
});

describe('QuoteService — every check holds for the version that is written', () => {
  type Ctx = Awaited<ReturnType<typeof makeService>>;
  type RepoMethod = 'findById' | 'transition' | 'recordOverrideDecision';

  // A service over the same quotes in which `land` runs once, as another person's write would,
  // right after the first call to `method` returns, or right before it when `before` is set.
  function withWriteLanding(
    ctx: Ctx,
    method: RepoMethod,
    land: () => Promise<unknown>,
    before = false,
  ): QuoteService {
    let armed = true;
    const quotes = new Proxy(ctx.quotes, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        const bound = (value as (...args: unknown[]) => Promise<unknown>).bind(target);
        if (prop !== method) return bound;
        return async (...args: unknown[]) => {
          if (armed && before) {
            armed = false;
            await land();
          }
          const result = await bound(...args);
          if (armed) {
            armed = false;
            await land();
          }
          return result;
        };
      },
    });
    return new QuoteService({
      quotes,
      pricing: ctx.pricing,
      customers,
      approvals: ctx.approvals,
      orders,
      notifier: ctx.mail.notifier,
      productionManagers: ctx.mail.productionManagers,
      productionNotifier: ctx.mail.productionNotifier,
      leadTimeRequests: ctx.mail.leadTimeRequests,
      taxJurisdictions: new TaxRateService(ctx.taxRates),
      clock: ctx.clock,
    });
  }

  // A draft with one hand-set line, approved, and a lead time: ready to send.
  async function approvedDraft() {
    const ctx = await makeService();
    const quote = await ctx.service.create({ customerId: CUSTOMER });
    await saveLines(ctx.service, quote.id, [line({ overridePricePerRoll: '87.0000' })]);
    await decideNow(ctx.service, quote.id, 'approve');
    await withLeadTime(ctx.service, quote.id);
    const before = (await ctx.service.findWithLines(quote.id))!;
    expect(before.status).toBe('draft');
    expect(before.overrideApprovedBy).toBe('bmanager');
    return { ...ctx, id: quote.id, before };
  }

  it('setLines refuses a version other than the stored one, and saves nothing', async () => {
    const { service, id, before } = await approvedDraft();

    await expect(
      service.setLines(id, [line({ overridePricePerRoll: '73.2500' })], before.lockVersion + 1),
    ).rejects.toBeInstanceOf(StaleAggregateError);

    expect(await service.findWithLines(id)).toEqual(before);
  });

  it('setLines with the next version cannot put a new price on a quote sent after the read', async () => {
    const ctx = await approvedDraft();
    const { id, before } = ctx;
    const raced = withWriteLanding(ctx, 'findById', () =>
      ctx.service.transition(id, 'quoted', before.lockVersion, SALES_REP),
    );

    await expect(
      raced.setLines(id, [line({ overridePricePerRoll: '73.2500' })], before.lockVersion + 1),
    ).rejects.toBeInstanceOf(StaleAggregateError);

    const stored = await ctx.service.findWithLines(id);
    expect(stored?.status).toBe('quoted');
    expect(stored?.overrideApprovedBy).toBe('bmanager');
    expect(stored?.lines.map((l) => l.overridePricePerRoll)).toEqual(['87.0000']);
  });

  it('transition refuses a version other than the stored one, and moves nothing', async () => {
    const { service, id, before } = await approvedDraft();

    await expect(
      service.transition(id, 'quoted', before.lockVersion + 1, SALES_REP),
    ).rejects.toBeInstanceOf(StaleAggregateError);

    expect(await service.findWithLines(id)).toEqual(before);
  });

  it('transition with the next version cannot send prices edited after the gates passed', async () => {
    const ctx = await approvedDraft();
    const { id, before } = ctx;
    const raced = withWriteLanding(
      ctx,
      'transition',
      () =>
        ctx.service.setLines(id, [line({ overridePricePerRoll: '73.2500' })], before.lockVersion),
      true,
    );

    await expect(
      raced.transition(id, 'quoted', before.lockVersion + 1, SALES_REP),
    ).rejects.toBeInstanceOf(StaleAggregateError);

    const stored = await ctx.service.findWithLines(id);
    expect(stored?.status).not.toBe('quoted');
  });

  it('setLeadTime refuses a version other than the stored one, and writes nothing', async () => {
    const { service, id, before } = await approvedDraft();

    await expect(
      service.setLeadTime(
        id,
        { leadTimeDays: 20, lockVersion: before.lockVersion + 1 },
        LEAD_TIME_SETTER,
      ),
    ).rejects.toBeInstanceOf(StaleAggregateError);

    expect(await service.findWithLines(id)).toEqual(before);
  });

  it('setLeadTime with the next version cannot change the lead time of a quote sent after the read', async () => {
    const ctx = await approvedDraft();
    const { id, before } = ctx;
    const raced = withWriteLanding(ctx, 'findById', () =>
      ctx.service.transition(id, 'quoted', before.lockVersion, SALES_REP),
    );

    await expect(
      raced.setLeadTime(
        id,
        { leadTimeDays: 20, lockVersion: before.lockVersion + 1 },
        LEAD_TIME_SETTER,
      ),
    ).rejects.toBeInstanceOf(StaleAggregateError);

    const stored = await ctx.service.findById(id);
    expect(stored?.status).toBe('quoted');
    expect(stored?.leadTimeDays).toBe(before.leadTimeDays);
  });

  describe('a decision and the move it makes', () => {
    // A quote waiting in the queue for the decision of `kind`, with a lead time.
    async function queued(kind: 'price' | 'floor') {
      const ctx = await makeService();
      const quote = await ctx.service.create({ customerId: CUSTOMER });
      await saveLines(ctx.service, quote.id, [
        line({ overridePricePerRoll: kind === 'price' ? '87.0000' : '0.0450' }),
      ]);
      if (kind === 'floor') {
        // A below-floor hand-set price owes both decisions. The price is approved first, so the
        // floor is the one left to decide.
        await decideNow(ctx.service, quote.id, 'approve');
      }
      await withLeadTime(ctx.service, quote.id);
      await moveNow(ctx.service, quote.id, 'override_requested');
      return { ...ctx, id: quote.id };
    }

    // Production changes the lead time after the decider has read the quote, so the decision is
    // guarded by a version that is no longer current.
    const changeLeadTime = (ctx: Ctx, id: string) => () => withLeadTime(ctx.service, id, 15);
    const closeQuote = (ctx: Ctx, id: string) => () => moveNow(ctx.service, id, 'closed_lost');

    async function expectStaleAndNothingRecorded(
      ctx: Ctx,
      id: string,
      decide: Promise<unknown>,
      landed: Partial<Quote>,
    ) {
      await expect(decide).rejects.toBeInstanceOf(StaleAggregateError);
      const stored = await ctx.service.findById(id);
      expect(stored).toMatchObject(landed);
      expect(stored?.overrideApprovedBy).toBe(landed.overrideApprovedBy);
      expect(stored?.floorOverrideBy).toBeUndefined();
      expect(
        (await ctx.service.overrideDecisions(id)).filter(
          (d) => d.decision === 'approved' || d.decision === 'rejected',
        ),
      ).toHaveLength(landed.overrideApprovedBy === undefined ? 0 : 1);
    }

    async function expectDecidedInOneWrite(
      ctx: Ctx,
      id: string,
      decide: () => Promise<Quote | null>,
      decision: 'approved' | 'rejected',
    ) {
      const before = (await ctx.service.findById(id))!;
      const answer = await decide();
      const stored = await ctx.service.findById(id);
      expect(stored?.status).toBe('draft');
      expect(stored?.lockVersion).toBe(before.lockVersion + 1);
      expect(answer).toEqual(stored);
      expect((await ctx.service.overrideDecisions(id)).at(-1)?.decision).toBe(decision);
      return stored;
    }

    it('refuses an approval at a version another write has moved past, and records it with the move in one write at the current one', async () => {
      const ctx = await queued('price');
      const raced = withWriteLanding(
        ctx,
        'recordOverrideDecision',
        changeLeadTime(ctx, ctx.id),
        true,
      );
      await expectStaleAndNothingRecorded(ctx, ctx.id, decideNow(raced, ctx.id, 'approve'), {
        status: 'override_requested',
        leadTimeDays: 15,
      });

      const stored = await expectDecidedInOneWrite(
        ctx,
        ctx.id,
        () => decideNow(ctx.service, ctx.id, 'approve'),
        'approved',
      );
      expect(stored?.overrideApprovedBy).toBe('bmanager');
    });

    it('refuses a floor override at a version another write has moved past, and records it with the move in one write at the current one', async () => {
      const ctx = await queued('floor');
      const raced = withWriteLanding(
        ctx,
        'recordOverrideDecision',
        changeLeadTime(ctx, ctx.id),
        true,
      );
      await expectStaleAndNothingRecorded(ctx, ctx.id, decideFloorNow(raced, ctx.id, 'approve'), {
        status: 'override_requested',
        leadTimeDays: 15,
        overrideApprovedBy: 'bmanager',
      });

      const stored = await expectDecidedInOneWrite(
        ctx,
        ctx.id,
        () => decideFloorNow(ctx.service, ctx.id, 'approve'),
        'approved',
      );
      expect(stored?.floorOverrideBy).toBe('dev-admin');
    });

    it('refuses a rejection of a quote closed after it was read, and records it with the move in one write at the current version', async () => {
      const ctx = await queued('price');
      const raced = withWriteLanding(ctx, 'recordOverrideDecision', closeQuote(ctx, ctx.id), true);
      await expectStaleAndNothingRecorded(
        ctx,
        ctx.id,
        decideNow(raced, ctx.id, 'reject', { reason: 'too low' }),
        { status: 'closed_lost' },
      );

      const open = await queued('price');
      await expectDecidedInOneWrite(
        open,
        open.id,
        () => decideNow(open.service, open.id, 'reject', { reason: 'too low' }),
        'rejected',
      );
    });

    it('refuses a floor rejection of a quote closed after it was read, and records it with the move in one write at the current version', async () => {
      const ctx = await queued('floor');
      const raced = withWriteLanding(ctx, 'recordOverrideDecision', closeQuote(ctx, ctx.id), true);
      await expectStaleAndNothingRecorded(ctx, ctx.id, decideFloorNow(raced, ctx.id, 'reject'), {
        status: 'closed_lost',
        overrideApprovedBy: 'bmanager',
      });

      const open = await queued('floor');
      await expectDecidedInOneWrite(
        open,
        open.id,
        () => decideFloorNow(open.service, open.id, 'reject'),
        'rejected',
      );
    });
  });
});

// A service over the same quotes with some repository writes replaced, so a test can make one
// part of an act fail or race it with another writer.
function serviceOver(
  ctx: Awaited<ReturnType<typeof makeService>>,
  replaced: Partial<Record<keyof QuoteRepository, (...args: never[]) => Promise<unknown>>>,
): QuoteService {
  const quotes = new Proxy(ctx.quotes, {
    get(target, prop) {
      const swap = replaced[prop as keyof QuoteRepository];
      if (swap !== undefined) return swap;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new QuoteService({
    quotes,
    pricing: ctx.pricing,
    customers,
    approvals: ctx.approvals,
    orders,
    notifier: ctx.mail.notifier,
    productionManagers: ctx.mail.productionManagers,
    productionNotifier: ctx.mail.productionNotifier,
    leadTimeRequests: ctx.mail.leadTimeRequests,
    taxJurisdictions: new TaxRateService(ctx.taxRates),
    clock: ctx.clock,
  });
}

describe('QuoteService.send - a mail the relay took is never lost', () => {
  it('keeps the quote quoted and reports the send it could not record', async () => {
    const ctx = await makeService();
    const quote = await ctx.service.create({ customerId: CUSTOMER });
    await saveLines(ctx.service, quote.id, [line()]);
    await withLeadTime(ctx.service, quote.id);
    const current = await ctx.service.findById(quote.id);
    const cause = new Error('the database went away');
    const service = serviceOver(ctx, {
      recordSend: async () => {
        throw cause;
      },
    });

    const outcome: unknown = await service
      .send(
        quote.id,
        { lockVersion: current!.lockVersion, confirmRedistribute: false },
        ['buyer@example.com'],
        RENDER,
        'demo-contributor',
      )
      .then(
        () => 'recorded',
        (err: unknown) => err,
      );

    expect(outcome).toMatchObject({
      name: 'QuoteSendNotRecordedError',
      quoteId: quote.id,
      messageId: '<send-1@erp.org.example.test>',
      actor: 'demo-contributor',
      acceptedByRelayAt: RELAY_AT,
      cause,
    });
    expect((await ctx.service.findById(quote.id))?.status).toBe('quoted');
    expect(ctx.mail.sent).toHaveLength(1);
  });
});

describe('QuoteService.revise - the original is checked where it is superseded', () => {
  it('refuses a revision of a quote closed after it was read, and writes nothing', async () => {
    const ctx = await makeService();
    const quote = await ctx.service.create({ customerId: CUSTOMER });
    await saveLines(ctx.service, quote.id, [line()]);
    await withLeadTime(ctx.service, quote.id);
    await moveNow(ctx.service, quote.id, 'quoted');

    // Closes the quote after the service has read it as `quoted`, then lets the revision write.
    const service = serviceOver(ctx, {
      revise: async (...args: Parameters<QuoteRepository['revise']>) => {
        await moveNow(ctx.service, quote.id, 'closed_lost');
        return ctx.quotes.revise(...args);
      },
    });

    await expect(service.revise(quote.id)).rejects.toThrow(QuoteNotRevisableError);

    expect((await ctx.service.findById(quote.id))?.status).toBe('closed_lost');
    expect(await ctx.service.versions(quote.id)).toHaveLength(1);
  });
});

describe('QuoteService.send - a failed first send and its undo', () => {
  const TO = ['buyer@example.com'];

  async function readyDraft(ctx: Awaited<ReturnType<typeof makeService>>) {
    const quote = await ctx.service.create({ customerId: CUSTOMER });
    await saveLines(ctx.service, quote.id, [line({ quantityRolls: 140 })]);
    await withLeadTime(ctx.service, quote.id);
    return (await ctx.service.findById(quote.id))!;
  }

  const sendWith = (service: QuoteService, quote: Quote, render = RENDER) =>
    service
      .send(
        quote.id,
        { lockVersion: quote.lockVersion, confirmRedistribute: false },
        TO,
        render,
        'demo-contributor',
      )
      .then(
        () => 'sent',
        (err: unknown) => err,
      );

  it('puts the quote back when it cannot be read again after its move', async () => {
    const ctx = await makeService();
    const draft = await readyDraft(ctx);
    let moved = false;
    const lost = new Error('the connection pool is closed');
    const service = serviceOver(ctx, {
      transition: async (...args: Parameters<QuoteRepository['transition']>) => {
        moved = true;
        return ctx.quotes.transition(...args);
      },
      findWithLines: async (...args: Parameters<QuoteRepository['findWithLines']>) => {
        if (moved) throw lost;
        return ctx.quotes.findWithLines(...args);
      },
    });

    expect(await sendWith(service, draft)).toBe(lost);

    const after = await ctx.service.findById(draft.id);
    expect(after?.status).toBe('draft');
    expect(after?.updatedAt).toBe(draft.updatedAt);
    expect(ctx.mail.sent).toHaveLength(0);
  });

  it('leaves the quote quoted when it gained an order while the mail was out, and says so', async () => {
    const ctx = await makeService();
    const draft = await readyDraft(ctx);
    const refusal = new Error('the relay did not accept the message');
    ctx.mail.refuseNextSend(refusal);
    // Another user converts the quote while it reads `quoted` and the mail is with the relay.
    const render = async () => {
      convertedQuoteIds.add(draft.id);
      return STORED_QUOTE;
    };

    const outcome = await sendWith(ctx.service, draft, render);

    expect(outcome).toMatchObject({
      name: 'QuoteSendNotUndoneError',
      quoteId: draft.id,
      reason: 'has-order',
      cause: refusal,
    });
    expect((await ctx.service.findById(draft.id))?.status).toBe('quoted');
    expect(await ctx.service.sends(draft.rootQuoteId)).toHaveLength(0);
  });

  it('reports an undo that could not be written, with the failure of the send and of the undo', async () => {
    const ctx = await makeService();
    const draft = await readyDraft(ctx);
    const refusal = new Error('the relay did not accept the message');
    ctx.mail.refuseNextSend(refusal);
    const undoFailure = new Error('the database went away');
    let moves = 0;
    const service = serviceOver(ctx, {
      transition: async (...args: Parameters<QuoteRepository['transition']>) => {
        moves += 1;
        if (moves > 1) throw undoFailure;
        return ctx.quotes.transition(...args);
      },
    });

    const outcome = await sendWith(service, draft);

    expect(outcome).toMatchObject({
      name: 'QuoteSendNotUndoneError',
      quoteId: draft.id,
      reason: 'write-failed',
      cause: refusal,
      undoError: undoFailure,
    });
    expect((await ctx.service.findById(draft.id))?.status).toBe('quoted');
  });
});

describe('QuoteService - a decision is taken only while the quote can still be edited', () => {
  const manualLine = () => line({ overridePricePerRoll: '91.4000' });
  const belowFloorLine = () => line({ overridePricePerRoll: '0.0450' });

  async function expectRefusedUnwritten(
    service: QuoteService,
    id: string,
    decide: () => Promise<unknown>,
    status: QuoteStatus,
  ) {
    const before = await service.findById(id);
    const log = await service.overrideDecisions(id);
    expect(before?.status).toBe(status);

    await expect(decide()).rejects.toMatchObject({
      name: 'QuoteNotEditableError',
      status,
    });

    expect(await service.findById(id)).toEqual(before);
    expect(await service.overrideDecisions(id)).toEqual(log);
  }

  it('refuses a price rejection on a quoted quote', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');

    await expectRefusedUnwritten(
      service,
      quote.id,
      () => decideNow(service, quote.id, 'reject', { reason: 'past the deadline' }),
      'quoted',
    );
  });

  it('refuses a floor rejection on a superseded quote', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [line()]);
    await withLeadTime(service, quote.id);
    await moveNow(service, quote.id, 'quoted');
    await service.revise(quote.id);

    await expectRefusedUnwritten(
      service,
      quote.id,
      () => decideFloorNow(service, quote.id, 'reject'),
      'superseded',
    );
  });

  it('refuses a price approval on a closed quote', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [manualLine()]);
    await moveNow(service, quote.id, 'closed_lost');

    await expectRefusedUnwritten(
      service,
      quote.id,
      () => decideNow(service, quote.id, 'approve'),
      'closed_lost',
    );
  });

  it('refuses a floor override on a closed quote', async () => {
    const { service } = await makeService();
    const quote = await service.create({ customerId: CUSTOMER });
    await saveLines(service, quote.id, [belowFloorLine()]);
    await moveNow(service, quote.id, 'closed_lost');

    await expectRefusedUnwritten(
      service,
      quote.id,
      () => decideFloorNow(service, quote.id, 'approve'),
      'closed_lost',
    );
  });
});
