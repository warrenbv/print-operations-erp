// The ports quoting declares and the domain errors its services and adapters raise.
// What quoting needs from customers, orders, identity and notifications is declared here in its own
// terms and supplied by the API composition root: docs/decisions/001-modular-monorepo.md.
// Each repository port has an in-memory and a Drizzle adapter under modules/quoting/src/adapters/,
// held to one contract suite in modules/quoting/test/contracts/.
import type {
  AgreedPriceTerms,
  CountAndOldest,
  CreatePricingTierRequest,
  Grade,
  GradeFootage,
  GradeWidth,
  PalletFit,
  PricingConfig,
  PricingConfigChange,
  PricingTier,
  PricingTierChange,
  ProductFamily,
  Quote,
  QuoteApproval,
  QuoteApprovalStatus,
  QuoteLine,
  QuoteListItem,
  QuoteOverrideDecision,
  QuoteOverrideKind,
  QuoteSend,
  QuoteStatus,
  QuoteWithLines,
  QueueSort,
  StoredDocument,
  UpdatePricingTierRequest,
} from '@erp/types';

import { formatRatePercent, formatWidthIn, jurisdictionShipToRefusal } from '@erp/types';

export interface Clock {
  now(): Date;
}

export interface NewGrade {
  productFamily: ProductFamily;
  code: string;
  basisWeightLb: string;

  reamAreaDivisor: string;
  paperCostPerTonne: string;
  footages: readonly GradeFootage[];

  widths?: readonly GradeWidth[];
}

export interface GradePatch {
  code?: string;
  basisWeightLb?: string;
  reamAreaDivisor?: string;
  paperCostPerTonne?: string;

  footages?: readonly GradeFootage[];

  widths?: readonly GradeWidth[];
}

export interface GradeListParams {
  productFamily?: ProductFamily;
}

export class DuplicateGradeCodeError extends Error {
  readonly productFamily: string;
  readonly code: string;
  constructor(productFamily: string, code: string) {
    super(`grade "${code}" already exists in the ${productFamily} family`);
    this.name = 'DuplicateGradeCodeError';
    this.productFamily = productFamily;
    this.code = code;
  }
}

export class DuplicateFootageVariantError extends Error {
  readonly variant: string;
  constructor(variant: string) {
    super(`footage variant "${variant}" is listed more than once`);
    this.name = 'DuplicateFootageVariantError';
    this.variant = variant;
  }
}

export class DuplicateStockWidthError extends Error {
  readonly rollWidthIn: number;
  constructor(rollWidthIn: number) {
    super(`stock width ${formatWidthIn(rollWidthIn)} is listed more than once`);
    this.name = 'DuplicateStockWidthError';
    this.rollWidthIn = rollWidthIn;
  }
}

// A grade is an aggregate with its footages and stock widths. Writes to either bump the grade's
// `lockVersion`: docs/decisions/006-optimistic-concurrency.md.
export interface GradeRepository {
  create(input: NewGrade & { id: string; createdAt: Date; updatedAt: Date }): Promise<Grade>;
  findById(id: string): Promise<Grade | null>;

  list(params: GradeListParams): Promise<readonly Grade[]>;

  update(
    id: string,
    patch: GradePatch,
    updatedAt: Date,
    expectedLockVersion?: number,
  ): Promise<Grade | null>;
}

export interface PricingConfigRepository {
  get(): Promise<PricingConfig>;

  update(patch: Partial<Omit<PricingConfig, 'updatedAt'>>, updatedAt: Date): Promise<PricingConfig>;

  history(limit: number): Promise<readonly PricingConfigChange[]>;
}

/**
 * The actor written on a pricing configuration or tier change row. A missing or blank name is
 * recorded as `unknown` so the change row is always written.
 */
export function pricingConfigActor(updatedBy: unknown): string {
  return typeof updatedBy === 'string' && updatedBy !== '' ? updatedBy : 'unknown';
}

export class UnknownFootageVariantError extends Error {
  readonly gradeId: string;
  readonly variant: string;
  constructor(gradeId: string, variant: string) {
    super(`grade ${gradeId} has no footage variant "${variant}"`);
    this.name = 'UnknownFootageVariantError';
    this.gradeId = gradeId;
    this.variant = variant;
  }
}

export class FootageVariantInUseError extends Error {
  readonly gradeId: string;
  readonly variant: string;
  readonly lines: readonly { quoteId: string; lineNumber: number }[];
  constructor(
    gradeId: string,
    variant: string,
    lines: readonly { quoteId: string; lineNumber: number }[],
  ) {
    super(
      `footage variant "${variant}" on grade ${gradeId} is used by ${lines.length} draft quote line(s)`,
    );
    this.name = 'FootageVariantInUseError';
    this.gradeId = gradeId;
    this.variant = variant;
    this.lines = lines;
  }
}

