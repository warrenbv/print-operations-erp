// Every act on a quote: create, revise, price the lines, move it, decide an approval or a floor
// override, set the lead time and send. Roles are checked by the API routes in
// apps/api/src/quoting/quotes.controller.ts, not here. A state-changing call carries the caller's
// `lockVersion`: docs/decisions/006-optimistic-concurrency.md. Persistence sits behind the ports in
// modules/quoting/src/ports.ts.
import { newId } from '@erp/db';
import type {
  AgreedPriceTerms,
  CountAndOldest,
  FloorOverrideDecisionRequest,
  OverrideDecisionRequest,
  PricingBasis,
  Quote,
  QuoteApproval,
  QuoteLine,
  QuoteLineInput,
  QuoteListItem,
  QuoteOverrideDecision,
  QuoteOverrideKind,
  QuoteSend,
  QuoteStatus,
  SetQuoteLeadTimeRequest,
  QuoteTotals,
  QuoteWithLines,
  SendQuoteRequest,
  StoredDocument,
} from '@erp/types';
import {
  INITIAL_QUOTE_STATUS,
  PRINTABLE_QUOTE_STATUSES,
  jurisdictionFitsShipTo,
  toDecimal,
} from '@erp/types';

import { quoteTotals } from '../quote-calculation';
import { assertTransition, canTransition, isEditable } from '../quote-state-machine';
import {
  BelowFloorQuoteError,
  EnteredMarginHandSetPriceError,
  EnteredMarginTierOverrideError,
  LineEnteredMarginBelowFloorError,
  LineEnteredMarginHandSetPriceError,
  LineEnteredMarginTierOverrideError,
  FloorOverrideAlreadyApprovedError,
  NoProductionManagerError,
  NothingBelowFloorError,
  NothingToApproveError,
  OverrideAlreadyApprovedError,
  OverrideNotApprovedError,
  QuoteHasNoRecipientsError,
  QuoteHasOrderError,
  LineJurisdictionMismatchError,
  LinePerPoundHandSetPriceError,
  LinePerPoundNeedsRollWeightError,
  LinePerRollHandSetPoundPriceError,
  LinePerPoundNeedsOrderedWeightError,
  LinePerRollOrderedWeightError,
  PerPoundHandSetPriceError,
  PerPoundNeedsOrderedWeightError,
  PerPoundNeedsRollWeightError,
  PerRollHandSetPoundPriceError,
  PerRollOrderedWeightError,
  WidthNotStockedError,
  QuoteNotEditableError,
  QuoteHasNoLeadTimeError,
  QuoteNeedsLeadTimeError,
  QuoteNotPrintableError,
  CustomerNotOnCreditHoldError,
  CustomerOnCreditHoldError,
  QuoteNotRevisableError,
  QuoteRedistributionNotConfirmedError,
  QuoteSendNotRecordedError,
  QuoteSendNotUndoneError,
  StaleAggregateError,
  CustomerBillingAddressRequiredError,
  UnknownCustomerError,
  UnknownTaxJurisdictionError,
} from '../ports';
import type {
  Clock,
  CustomerLookup,
  LeadTimeRequestLog,
  QuoteApprovalRepository,
  NewQuote,
  NewQuoteLine,
  OrderLookup,
  ProductionManagerNotifier,
  ProductionManagerRecipients,
  ProductionNotified,
  QuoteHeaderPatch,
  QuoteListQuery,
  QuoteNotified,
  QuoteNotifier,
  QuoteRepository,
  TaxJurisdictionLookup,
} from '../ports';
import type { QuotePricingService } from './quote-pricing-service';

export interface QuoteServiceOptions {
  quotes: QuoteRepository;
  pricing: QuotePricingService;
  customers: CustomerLookup;

  approvals?: QuoteApprovalRepository;

  orders: OrderLookup;

  notifier: QuoteNotifier;

  productionManagers: ProductionManagerRecipients;

  productionNotifier: ProductionManagerNotifier;

  leadTimeRequests: LeadTimeRequestLog;

  taxJurisdictions: TaxJurisdictionLookup;
  clock: Clock;
}

interface MoveToUndo {
  status: QuoteStatus;
  updatedAt: Date;
  lockVersion: number;
}

// The decisions a quote in `override_requested` still waits on. A hand-set price owes the Billing
// Manager's approval, docs/product/requirements.md (R7). A line below the floor owes an Admin floor
// override, docs/product/requirements.md (R6). A line at the customer's agreed price owes nothing.
function owedDecisions(quote: Quote, lines: readonly QuoteLine[]): QuoteOverrideKind[] {
  const owed: QuoteOverrideKind[] = [];
  if (quote.overrideApprovedBy === undefined && lines.some((l) => l.priceSource === 'manual')) {
    owed.push('price');
  }
  if (quote.floorOverrideBy === undefined && lines.some((l) => l.floor.status === 'below_floor')) {
    owed.push('floor');
  }
  return owed;
}