export class StockWidthInUseError extends Error {
  readonly gradeId: string;
  readonly rollWidthIn: number;
  readonly lines: readonly { quoteId: string; lineNumber: number }[];
  constructor(
    gradeId: string,
    rollWidthIn: number,
    lines: readonly { quoteId: string; lineNumber: number }[],
  ) {
    super(
      `stock width ${formatWidthIn(rollWidthIn)} on grade ${gradeId} is used by ${lines.length} draft quote line(s)`,
    );
    this.name = 'StockWidthInUseError';
    this.gradeId = gradeId;
    this.rollWidthIn = rollWidthIn;
    this.lines = lines;
  }
}

export class WidthNotStockedError extends Error {
  readonly lineNumber: number;
  readonly gradeId: string;
  readonly rollWidthIn: number;
  constructor(lineNumber: number, gradeId: string, rollWidthIn: number) {
    super(
      `line ${String(lineNumber)}: the paper is not stocked in ${formatWidthIn(rollWidthIn)} - ` +
        'pick one of its widths, or tick Custom width?',
    );
    this.name = 'WidthNotStockedError';
    this.lineNumber = lineNumber;
    this.gradeId = gradeId;
    this.rollWidthIn = rollWidthIn;
  }
}

export class NoPalletFitForWidthError extends Error {
  readonly productFamily: string;
  readonly rollWidthIn: number;
  constructor(productFamily: string, rollWidthIn: number) {
    super(`no ${productFamily} pallet fit is defined at or below ${formatWidthIn(rollWidthIn)}`);
    this.name = 'NoPalletFitForWidthError';
    this.productFamily = productFamily;
    this.rollWidthIn = rollWidthIn;
  }
}

export interface PalletFitRepository {
  list(productFamily: ProductFamily): Promise<readonly PalletFit[]>;
}

export class UnknownTierCodeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`no pricing tier with code "${code}"`);
    this.name = 'UnknownTierCodeError';
    this.code = code;
  }
}

export class NoTierForVolumeError extends Error {
  readonly pallets: number;
  constructor(pallets: number) {
    super(`no pricing tier applies at ${pallets} pallet(s)`);
    this.name = 'NoTierForVolumeError';
    this.pallets = pallets;
  }
}

export class DuplicateTierThresholdError extends Error {
  readonly minPallets: number;
  constructor(minPallets: number) {
    super(`another pricing tier already starts at ${minPallets} pallet(s)`);
    this.name = 'DuplicateTierThresholdError';
    this.minPallets = minPallets;
  }
}

export class DuplicateTierCodeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`a pricing tier with code "${code}" already exists`);
    this.name = 'DuplicateTierCodeError';
    this.code = code;
  }
}

export class NoZeroThresholdTierError extends Error {
  constructor() {
    super('the tier table must keep a tier starting at 0 pallets');
    this.name = 'NoZeroThresholdTierError';
  }
}

export interface PricingTierRepository {
  list(): Promise<readonly PricingTier[]>;
  findByCode(code: string): Promise<PricingTier | null>;

  create(request: CreatePricingTierRequest, createdBy: string, at: Date): Promise<PricingTier>;

  update(
    code: string,
    patch: UpdatePricingTierRequest,
    updatedAt: Date,
    updatedBy: string,
  ): Promise<PricingTier | null>;

  history(limit: number): Promise<readonly PricingTierChange[]>;
}

// What quoting asks of the CRM module. The API wires it in apps/api/src/quoting/quoting.factory.ts.
export interface CustomerLookup {
  exists(customerId: string): Promise<boolean>;

  // False while the customer is on credit hold: docs/product/requirements.md (R2).
  mayQuote(customerId: string): Promise<boolean>;

  hasBillingAddress(customerId: string): Promise<boolean>;

  billingState(customerId: string): Promise<string | undefined>;

  // A price agreed with the customer for a grade and width. A hand-set price equal to it needs no
  // Billing Manager approval.
  agreedPrice(
    customerId: string,
    gradeId: string,
    rollWidthIn: number,
  ): Promise<AgreedPriceTerms | undefined>;
}

// What quoting asks of the orders module: whether a quote already has an order.
export interface OrderLookup {
  existsForQuote(quoteId: string): Promise<boolean>;

  quoteIdsWithOrders(quoteIds: readonly string[]): Promise<readonly string[]>;
}

// True when a tax rate is loaded for the jurisdiction. A line cannot name one that has none.
export interface TaxJurisdictionLookup {
  isLoaded(jurisdiction: string): Promise<boolean>;
}

export interface TaxCodeAddress {
  readonly street: string;

  readonly city: string;

  readonly zip: string;
}

// What the address lookup reports. `unreachable` stands for every answer that cannot be trusted,
// so a caller fills nothing from it.
export type TaxCodeLocation =
  | {
      readonly kind: 'located';

      readonly how: 'address' | 'zip4' | 'corrected';

      readonly locationCode: string;

      readonly stateRate: string;
      readonly resultCode: number;
    }
  | { readonly kind: 'zip_only'; readonly resultCode: number }
  | { readonly kind: 'not_found'; readonly resultCode: number }
  | { readonly kind: 'unreachable'; readonly resultCode: number | undefined };

export interface TaxCodeLookup {
  locationFor(address: TaxCodeAddress): Promise<TaxCodeLocation>;
}

export interface ProductionManagerRecipients {
  audience(): Promise<ProductionManagerAudience>;
}

export interface ProductionManagerAudience {
  emails: readonly string[];

  withoutEmail: readonly string[];
}

export interface QuoteNotified {
  recipients: readonly string[];

  messageId: string;

  acceptedByRelayAt: Date;
}

export interface QuoteNotifier {
  quoteSent(
    quote: QuoteWithLines,
    document: StoredDocument,
    to: readonly string[],
    actor: string,
  ): Promise<QuoteNotified>;
}

export interface ProductionNotified {
  recipients: readonly string[];
  messageId: string;
  notifiedAt: Date;
}

export interface ProductionManagerNotifier {
  quoteSentToCustomer(
    quote: QuoteWithLines,
    send: QuoteSend,
    to: readonly string[],
  ): Promise<ProductionNotified>;

  leadTimeNeeded(
    quote: QuoteWithLines,
    to: readonly string[],
    actor: string,
  ): Promise<ProductionNotified>;
}

// Lets the service ask Production for a lead time once per quote.
export interface LeadTimeRequestLog {
  alreadyAsked(quoteId: string): Promise<boolean>;
}

export class NoProductionManagerError extends Error {
  readonly quoteId: string;

  readonly reason: 'no-holders' | 'no-addresses';

  readonly holdersWithoutEmail: readonly string[];

  constructor(
    quoteId: string,
    holdersWithoutEmail: readonly string[] = [],

    alert: 'quote-sent' | 'lead-time-request' = 'quote-sent',
  ) {
    const reason = holdersWithoutEmail.length === 0 ? 'no-holders' : 'no-addresses';
    const what =
      alert === 'quote-sent'
        ? { act: 'was sent', told: 'told it went out' }
        : { act: 'needs a lead time', told: 'asked for one' };
    super(
      reason === 'no-holders'
        ? `quote "${quoteId}" ${what.act} but no user holds the ProductionManager role, ` +
            `so nobody was ${what.told}`
        : `quote "${quoteId}" ${what.act} but no holder of the ProductionManager role has an ` +
            `email address, so nobody was ${what.told} (${holdersWithoutEmail.join(', ')})`,
    );
    this.name = 'NoProductionManagerError';
    this.quoteId = quoteId;
    this.reason = reason;
    this.holdersWithoutEmail = holdersWithoutEmail;
  }
}

export class QuoteHasOrderError extends Error {
  readonly quoteId: string;
  constructor(quoteId: string) {
    super(`quote "${quoteId}" has been converted to an order and cannot be closed as lost`);
    this.name = 'QuoteHasOrderError';
    this.quoteId = quoteId;
  }
}

export class UnknownCustomerError extends Error {
  readonly customerId: string;
  constructor(customerId: string) {
    super(`no customer with id "${customerId}"`);
    this.name = 'UnknownCustomerError';
    this.customerId = customerId;
  }
}

export class CustomerBillingAddressRequiredError extends Error {
  readonly customerId: string;
  constructor(customerId: string) {
    super(
      `customer "${customerId}" has no billing address, so a quote cannot be created - ` +
        'add one on the customer before quoting',
    );
    this.name = 'CustomerBillingAddressRequiredError';
    this.customerId = customerId;
  }
}

export class LineJurisdictionMismatchError extends Error {
  readonly lineNumber: number;
  readonly taxJurisdiction: string;
  readonly shipToState: string;
  constructor(lineNumber: number, taxJurisdiction: string, shipToState: string) {
    super(`line ${String(lineNumber)}: ${jurisdictionShipToRefusal(taxJurisdiction, shipToState)}`);
    this.name = 'LineJurisdictionMismatchError';
    this.lineNumber = lineNumber;
    this.taxJurisdiction = taxJurisdiction;
    this.shipToState = shipToState;
  }
}