// A hand-set price counts as the agreed price only on the same pricing basis and at an equal value.
function atAgreedPrice(
  agreed: AgreedPriceTerms,
  basis: PricingBasis,
  line: Pick<QuoteLineInput, 'overridePricePerRoll' | 'overridePricePerLb'>,
): boolean {
  if (agreed.basis !== basis) {
    return false;
  }
  const typed = basis === 'per_pound' ? line.overridePricePerLb : line.overridePricePerRoll;
  return typed !== undefined && toDecimal(typed).eq(toDecimal(agreed.price));
}

// A check made on a read holds for a write only when the read is at the version the write is
// guarded by. A mismatch is refused as the guarded write would refuse it:
// docs/decisions/006-optimistic-concurrency.md.
function assertReadAt(quote: Quote, expectedLockVersion: number): void {
  if (quote.lockVersion !== expectedLockVersion) {
    throw new StaleAggregateError('quote', quote.id, expectedLockVersion, quote.lockVersion);
  }
}

// A decision is taken only while the lines it answers can still change, in `draft` or
// `override_requested`. The status is read at the version the decision's write is guarded by.
function assertDecidable(quote: Quote): void {
  if (!isEditable(quote.status)) {
    throw new QuoteNotEditableError(quote.id, quote.status);
  }
}

// Whether a decision takes the quote out of the approval queue: it is in the queue and no decision
// is still owed once this one is recorded. It is judged on the read the decision's write is guarded
// by, and the move to draft is part of that same write.
function leavesQueue(read: Quote, stillOwed: readonly QuoteOverrideKind[]): boolean {
  return stillOwed.length === 0 && canTransition(read.status, 'draft');
}

export class QuoteService {
  readonly #quotes: QuoteRepository;
  readonly #pricing: QuotePricingService;
  readonly #customers: CustomerLookup;
  readonly #approvals: QuoteApprovalRepository | undefined;
  readonly #orders: OrderLookup;
  readonly #notifier: QuoteNotifier;
  readonly #productionManagers: ProductionManagerRecipients;
  readonly #productionNotifier: ProductionManagerNotifier;
  readonly #leadTimeRequests: LeadTimeRequestLog;
  readonly #taxJurisdictions: TaxJurisdictionLookup;
  readonly #clock: Clock;

  constructor(options: QuoteServiceOptions) {
    this.#quotes = options.quotes;
    this.#pricing = options.pricing;
    this.#customers = options.customers;
    this.#approvals = options.approvals;
    this.#orders = options.orders;
    this.#notifier = options.notifier;
    this.#productionManagers = options.productionManagers;
    this.#productionNotifier = options.productionNotifier;
    this.#leadTimeRequests = options.leadTimeRequests;
    this.#taxJurisdictions = options.taxJurisdictions;
    this.#clock = options.clock;
  }