export class UnknownTaxJurisdictionError extends Error {
  readonly lineNumber: number;
  readonly taxJurisdiction: string;
  constructor(lineNumber: number, taxJurisdiction: string) {
    super(
      `line ${String(lineNumber)}: no tax rate is loaded for tax jurisdiction "${taxJurisdiction}"`,
    );
    this.name = 'UnknownTaxJurisdictionError';
    this.lineNumber = lineNumber;
    this.taxJurisdiction = taxJurisdiction;
  }
}

export class PerPoundNeedsRollWeightError extends Error {
  constructor() {
    super(
      'a line priced per pound needs an estimated roll weight above zero - ' +
        'the price per pound is the roll price divided by that weight',
    );
    this.name = 'PerPoundNeedsRollWeightError';
  }
}

export class LinePerPoundNeedsRollWeightError extends Error {
  readonly lineNumber: number;
  readonly gradeId: string;
  constructor(lineNumber: number, gradeId: string) {
    super(
      `line ${String(lineNumber)} is priced per pound but its estimated roll weight is zero - ` +
        "check the grade's basis weight and the line's footage, or price it per roll",
    );
    this.name = 'LinePerPoundNeedsRollWeightError';
    this.lineNumber = lineNumber;
    this.gradeId = gradeId;
  }
}

export class PerPoundHandSetPriceError extends Error {
  constructor() {
    super(
      'a line priced per pound cannot also carry a hand-set price per roll - ' +
        'clear the hand-set price, or price the line per roll',
    );
    this.name = 'PerPoundHandSetPriceError';
  }
}

export class LinePerPoundHandSetPriceError extends Error {
  readonly lineNumber: number;
  constructor(lineNumber: number) {
    super(
      `line ${String(lineNumber)} is priced per pound and also carries a hand-set price per ` +
        'roll - clear the hand-set price, or price the line per roll',
    );
    this.name = 'LinePerPoundHandSetPriceError';
    this.lineNumber = lineNumber;
  }
}

export class PerRollHandSetPoundPriceError extends Error {
  constructor() {
    super(
      'a line priced per roll cannot carry a hand-set price per pound - ' +
        'clear the hand-set price per pound, or price the line per pound',
    );
    this.name = 'PerRollHandSetPoundPriceError';
  }
}

export class LinePerRollHandSetPoundPriceError extends Error {
  readonly lineNumber: number;
  constructor(lineNumber: number) {
    super(
      `line ${String(lineNumber)} is priced per roll and carries a hand-set price per pound - ` +
        'clear that price, or price the line per pound',
    );
    this.name = 'LinePerRollHandSetPoundPriceError';
    this.lineNumber = lineNumber;
  }
}

export class PerPoundNeedsOrderedWeightError extends Error {
  constructor() {
    super(
      "a line priced per pound needs the pounds ordered - enter the pounds the customer's PO orders",
    );
    this.name = 'PerPoundNeedsOrderedWeightError';
  }
}

export class LinePerPoundNeedsOrderedWeightError extends Error {
  readonly lineNumber: number;
  constructor(lineNumber: number) {
    super(
      `line ${String(lineNumber)} is priced per pound and has no pounds ordered - ` +
        "enter the pounds the customer's PO orders",
    );
    this.name = 'LinePerPoundNeedsOrderedWeightError';
    this.lineNumber = lineNumber;
  }
}

export class PerRollOrderedWeightError extends Error {
  constructor() {
    super(
      'a line priced per roll cannot carry pounds ordered - ' +
        'clear the pounds ordered, or price the line per pound',
    );
    this.name = 'PerRollOrderedWeightError';
  }
}

export class LinePerRollOrderedWeightError extends Error {
  readonly lineNumber: number;
  constructor(lineNumber: number) {
    super(
      `line ${String(lineNumber)} is priced per roll and carries pounds ordered - ` +
        'clear them, or price the line per pound',
    );
    this.name = 'LinePerRollOrderedWeightError';
    this.lineNumber = lineNumber;
  }
}

export class EnteredMarginHandSetPriceError extends Error {
  constructor() {
    super(
      'a line with a margin entered manually cannot also carry a hand-set price - ' +
        'clear the hand-set price, or choose a tier',
    );
    this.name = 'EnteredMarginHandSetPriceError';
  }
}

export class LineEnteredMarginHandSetPriceError extends Error {
  readonly lineNumber: number;
  constructor(lineNumber: number) {
    super(
      `line ${String(lineNumber)} carries a margin entered manually and a hand-set price - ` +
        'clear the hand-set price, or choose a tier',
    );
    this.name = 'LineEnteredMarginHandSetPriceError';
    this.lineNumber = lineNumber;
  }
}

export class EnteredMarginTierOverrideError extends Error {
  constructor() {
    super(
      'a line with a margin entered manually cannot also force a tier - ' +
        'choose one or the other in the Pricing tier drop-down',
    );
    this.name = 'EnteredMarginTierOverrideError';
  }
}

export class LineEnteredMarginTierOverrideError extends Error {
  readonly lineNumber: number;
  constructor(lineNumber: number) {
    super(
      `line ${String(lineNumber)} carries a margin entered manually and a forced tier - ` +
        'choose one or the other',
    );
    this.name = 'LineEnteredMarginTierOverrideError';
    this.lineNumber = lineNumber;
  }
}

export class LineEnteredMarginBelowFloorError extends Error {
  readonly lineNumber: number;

  readonly marginOverridePct: string;

  readonly floorPct: string;
  constructor(lineNumber: number, marginOverridePct: string, floorPct: string) {
    super(
      `line ${String(lineNumber)}: the margin entered manually, ${formatRatePercent(
        marginOverridePct,
      )}, is under the ${formatRatePercent(floorPct)} margin floor - enter ` +
        `${formatRatePercent(floorPct)} or more, or choose a tier`,
    );
    this.name = 'LineEnteredMarginBelowFloorError';
    this.lineNumber = lineNumber;
    this.marginOverridePct = marginOverridePct;
    this.floorPct = floorPct;
  }
}

/** Creation or revision for a customer on credit hold: docs/product/requirements.md (R2). */
export class CustomerOnCreditHoldError extends Error {
  readonly customerId: string;
  constructor(customerId: string) {
    super(
      `customer "${customerId}" is on credit hold, so a quote cannot be created — ` +
        'a Billing Manager must approve quoting this account first',
    );
    this.name = 'CustomerOnCreditHoldError';
    this.customerId = customerId;
  }
}

export class QuoteNotEditableError extends Error {
  readonly quoteId: string;
  readonly status: QuoteStatus;
  constructor(quoteId: string, status: QuoteStatus) {
    super(`quote "${quoteId}" is ${status} and its lines can no longer be changed`);
    this.name = 'QuoteNotEditableError';
    this.quoteId = quoteId;
    this.status = status;
  }
}

export class UnknownGradeOnLineError extends Error {
  readonly quoteId: string;
  constructor(quoteId: string) {
    super(`a line on quote "${quoteId}" names a grade that no longer exists`);
    this.name = 'UnknownGradeOnLineError';
    this.quoteId = quoteId;
  }
}

export class QuoteNotPrintableError extends Error {
  readonly quoteId: string;
  readonly status: string;
  constructor(quoteId: string, status: string) {
    super(
      `quote "${quoteId}" is ${status} and cannot produce a client-ready document — ` +
        'only a quoted or superseded quote can',
    );
    this.name = 'QuoteNotPrintableError';
    this.quoteId = quoteId;
    this.status = status;
  }
}

// Raised when printing a client document, and QuoteNeedsLeadTimeError when sending. Both enforce
// docs/product/requirements.md (R5).
export class QuoteHasNoLeadTimeError extends Error {
  readonly quoteId: string;
  constructor(quoteId: string) {
    super(
      `quote "${quoteId}" has no lead time and cannot go to a client — ` +
        'every quote carries one, entered by the Production Manager',
    );
    this.name = 'QuoteHasNoLeadTimeError';
    this.quoteId = quoteId;
  }
}

export class QuoteNeedsLeadTimeError extends Error {
  readonly quoteId: string;
  constructor(quoteId: string) {
    super(
      `quote "${quoteId}" cannot be sent with no lead time — ` +
        'every quote carries one, entered before it goes out',
    );
    this.name = 'QuoteNeedsLeadTimeError';
    this.quoteId = quoteId;
  }
}

/**
 * A line is below the margin floor and no Admin floor override is live. No approval clears it:
 * docs/product/requirements.md (R6).
 */
export class BelowFloorQuoteError extends Error {
  readonly quoteId: string;
  readonly lines: readonly { lineNumber: number; minimumPricePerRoll: string }[];
  constructor(
    quoteId: string,
    lines: readonly { lineNumber: number; minimumPricePerRoll: string }[],
  ) {
    super(
      `quote "${quoteId}" is below the margin floor on line(s) ` +
        lines.map((l) => `${l.lineNumber} (min ${l.minimumPricePerRoll}/roll)`).join(', ') +
        ' — re-price the line, or an Admin can override the floor',
    );
    this.name = 'BelowFloorQuoteError';
    this.quoteId = quoteId;
    this.lines = lines;
  }
}