  async create(input: NewQuote): Promise<Quote> {
    if (!(await this.#customers.exists(input.customerId))) {
      throw new UnknownCustomerError(input.customerId);
    }

    if (!(await this.#customers.hasBillingAddress(input.customerId))) {
      throw new CustomerBillingAddressRequiredError(input.customerId);
    }

    // A credit hold blocks creation, not sending. A held customer gets a quote only by spending an
    // approved exception in the same transaction as the insert: docs/product/requirements.md (R2).
    const held = !(await this.#customers.mayQuote(input.customerId));

    const now = this.#clock.now();
    const id = newId();
    const row = {
      ...input,
      id,
      status: INITIAL_QUOTE_STATUS,

      rootQuoteId: id,
      versionNumber: 1,

      createdAt: now,
      updatedAt: now,
    };

    if (!held) {
      return this.#quotes.create(row);
    }

    const spent = await this.#quotes.createSpendingApproval(row);
    if (spent === null) {
      throw new CustomerOnCreditHoldError(input.customerId);
    }
    return spent.quote;
  }

  async requestApproval(
    customerId: string,
    input: { reason: string; requestedBy: string },
  ): Promise<QuoteApproval> {
    const approvals = this.#requireApprovals();
    if (!(await this.#customers.exists(customerId))) {
      throw new UnknownCustomerError(customerId);
    }

    if (await this.#customers.mayQuote(customerId)) {
      throw new CustomerNotOnCreditHoldError(customerId);
    }
    return approvals.request({
      id: newId(),
      customerId,
      reason: input.reason,
      requestedBy: input.requestedBy,
      requestedAt: this.#clock.now(),
    });
  }

  async decideApproval(
    id: string,
    decision: { decision: 'approved' | 'rejected'; decidedBy: string; reason?: string },
  ): Promise<QuoteApproval | null> {
    const approvals = this.#requireApprovals();
    const existing = await approvals.findById(id);
    if (existing === null) {
      return null;
    }
    // An exception for a customer no longer on hold is not approved. It would wait unspent and
    // permit a quote under the next hold.
    if (decision.decision === 'approved' && (await this.#customers.mayQuote(existing.customerId))) {
      throw new CustomerNotOnCreditHoldError(existing.customerId);
    }
    return approvals.decide(id, {
      decision: decision.decision,
      decidedBy: decision.decidedBy,
      decidedAt: this.#clock.now(),
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    });
  }

  async listPendingApprovals(): Promise<readonly QuoteApproval[]> {
    return this.#requireApprovals().listPending();
  }

  async listApprovalsForCustomer(customerId: string): Promise<readonly QuoteApproval[]> {
    return this.#requireApprovals().listForCustomer(customerId);
  }

  #requireApprovals(): QuoteApprovalRepository {
    if (this.#approvals === undefined) {
      throw new Error('QuoteService has no approval repository wired');
    }
    return this.#approvals;
  }

  async versions(quoteId: string): Promise<readonly Quote[]> {
    const quote = await this.#quotes.findById(quoteId);
    return quote === null ? [] : this.#quotes.versions(quote.rootQuoteId);
  }

  async revise(quoteId: string, input: { notes?: string } = {}): Promise<QuoteWithLines | null> {
    const original = await this.#quotes.findWithLines(quoteId);
    if (original === null) {
      return null;
    }

    // Only a sent quote is revised. The next version is a new draft and the original becomes
    // `superseded` in the same repository call, which checks the status again and the version read
    // here, so the lines copied are the lines of the quote superseded.
    if (original.status !== 'quoted') {
      throw new QuoteNotRevisableError(quoteId, original.status);
    }

    if (!(await this.#customers.hasBillingAddress(original.customerId))) {
      throw new CustomerBillingAddressRequiredError(original.customerId);
    }

    // A credit hold blocks a revision as it blocks a new quote: docs/product/requirements.md (R2).
    if (!(await this.#customers.mayQuote(original.customerId))) {
      throw new CustomerOnCreditHoldError(original.customerId);
    }

    const now = this.#clock.now();
    const nextId = newId();

    // The lines are copied with their stored prices. They are priced again when Sales next saves
    // them.
    const lines: NewQuoteLine[] = original.lines.map((line) => ({ ...line, id: newId() }));

    return this.#quotes.revise(
      quoteId,
      {
        customerId: original.customerId,
        ...(original.salesRep === undefined ? {} : { salesRep: original.salesRep }),

        ...(input.notes !== undefined
          ? { notes: input.notes }
          : original.notes === undefined
            ? {}
            : { notes: original.notes }),

        freightInRollPrice: original.freightInRollPrice,
        id: nextId,
        status: INITIAL_QUOTE_STATUS,
        rootQuoteId: original.rootQuoteId,
        versionNumber: original.versionNumber + 1,

        quoteNumber: original.quoteNumber,
        createdAt: now,
        updatedAt: now,
      },
      lines,
      now,
      original.lockVersion,
    );
  }

  async findById(id: string): Promise<Quote | null> {
    return this.#quotes.findById(id);
  }

  async findWithLines(id: string): Promise<QuoteWithLines | null> {
    return this.#quotes.findWithLines(id);
  }

  async list(params: QuoteListQuery = {}): Promise<readonly QuoteListItem[]> {
    const { converted, ...filters } = params;
    if (converted === undefined) return this.#quotes.list(filters);

    // Orders belong to another module, so `converted: false` filters here after the query. The
    // limit is applied after that filter so it counts only open quotes.
    const { limit, ...uncut } = filters;
    const open = await this.#withoutOrders(await this.#quotes.list(uncut));
    return limit === undefined ? open : open.slice(0, limit);
  }

  async countAndOldest(
    params: Omit<QuoteListQuery, 'sort' | 'limit'> = {},
  ): Promise<CountAndOldest<Quote>> {
    const { converted, ...filters } = params;
    if (converted === undefined) return this.#quotes.countAndOldest(filters);
    const open = await this.#withoutOrders(await this.#quotes.list({ ...filters, sort: 'oldest' }));
    const [oldest] = open;
    return { count: open.length, oldest: oldest ?? null };
  }

  async #withoutOrders<T extends Quote>(rows: readonly T[]): Promise<readonly T[]> {
    if (rows.length === 0) return rows;
    const converted = new Set(await this.#orders.quoteIdsWithOrders(rows.map((row) => row.id)));
    return rows.filter((row) => !converted.has(row.id));
  }

  async setLines(
    quoteId: string,
    requests: readonly QuoteLineInput[],
    expectedLockVersion: number,
    header: QuoteHeaderPatch = {},
  ): Promise<QuoteWithLines | null> {
    const quote = await this.#quotes.findById(quoteId);
    if (quote === null) {
      return null;
    }
    if (!isEditable(quote.status)) {
      throw new QuoteNotEditableError(quoteId, quote.status);
    }

    // Every check runs before anything is written, so a refused save leaves the stored lines as
    // they were. A line's tax jurisdiction must fit its delivery state, or the billing state when
    // the line has no delivery address, and must have a loaded rate.
    // Each line carries its tax treatment: docs/product/requirements.md (R4).
    const billingState = await this.#customers.billingState(quote.customerId);

    for (const [index, request] of requests.entries()) {
      const shipToState = request.deliveryAddress?.state ?? billingState;
      const { taxJurisdiction } = request.taxTreatment;
      if (
        taxJurisdiction !== undefined &&
        shipToState !== undefined &&
        !jurisdictionFitsShipTo(taxJurisdiction, shipToState)
      ) {
        throw new LineJurisdictionMismatchError(index + 1, taxJurisdiction, shipToState);
      }
    }

    const known = new Map<string, boolean>();
    for (const [index, request] of requests.entries()) {
      const { taxJurisdiction } = request.taxTreatment;
      if (taxJurisdiction === undefined) continue;
      let loaded = known.get(taxJurisdiction);
      if (loaded === undefined) {
        loaded = await this.#taxJurisdictions.isLoaded(taxJurisdiction);
        known.set(taxJurisdiction, loaded);
      }
      if (!loaded) {
        throw new UnknownTaxJurisdictionError(index + 1, taxJurisdiction);
      }
    }

    const now = this.#clock.now();
    const lines: NewQuoteLine[] = [];

    const agreedByPart = new Map<string, AgreedPriceTerms | null>();

    for (const [index, request] of requests.entries()) {
      const stocked = await this.#pricing.isStockWidth(request.gradeId, request.rollWidthIn);
      // A width the grade does not stock is accepted only with the line's custom-width flag.
      if (stocked === false && request.customWidth !== true) {
        throw new WidthNotStockedError(index + 1, request.gradeId, request.rollWidthIn);
      }

      // The pricing errors carry no line number. They are raised again with the line's number.
      let priced;
      try {
        priced = await this.#pricing.priceLine(request);
      } catch (err) {
        if (err instanceof PerPoundNeedsRollWeightError) {
          throw new LinePerPoundNeedsRollWeightError(index + 1, request.gradeId);
        }
        if (err instanceof PerPoundHandSetPriceError) {
          throw new LinePerPoundHandSetPriceError(index + 1);
        }
        if (err instanceof PerRollHandSetPoundPriceError) {
          throw new LinePerRollHandSetPoundPriceError(index + 1);
        }
        if (err instanceof PerPoundNeedsOrderedWeightError) {
          throw new LinePerPoundNeedsOrderedWeightError(index + 1);
        }
        if (err instanceof PerRollOrderedWeightError) {
          throw new LinePerRollOrderedWeightError(index + 1);
        }
        if (err instanceof EnteredMarginHandSetPriceError) {
          throw new LineEnteredMarginHandSetPriceError(index + 1);
        }
        if (err instanceof EnteredMarginTierOverrideError) {
          throw new LineEnteredMarginTierOverrideError(index + 1);
        }
        throw err;
      }
      if (priced === null) {
        return null;
      }

      // A margin entered by hand below the floor is refused at save, not left for the send check.
      if (request.marginOverridePct !== undefined && priced.floor.status === 'below_floor') {
        throw new LineEnteredMarginBelowFloorError(
          index + 1,
          request.marginOverridePct,
          priced.floor.floorPct,
        );
      }

      // A hand-set price equal to the customer's agreed price for this grade and width is stored as
      // `agreed`, which owes no Billing Manager approval.
      let priceSource = priced.priceSource;
      if (priceSource === 'manual') {
        const key = `${request.gradeId.toLowerCase()}|${String(request.rollWidthIn)}`;
        let agreed = agreedByPart.get(key);
        if (agreed === undefined) {
          agreed =
            (await this.#customers.agreedPrice(
              quote.customerId,
              request.gradeId,
              request.rollWidthIn,
            )) ?? null;
          agreedByPart.set(key, agreed);
        }
        if (agreed !== null && atAgreedPrice(agreed, priced.pricingBasis, request)) {
          priceSource = 'agreed';
        }
      }

      lines.push({
        id: newId(),
        lineNumber: index + 1,

        gradeId: request.gradeId,
        footageVariant: request.footageVariant,
        rollWidthIn: request.rollWidthIn,

        customWidth: stocked === false,
        quantityRolls: request.quantityRolls,
        overwrap: request.overwrap,

        pricingBasis: priced.pricingBasis,

        ...(priced.orderedWeightLb === undefined
          ? {}
          : { orderedWeightLb: priced.orderedWeightLb }),

        revenueCategory: request.revenueCategory,

        printed: request.printed,

        ...(request.customerPartNumber === undefined
          ? {}
          : { customerPartNumber: request.customerPartNumber }),
        ...(request.customerDescription === undefined
          ? {}
          : { customerDescription: request.customerDescription }),
        taxStatus: request.taxTreatment.taxStatus,
        ...(request.taxTreatment.taxJurisdiction === undefined
          ? {}
          : { taxJurisdiction: request.taxTreatment.taxJurisdiction }),
        ...(request.feetPerRollOverride === undefined
          ? {}
          : { feetPerRollOverride: request.feetPerRollOverride }),
        ...(request.convertCostPerTon === undefined
          ? {}
          : { convertCostPerTon: request.convertCostPerTon }),
        ...(request.printCostPerTon === undefined
          ? {}
          : { printCostPerTon: request.printCostPerTon }),
        ...(request.tierOverrideCode === undefined
          ? {}
          : { tierOverrideCode: request.tierOverrideCode }),
        ...(request.overridePricePerRoll === undefined
          ? {}
          : { overridePricePerRoll: request.overridePricePerRoll }),

        ...(request.overridePricePerLb === undefined
          ? {}
          : { overridePricePerLb: request.overridePricePerLb }),

        ...(request.marginOverridePct === undefined
          ? {}
          : { marginOverridePct: request.marginOverridePct }),

        freight: request.freight,
        freightResult: priced.freight,

        ...(request.deliveryAddress === undefined
          ? {}
          : { deliveryAddress: request.deliveryAddress }),

        cost: priced.cost,

        tier: {
          id: priced.tier.tier.id,
          code: priced.tier.tier.code,
          name: priced.tier.tier.name,
          marginPct: priced.tier.tier.marginPct,
          source: priced.tier.source,
        },
        pallets: priced.pallets,

        basePricePerRoll: priced.basePricePerRoll,
        pricePerRoll: priced.pricePerRoll,
        priceSource,

        ...(priced.marginPricePerRoll === undefined
          ? {}
          : { marginPricePerRoll: priced.marginPricePerRoll }),
        deliveredPricePerRoll: priced.deliveredPricePerRoll,

        marginPct: priced.marginPct,
        floor: priced.floor,

        extendedPrice: priced.extendedPrice,
        extendedCost: priced.extendedCost,
        extendedMargin: priced.extendedMargin,

        estimatedWeightLb: priced.estimatedWeightLb,
        pricePerLb: priced.pricePerLb,
        effectivePricePerLb: priced.effectivePricePerLb,

        ...(priced.basePricePerLb === undefined ? {} : { basePricePerLb: priced.basePricePerLb }),
        ...(priced.productPricePerLb === undefined
          ? {}
          : { productPricePerLb: priced.productPricePerLb }),
      });
    }

    // The checks above were made on the version read. They hold for the write only when that is
    // the version the write is guarded by.
    assertReadAt(quote, expectedLockVersion);

    // Editing the lines revokes a live price approval, docs/product/requirements.md (R7), and a
    // live floor override, docs/product/requirements.md (R6). A quote waiting in the approval queue
    // returns to draft: docs/decisions/006-optimistic-concurrency.md. The repository does all of it
    // in the write that saves the lines, and logs only the entries for decisions live on the row it
    // holds: modules/quoting/src/ports.ts.
    const at = now.toISOString();
    return this.#quotes.replaceLines(quoteId, lines, now, expectedLockVersion, header, {
      price: {
        id: newId(),
        actor: 'system:edit',
        reason: 'quote lines were changed after approval',
        at,
      },
      floor: {
        id: newId(),
        actor: 'system:edit',
        reason: 'quote lines were changed after the floor was overridden',
        at,
      },
    });
  }

  async transition(
    id: string,
    to: QuoteStatus,
    expectedLockVersion: number,
    actor: string,
  ): Promise<Quote | null> {
    const quote = await this.#quotes.findById(id);
    if (quote === null) {
      return null;
    }

    await this.#assertMayMove(quote, to);

    if (to === 'closed_lost' && (await this.#orders.existsForQuote(id))) {
      throw new QuoteHasOrderError(id);
    }

    const now = this.#clock.now();

    let log: Omit<QuoteOverrideDecision, 'quoteId'>[] = [];
    // The request logs one `requested` entry for each decision still owed.
    if (to === 'override_requested') {
      const withLines = await this.#quotes.findWithLines(id);
      log = owedDecisions(quote, withLines?.lines ?? []).map((kind) => ({
        id: newId(),
        decision: 'requested',
        kind,
        actor,
        at: now.toISOString(),
      }));
    }

    // The gates were checked on the version read, so the move is written only at that version.
    assertReadAt(quote, expectedLockVersion);
    return this.#quotes.transition(id, to, now, expectedLockVersion, log);
  }

  async #assertMayMove(quote: Quote, to: QuoteStatus): Promise<void> {
    const id = quote.id;
    assertTransition(quote.status, to);

    // Every move to `quoted` passes three gates. No line below the floor without an Admin override,
    // docs/product/requirements.md (R6). A live approval for any hand-set price,
    // docs/product/requirements.md (R7). A lead time, docs/product/requirements.md (R5).
    if (to === 'quoted') {
      const offending = await this.#unreleasedBelowFloorLines(id);
      if (offending.length > 0) {
        throw new BelowFloorQuoteError(id, offending);
      }
    }

    if (to === 'quoted') {
      const unapproved = await this.#unapprovedOverrideLines(id);
      if (unapproved.length > 0) {
        throw new OverrideNotApprovedError(id, unapproved);
      }
    }

    if (to === 'quoted' && quote.leadTimeDays === undefined) {
      throw new QuoteNeedsLeadTimeError(id);
    }
  }

  async #unapprovedOverrideLines(quoteId: string): Promise<number[]> {
    const quote = await this.#quotes.findWithLines(quoteId);
    if (quote === null || quote.overrideApprovedBy !== undefined) {
      return [];
    }
    return quote.lines.filter((l) => l.priceSource === 'manual').map((l) => l.lineNumber);
  }

  /**
   * Records the Billing Manager's approval of the quote's hand-set prices at the `lockVersion` the
   * approver was shown, so an approval always applies to the figures that were read. A quote edited
   * since then fails with `StaleAggregateError`: docs/decisions/006-optimistic-concurrency.md.
   */
  async approveOverride(id: string, request: OverrideDecisionRequest): Promise<Quote | null> {
    const quote = await this.#quotes.findWithLines(id);
    if (quote === null) {
      return null;
    }
    if (!quote.lines.some((l) => l.priceSource === 'manual')) {
      throw new NothingToApproveError(id);
    }

    if (quote.overrideApprovedBy !== undefined) {
      throw new OverrideAlreadyApprovedError(id, quote.overrideApprovedBy);
    }
    assertDecidable(quote);
    assertReadAt(quote, request.lockVersion);

    const now = this.#clock.now();

    return this.#quotes.recordOverrideDecision(
      id,
      { by: request.actor, at: now },
      {
        id: newId(),
        decision: 'approved',
        kind: 'price',
        actor: request.actor,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        at: now.toISOString(),
      },
      now,
      request.lockVersion,
      leavesQueue(
        quote,
        owedDecisions({ ...quote, overrideApprovedBy: request.actor }, quote.lines),
      ),
    );
  }