/** A hand-set price has no live Billing Manager approval: docs/product/requirements.md (R7). */
export class OverrideNotApprovedError extends Error {
  readonly quoteId: string;
  readonly lines: readonly number[];
  constructor(quoteId: string, lines: readonly number[]) {
    super(
      `quote "${quoteId}" carries a hand-set price on line(s) ${lines.join(', ')} ` +
        'and has no live Billing Manager approval',
    );
    this.name = 'OverrideNotApprovedError';
    this.quoteId = quoteId;
    this.lines = lines;
  }
}

export class NothingToApproveError extends Error {
  readonly quoteId: string;
  constructor(quoteId: string) {
    super(`quote "${quoteId}" carries no hand-set price, so there is nothing to approve`);
    this.name = 'NothingToApproveError';
    this.quoteId = quoteId;
  }
}

export class OverrideAlreadyApprovedError extends Error {
  readonly quoteId: string;
  readonly approvedBy: string;
  constructor(quoteId: string, approvedBy: string) {
    super(`quote "${quoteId}" already carries a live approval by "${approvedBy}"`);
    this.name = 'OverrideAlreadyApprovedError';
    this.quoteId = quoteId;
    this.approvedBy = approvedBy;
  }
}

export class NothingBelowFloorError extends Error {
  readonly quoteId: string;
  constructor(quoteId: string) {
    super(`quote "${quoteId}" has no line below the margin floor, so there is nothing to override`);
    this.name = 'NothingBelowFloorError';
    this.quoteId = quoteId;
  }
}

export class FloorOverrideAlreadyApprovedError extends Error {
  readonly quoteId: string;
  readonly overriddenBy: string;
  constructor(quoteId: string, overriddenBy: string) {
    super(`quote "${quoteId}" already carries a live floor override by "${overriddenBy}"`);
    this.name = 'FloorOverrideAlreadyApprovedError';
    this.quoteId = quoteId;
    this.overriddenBy = overriddenBy;
  }
}

export interface NewQuote {
  customerId: string;
  salesRep?: string;
  notes?: string;

  freightInRollPrice?: boolean;
}

export interface QuoteHeaderPatch {
  freightInRollPrice?: boolean;
}

export class QuoteNotRevisableError extends Error {
  readonly quoteId: string;
  readonly status: QuoteStatus;
  constructor(quoteId: string, status: QuoteStatus) {
    super(`quote "${quoteId}" is ${status}; only a quoted quote can be revised`);
    this.name = 'QuoteNotRevisableError';
    this.quoteId = quoteId;
    this.status = status;
  }
}

export class QuoteRedistributionNotConfirmedError extends Error {
  readonly quoteId: string;
  readonly priorSends: readonly QuoteSend[];
  constructor(quoteId: string, priorSends: readonly QuoteSend[]) {
    super(
      `quote "${quoteId}" belongs to a chain already sent ${priorSends.length} time(s); ` +
        `redistribution must be confirmed`,
    );
    this.name = 'QuoteRedistributionNotConfirmedError';
    this.quoteId = quoteId;
    this.priorSends = priorSends;
  }
}

export class QuoteHasNoRecipientsError extends Error {
  readonly quoteId: string;
  readonly customerId: string;
  constructor(quoteId: string, customerId: string) {
    super(
      `quote "${quoteId}" cannot be sent: customer "${customerId}" has no contact tagged for quotes`,
    );
    this.name = 'QuoteHasNoRecipientsError';
    this.quoteId = quoteId;
    this.customerId = customerId;
  }
}

// The relay accepted the email, and the send record could not be written. An accepted email cannot
// be recalled, so the quote stays sent. The error carries what the record would have held, and
// `cause` says why it was not written.
export class QuoteSendNotRecordedError extends Error {
  readonly quoteId: string;
  readonly messageId: string;
  readonly actor: string;
  readonly acceptedByRelayAt: Date;
  constructor(
    quoteId: string,
    send: { messageId: string; actor: string; acceptedByRelayAt: Date },
    cause: unknown,
  ) {
    super(
      `quote "${quoteId}" was accepted by the mail relay as ${send.messageId}, ` +
        `but its send record could not be written`,
      { cause },
    );
    this.name = 'QuoteSendNotRecordedError';
    this.quoteId = quoteId;
    this.messageId = send.messageId;
    this.actor = send.actor;
    this.acceptedByRelayAt = send.acceptedByRelayAt;
  }
}

// A first send that failed before the relay accepted the email, and whose move to `quoted` was not
// undone. `cause` is the failure of the send. With `has-order` the quote gained an order while the
// email was out, so it is left `quoted`, as a quote moved there without sending may be. With
// `write-failed` the undo could not be written, and `undoError` says why.
export class QuoteSendNotUndoneError extends Error {
  readonly quoteId: string;
  readonly reason: 'has-order' | 'write-failed';
  readonly undoError: unknown;
  constructor(
    quoteId: string,
    reason: 'has-order' | 'write-failed',
    cause: unknown,
    undoError?: unknown,
  ) {
    super(
      reason === 'has-order'
        ? `quote "${quoteId}" was not sent and stays quoted, because it has an order`
        : `quote "${quoteId}" was not sent and its move to quoted could not be undone`,
      { cause },
    );
    this.name = 'QuoteSendNotUndoneError';
    this.quoteId = quoteId;
    this.reason = reason;
    this.undoError = undoError;
  }
}

// A line replacement that would clear a live decision without the entry that logs its revocation.
export class LineEditRevocationMissingError extends Error {
  readonly quoteId: string;
  readonly kind: QuoteOverrideKind;
  constructor(quoteId: string, kind: QuoteOverrideKind) {
    super(`replacing the lines of quote "${quoteId}" revokes its ${kind} decision, with no entry`);
    this.name = 'LineEditRevocationMissingError';
    this.quoteId = quoteId;
    this.kind = kind;
  }
}

export class QuoteVersionConflictError extends Error {
  readonly rootQuoteId: string;
  readonly versionNumber: number;
  constructor(rootQuoteId: string, versionNumber: number) {
    super(`version ${versionNumber} of quote chain "${rootQuoteId}" already exists`);
    this.name = 'QuoteVersionConflictError';
    this.rootQuoteId = rootQuoteId;
    this.versionNumber = versionNumber;
  }
}

// One stale-write error serves every aggregate. It is defined in
// packages/db/src/stale-aggregate.ts: docs/decisions/006-optimistic-concurrency.md.
export { StaleAggregateError } from '@erp/db';

export type NewQuoteLine = Omit<QuoteLine, 'quoteId' | 'createdAt' | 'updatedAt'>;

export interface QuoteListParams {
  status?: QuoteStatus;

  customerIds?: readonly string[];

  ids?: readonly string[];

  quoteNumber?: number;

  salesRep?: string;

  // `'missing'` keeps only quotes with no lead time yet.
  leadTime?: 'missing';

  sort?: QueueSort;

  limit?: number;
}

// `converted: false` drops quotes that already have an order. The service applies it, because
// orders are another module's data.
export interface QuoteListQuery extends QuoteListParams {
  converted?: false;
}

export type NewQuoteRow = NewQuote & {
  id: string;
  status: QuoteStatus;
  rootQuoteId: string;
  versionNumber: number;

  quoteNumber?: number;
  createdAt: Date;
  updatedAt: Date;
};

// The log entry a line edit writes for each kind of decision it revokes. The repository adds
// `decision: 'revoked'` and the kind.
export type LineEditRevocation = Omit<QuoteOverrideDecision, 'quoteId' | 'decision' | 'kind'>;

export interface LineEditRevocations {
  price: LineEditRevocation;
  floor: LineEditRevocation;
}

export type NewQuoteSend = Omit<QuoteSend, 'acceptedByRelayAt'> & {
  acceptedByRelayAt: Date;
};

/**
 * Storage for quotes, their lines, override decisions and sends. Every write to a quote or its
 * lines increments `lockVersion`. A write given `expectedLockVersion` refuses a mismatch with
 * `StaleAggregateError` and writes nothing: docs/decisions/006-optimistic-concurrency.md. Both
 * adapters are held to modules/quoting/test/contracts/quote-repository.contract.ts.
 */
export interface QuoteRepository {
  create(input: NewQuoteRow): Promise<Quote>;

  // Creates the quote and spends the customer's approved credit-hold exception in one transaction.
  // Returns null and creates nothing when no unspent exception exists.
  // The rule: docs/product/requirements.md (R2).
  createSpendingApproval(input: NewQuoteRow): Promise<SpentQuoteApproval | null>;

  findById(id: string): Promise<Quote | null>;

  findWithLines(id: string): Promise<QuoteWithLines | null>;

  list(params: QuoteListParams): Promise<readonly QuoteListItem[]>;

  countAndOldest(params: Omit<QuoteListParams, 'sort' | 'limit'>): Promise<CountAndOldest<Quote>>;

  // Replaces the lines and the header in one write that also revokes the decisions the edit makes
  // void: docs/product/requirements.md (R6) and docs/product/requirements.md (R7). A price approval
  // or floor override live on the row as the write holds it is cleared and its entry from
  // `revocations` is appended to the decision log, and a quote in `override_requested` that loses
  // one returns to `draft`. A live decision with no entry given refuses the write, and so does a
  // quote whose row is no longer editable, with `QuoteNotEditableError`. Any failure saves
  // nothing.
  replaceLines(
    quoteId: string,
    lines: readonly NewQuoteLine[],
    updatedAt: Date,
    expectedLockVersion?: number,
    header?: QuoteHeaderPatch,
    revocations?: LineEditRevocations,
  ): Promise<QuoteWithLines | null>;