  async rejectOverride(
    id: string,
    request: OverrideDecisionRequest & { reason: string },
  ): Promise<Quote | null> {
    const quote = await this.#quotes.findById(id);
    if (quote === null) {
      return null;
    }
    if (quote.overrideApprovedBy !== undefined) {
      throw new OverrideAlreadyApprovedError(id, quote.overrideApprovedBy);
    }
    assertDecidable(quote);
    assertReadAt(quote, request.lockVersion);

    const now = this.#clock.now();
    return this.#quotes.recordOverrideDecision(
      id,
      null,
      {
        id: newId(),
        decision: 'rejected',
        kind: 'price',
        actor: request.actor,
        reason: request.reason,
        at: now.toISOString(),
      },
      now,
      request.lockVersion,
      leavesQueue(quote, []),
    );
  }

  /**
   * Records an Admin's override of the margin floor on this one quote, with its reason. It releases
   * every below-floor line until the lines are edited: docs/product/requirements.md (R6).
   */
  async approveFloorOverride(
    id: string,
    request: FloorOverrideDecisionRequest,
  ): Promise<Quote | null> {
    const quote = await this.#quotes.findWithLines(id);
    if (quote === null) {
      return null;
    }
    if (!quote.lines.some((l) => l.floor.status === 'below_floor')) {
      throw new NothingBelowFloorError(id);
    }
    if (quote.floorOverrideBy !== undefined) {
      throw new FloorOverrideAlreadyApprovedError(id, quote.floorOverrideBy);
    }
    assertDecidable(quote);
    assertReadAt(quote, request.lockVersion);

    const now = this.#clock.now();

    return this.#quotes.recordOverrideDecision(
      id,
      { by: request.actor, at: now },
      {
        id: newId(),
        decision: 'approved',
        kind: 'floor',
        actor: request.actor,
        reason: request.reason,
        at: now.toISOString(),
      },
      now,
      request.lockVersion,
      leavesQueue(quote, owedDecisions({ ...quote, floorOverrideBy: request.actor }, quote.lines)),
    );
  }

  async rejectFloorOverride(
    id: string,
    request: FloorOverrideDecisionRequest,
  ): Promise<Quote | null> {
    const quote = await this.#quotes.findById(id);
    if (quote === null) {
      return null;
    }
    if (quote.floorOverrideBy !== undefined) {
      throw new FloorOverrideAlreadyApprovedError(id, quote.floorOverrideBy);
    }
    assertDecidable(quote);
    assertReadAt(quote, request.lockVersion);

    const now = this.#clock.now();
    return this.#quotes.recordOverrideDecision(
      id,
      null,
      {
        id: newId(),
        decision: 'rejected',
        kind: 'floor',
        actor: request.actor,
        reason: request.reason,
        at: now.toISOString(),
      },
      now,
      request.lockVersion,
      leavesQueue(quote, []),
    );
  }

  async overrideDecisions(id: string): Promise<readonly QuoteOverrideDecision[]> {
    return this.#quotes.overrideDecisions(id);
  }

  // The lines that block a send under docs/product/requirements.md (R6). A live floor override
  // releases them all.
  async #unreleasedBelowFloorLines(
    quoteId: string,
  ): Promise<{ lineNumber: number; minimumPricePerRoll: string }[]> {
    const quote = await this.#quotes.findWithLines(quoteId);
    if (quote === null || quote.floorOverrideBy !== undefined) {
      return [];
    }
    return quote.lines
      .filter((line) => line.floor.status === 'below_floor')
      .map((line) => ({
        lineNumber: line.lineNumber,

        minimumPricePerRoll:
          // The repeated test narrows the union for TypeScript. The `'0'` branch is never taken.
          line.floor.status === 'below_floor' ? line.floor.minimumPricePerRoll : '0',
      }));
  }

  /**
   * Returns a quote fit for a client document: `quoted` or `superseded`, and still passing the
   * floor, approval and lead-time gates. Each failure throws its own error from
   * modules/quoting/src/ports.ts.
   */
  async printableQuote(id: string): Promise<QuoteWithLines | null> {
    const quote = await this.#quotes.findWithLines(id);
    if (quote === null) {
      return null;
    }

    if (!PRINTABLE_QUOTE_STATUSES.includes(quote.status)) {
      throw new QuoteNotPrintableError(id, quote.status);
    }

    const offending = await this.#unreleasedBelowFloorLines(id);
    if (offending.length > 0) {
      throw new BelowFloorQuoteError(id, offending);
    }

    const unapproved = await this.#unapprovedOverrideLines(id);
    if (unapproved.length > 0) {
      throw new OverrideNotApprovedError(id, unapproved);
    }

    if (quote.leadTimeDays === undefined) {
      throw new QuoteHasNoLeadTimeError(id);
    }

    return quote;
  }

  async setLeadTime(
    id: string,
    request: SetQuoteLeadTimeRequest,
    setBy: string,
  ): Promise<Quote | null> {
    const quote = await this.#quotes.findById(id);
    if (quote === null) {
      return null;
    }
    if (!isEditable(quote.status)) {
      throw new QuoteNotEditableError(id, quote.status);
    }
    assertReadAt(quote, request.lockVersion);

    // Who may enter the lead time is checked by the API: docs/product/requirements.md (R5).
    return this.#quotes.setLeadTime(
      id,
      request.leadTimeDays,
      setBy,
      this.#clock.now(),
      request.lockVersion,
    );
  }

  /**
   * Runs every check a send makes, without writing: the gates, the caller's `lockVersion`, the
   * recipients and the confirmation to send a chain again.
   */
  async sendPrecheck(
    id: string,
    request: SendQuoteRequest,
    recipients: readonly string[],
  ): Promise<QuoteWithLines | null> {
    const quote = await this.#sendableQuote(id);
    if (quote === null) {
      return null;
    }

    if (quote.lockVersion !== request.lockVersion) {
      throw new StaleAggregateError('quote', id, request.lockVersion, quote.lockVersion);
    }

    // The recipients are the customer's contacts tagged for quotes, supplied by the API. With none
    // the quote cannot be sent: docs/product/requirements.md (R1).
    if (recipients.length === 0) {
      throw new QuoteHasNoRecipientsError(id, quote.customerId);
    }

    // A chain that has already gone to the customer is sent again only when the caller confirms it.
    const priorSends = await this.#quotes.sendsForChain(quote.rootQuoteId);
    if (priorSends.length > 0 && !request.confirmRedistribute) {
      throw new QuoteRedistributionNotConfirmedError(id, priorSends);
    }

    return quote;
  }

  async #sendableQuote(id: string): Promise<QuoteWithLines | null> {
    const quote = await this.#quotes.findWithLines(id);
    if (quote === null) {
      return null;
    }
    // A quote that cannot move to `quoted` is a resend. It meets the printable-document checks
    // instead.
    if (!canTransition(quote.status, 'quoted')) {
      return this.printableQuote(id);
    }
    await this.#assertMayMove(quote, 'quoted');
    return quote;
  }

  async recordSend(
    quoteId: string,
    submission: {
      messageId: string;
      actor: string;
      acceptedByRelayAt: Date;
    },
  ): Promise<QuoteSend> {
    return this.#quotes.recordSend({
      id: newId(),
      quoteId,
      messageId: submission.messageId,
      actor: submission.actor,
      acceptedByRelayAt: submission.acceptedByRelayAt,
    });
  }

  async send(
    id: string,
    request: SendQuoteRequest,
    recipients: readonly string[],
    render: () => Promise<StoredDocument>,
    actor: string,
  ): Promise<QuoteSend | null> {
    let quote = await this.sendPrecheck(id, request, recipients);
    if (quote === null) {
      return null;
    }

    // The quote moves to `quoted` before the document renders and is read again, so the document
    // and the email carry the moved quote. A failure to read it again or to render, or a mail the
    // relay does not accept, undoes the move.
    let undo: MoveToUndo | undefined;
    if (canTransition(quote.status, 'quoted')) {
      const moved = await this.#quotes.transition(
        id,
        'quoted',
        this.#clock.now(),
        request.lockVersion,
      );
      if (moved === null) {
        return null;
      }
      undo = {
        status: quote.status,
        updatedAt: new Date(quote.updatedAt),
        lockVersion: moved.lockVersion,
      };
    }

    let notified: QuoteNotified;
    try {
      if (undo !== undefined) {
        const reread = await this.#quotes.findWithLines(id);
        if (reread === null) {
          return null;
        }
        quote = reread;
      }
      const document = await render();
      notified = await this.#notifier.quoteSent(quote, document, recipients, actor);
    } catch (err) {
      if (undo !== undefined) {
        await this.#undoMove(id, undo, err);
      }
      throw err;
    }

    // The relay has the email and it cannot be recalled, so the quote stays sent. A record that
    // cannot be written fails the send loudly, carrying the record it would have held.
    const submission = {
      messageId: notified.messageId,
      actor,
      acceptedByRelayAt: notified.acceptedByRelayAt,
    };
    try {
      return await this.recordSend(id, submission);
    } catch (err) {
      throw new QuoteSendNotRecordedError(id, submission, err);
    }
  }

  // Puts the quote back as it was before the move, at the version the move wrote, so it restores
  // nothing over another write. A quote that gained an order meanwhile stays `quoted`, because a
  // draft with an order would break docs/product/requirements.md (R10). When the quote is not put back the send's
  // failure is rethrown inside `QuoteSendNotUndoneError`, so the caller can say so.
  async #undoMove(id: string, undo: MoveToUndo, cause: unknown): Promise<void> {
    try {
      if (await this.#orders.existsForQuote(id)) {
        throw new QuoteSendNotUndoneError(id, 'has-order', cause);
      }
      await this.#quotes.transition(id, undo.status, undo.updatedAt, undo.lockVersion);
    } catch (undoError) {
      if (undoError instanceof QuoteSendNotUndoneError) throw undoError;
      throw new QuoteSendNotUndoneError(id, 'write-failed', cause, undoError);
    }
  }

  /**
   * Tells every Production Manager that a quote went to the customer, so the work is visible before
   * the PO arrives: docs/product/roles.md. With no holder of the role who has an email address it
   * fails with `NoProductionManagerError`.
   */
  async notifyProductionManagers(send: QuoteSend): Promise<ProductionNotified | null> {
    const quote = await this.#quotes.findWithLines(send.quoteId);
    if (quote === null) {
      return null;
    }

    const { emails, withoutEmail } = await this.#productionManagers.audience();
    if (emails.length === 0) {
      throw new NoProductionManagerError(quote.id, withoutEmail);
    }

    return this.#productionNotifier.quoteSentToCustomer(quote, send, emails);
  }

  /**
   * Asks the Production Managers for a lead time, once per quote, when an editable quote with lines
   * has none: docs/product/requirements.md (R5). Returns null when there is nothing to ask.
   */
  async askProductionForLeadTime(
    quoteId: string,
    actor: string,
  ): Promise<ProductionNotified | null> {
    const quote = await this.#quotes.findWithLines(quoteId);
    if (
      quote === null ||
      (quote.status !== 'draft' && quote.status !== 'override_requested') ||
      quote.leadTimeDays !== undefined ||
      quote.lines.length === 0
    ) {
      return null;
    }
    if (await this.#leadTimeRequests.alreadyAsked(quote.id)) {
      return null;
    }

    const { emails, withoutEmail } = await this.#productionManagers.audience();
    if (emails.length === 0) {
      throw new NoProductionManagerError(quote.id, withoutEmail, 'lead-time-request');
    }

    return this.#productionNotifier.leadTimeNeeded(quote, emails, actor);
  }

  async sends(rootQuoteId: string): Promise<readonly QuoteSend[]> {
    return this.#quotes.sendsForChain(rootQuoteId);
  }

  /** Reports the margin floor gate only, with each blocking line's minimum price per roll. */
  async sendability(id: string): Promise<
    | { sendable: true }
    | {
        sendable: false;
        belowFloor: readonly { lineNumber: number; minimumPricePerRoll: string }[];
      }
    | null
  > {
    const quote = await this.#quotes.findById(id);
    if (quote === null) {
      return null;
    }
    const offending = await this.#unreleasedBelowFloorLines(id);
    return offending.length === 0 ? { sendable: true } : { sendable: false, belowFloor: offending };
  }

  async totals(id: string): Promise<QuoteTotals | null> {
    const quote = await this.#quotes.findWithLines(id);
    return quote === null ? null : quoteTotals(quote.lines);
  }
}