  // Writes the move without consulting the transition table. The service checks the table, and the
  // undo of a failed send restores a status the table does not list.
  transition(
    id: string,
    to: QuoteStatus,
    updatedAt: Date,
    expectedLockVersion?: number,
    log?: readonly Omit<QuoteOverrideDecision, 'quoteId'>[],
  ): Promise<Quote | null>;

  setLeadTime(
    quoteId: string,
    leadTimeDays: number,
    setBy: string,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<Quote | null>;

  // Sets the live price approval or floor override, chosen by `entry.kind`, or clears it when
  // `approval` is null. The entry is appended to the decision log, and with `toDraft` the quote
  // moves to `draft`, all in the same write. Whether the quote leaves the queue is the service's
  // call. A stale `expectedLockVersion` or an entry that cannot be logged writes nothing.
  recordOverrideDecision(
    quoteId: string,
    approval: { by: string; at: Date } | null,
    entry: Omit<QuoteOverrideDecision, 'quoteId'>,
    updatedAt: Date,
    expectedLockVersion?: number,
    toDraft?: boolean,
  ): Promise<Quote | null>;

  overrideDecisions(quoteId: string): Promise<readonly QuoteOverrideDecision[]>;

  // Lines on quotes in `draft` status that use a footage variant or stock width. Grade edits may
  // not retire one that a draft still uses.
  draftLinesUsingGradeVariant(
    gradeId: string,
    variant: string,
  ): Promise<readonly { quoteId: string; lineNumber: number }[]>;

  draftLinesUsingGradeWidth(
    gradeId: string,
    rollWidthIn: number,
  ): Promise<readonly { quoteId: string; lineNumber: number }[]>;

  versions(rootQuoteId: string): Promise<readonly Quote[]>;

  // Inserts the next version with its lines and marks the original `superseded`, in one write that
  // checks the original as it holds it. An original no longer `quoted` refuses the write with
  // `QuoteNotRevisableError`, a mismatched `expectedLockVersion` with `StaleAggregateError`, and a
  // version number already taken with `QuoteVersionConflictError`. Any refusal writes nothing.
  revise(
    originalId: string,
    next: NewQuoteRow,
    lines: readonly NewQuoteLine[],
    at: Date,
    expectedLockVersion?: number,
  ): Promise<QuoteWithLines | null>;

  recordSend(input: NewQuoteSend): Promise<QuoteSend>;

  sendsForChain(rootQuoteId: string): Promise<readonly QuoteSend[]>;
}

export interface SpentQuoteApproval {
  quote: Quote;
  approval: QuoteApproval;
}

export interface NewQuoteApproval {
  id: string;
  customerId: string;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
}

export interface QuoteApprovalDecision {
  decision: 'approved' | 'rejected';
  decidedBy: string;
  decidedAt: Date;
  reason?: string;
}

/**
 * Credit-hold exceptions: docs/product/requirements.md (R2). A customer holds at most one approved
 * and unspent exception, enforced by a partial unique index in
 * infra/db/migrations/quoting/0000_baseline.sql and by the in-memory adapter.
 */
export interface QuoteApprovalRepository {
  request(input: NewQuoteApproval): Promise<QuoteApproval>;
  findById(id: string): Promise<QuoteApproval | null>;

  decide(id: string, decision: QuoteApprovalDecision): Promise<QuoteApproval | null>;

  listPending(): Promise<readonly QuoteApproval[]>;

  findUnspentFor(customerId: string): Promise<QuoteApproval | null>;

  listForCustomer(customerId: string): Promise<readonly QuoteApproval[]>;
}

export class UnspentQuoteApprovalExistsError extends Error {
  readonly customerId: string;
  constructor(customerId: string) {
    super(`customer "${customerId}" already has an unspent quote approval`);
    this.name = 'UnspentQuoteApprovalExistsError';
    this.customerId = customerId;
  }
}

export class QuoteApprovalAlreadyDecidedError extends Error {
  readonly approvalId: string;
  readonly status: QuoteApprovalStatus;
  constructor(approvalId: string, status: QuoteApprovalStatus) {
    super(`quote approval "${approvalId}" is already ${status}`);
    this.name = 'QuoteApprovalAlreadyDecidedError';
    this.approvalId = approvalId;
    this.status = status;
  }
}

export class CustomerNotOnCreditHoldError extends Error {
  readonly customerId: string;
  constructor(customerId: string) {
    super(`customer "${customerId}" is not on credit hold, so there is nothing to approve`);
    this.name = 'CustomerNotOnCreditHoldError';
    this.customerId = customerId;
  }
}
