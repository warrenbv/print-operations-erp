// The public surface of the quoting module. Other code imports `@erp/quoting` and never a path
// under src/: docs/decisions/001-modular-monorepo.md. What each export is for:
// modules/quoting/README.md.
export { GradeService, type GradeServiceOptions } from './services/grade-service';

export { calculateFreight } from './freight';
export {
  PricingConfigService,
  type PricingConfigServiceOptions,
} from './services/pricing-config-service';
export {
  PRICING_TIER_HISTORY_LIMIT,
  PricingTierService,
  type PricingTierServiceOptions,
} from './services/pricing-tier-service';
export { RollCostService, type RollCostServiceOptions } from './services/roll-cost-service';
export {
  QuotePricingService,
  type QuotePricingServiceOptions,
} from './services/quote-pricing-service';
export { QuoteService, type QuoteServiceOptions } from './services/quote-service';
export { resolveTier, selectTierByVolume, tierMultiplier } from './tier-selection';

export {
  InvalidQuoteTransitionError,
  allowedTransitions,
  assertTransition,
  canTransition,
  deadEndStatuses,
  isConvertible,
  isEditable,
  isTerminal,
  reachableStatuses,
} from './quote-state-machine';

export {
  palletsForQuantity,
  rollWeightLb,
  selectPalletFit,
  type RollWeightInput,
} from './roll-geometry';
export {
  applyOverwrap,
  basePricePerRoll,
  evaluateFloor,
  marginPct,
  priceQuoteLine,
  quoteTotals,
  type PriceQuoteLineInput,
} from './quote-calculation';
export {
  addOnCostPerRoll,
  buildRollCostDetailed,
  type RollCostResult,
  hardwareCostPerRoll,
  paperCostPerLb,
  paperCostPerRoll,
  type BuildRollCostInput,
} from './cost-build-up';

export {
  BelowFloorQuoteError,
  FloorOverrideAlreadyApprovedError,
  NothingBelowFloorError,
  NothingToApproveError,
  OverrideAlreadyApprovedError,
  OverrideNotApprovedError,
  DuplicateFootageVariantError,
  DuplicateGradeCodeError,
  DuplicateTierCodeError,
  DuplicateTierThresholdError,
  FootageVariantInUseError,
  DuplicateStockWidthError,
  StockWidthInUseError,
  WidthNotStockedError,
  NoPalletFitForWidthError,
  NoProductionManagerError,
  NoTierForVolumeError,
  NoZeroThresholdTierError,
  QuoteHasNoRecipientsError,
  LineJurisdictionMismatchError,
  UnknownTaxJurisdictionError,
  LinePerPoundHandSetPriceError,
  LinePerPoundNeedsRollWeightError,
  LinePerRollHandSetPoundPriceError,
  LinePerPoundNeedsOrderedWeightError,
  LinePerRollOrderedWeightError,
  PerPoundHandSetPriceError,
  PerPoundNeedsRollWeightError,
  PerRollHandSetPoundPriceError,
  PerPoundNeedsOrderedWeightError,
  PerRollOrderedWeightError,
  EnteredMarginHandSetPriceError,
  EnteredMarginTierOverrideError,
  LineEnteredMarginHandSetPriceError,
  LineEnteredMarginTierOverrideError,
  LineEnteredMarginBelowFloorError,
  QuoteNotEditableError,
  QuoteHasNoLeadTimeError,
  QuoteNeedsLeadTimeError,
  QuoteNotPrintableError,
  QuoteNotRevisableError,
  QuoteRedistributionNotConfirmedError,
  QuoteSendNotRecordedError,
  QuoteSendNotUndoneError,
  QuoteVersionConflictError,
  LineEditRevocationMissingError,
  StaleAggregateError,
  QuoteHasOrderError,
  CustomerNotOnCreditHoldError,
  CustomerBillingAddressRequiredError,
  CustomerOnCreditHoldError,
  QuoteApprovalAlreadyDecidedError,
  UnspentQuoteApprovalExistsError,
  UnknownCustomerError,
  UnknownFootageVariantError,
  UnknownGradeOnLineError,
  UnknownTierCodeError,
  type Clock,
  type CustomerLookup,
  type QuoteApprovalRepository,
  type OrderLookup,
  type TaxJurisdictionLookup,
  type TaxCodeAddress,
  type TaxCodeLocation,
  type TaxCodeLookup,
  type ProductionManagerNotifier,
  type LeadTimeRequestLog,
  type ProductionManagerAudience,
  type ProductionManagerRecipients,
  type ProductionNotified,
  type QuoteNotified,
  type QuoteNotifier,
  type GradeListParams,
  type GradePatch,
  type GradeRepository,
  type NewGrade,
  type NewQuote,
  type NewQuoteLine,
  type NewQuoteSend,
  type QuoteHeaderPatch,
  type LineEditRevocation,
  type LineEditRevocations,
  type PalletFitRepository,
  type PricingConfigRepository,
  type PricingTierRepository,
  type QuoteListParams,
  type QuoteListQuery,
  type QuoteRepository,
} from './ports';

export { systemClock } from './adapters/system-clock';
export {
  DEFAULT_GRADE_IDS,
  DEFAULT_GRADES,
  InMemoryGradeRepository,
} from './adapters/in-memory/in-memory-grade-repository';
export {
  DEFAULT_PALLET_FITS,
  InMemoryPalletFitRepository,
} from './adapters/in-memory/in-memory-pallet-fit-repository';
export {
  DEFAULT_PRICING_CONFIG,
  InMemoryPricingConfigRepository,
} from './adapters/in-memory/in-memory-pricing-config-repository';
export {
  DEFAULT_PRICING_TIER_IDS,
  DEFAULT_PRICING_TIERS,
  InMemoryPricingTierRepository,
} from './adapters/in-memory/in-memory-pricing-tier-repository';
export { InMemoryQuoteRepository } from './adapters/in-memory/in-memory-quote-repository';
export { InMemoryQuoteApprovalRepository } from './adapters/in-memory/in-memory-quote-approval-repository';

export { createQuotingDb, type QuotingDb } from './data/quoting-db';
export { DrizzleGradeRepository } from './adapters/drizzle/drizzle-grade-repository';
export { DrizzlePalletFitRepository } from './adapters/drizzle/drizzle-pallet-fit-repository';
export { DrizzlePricingConfigRepository } from './adapters/drizzle/drizzle-pricing-config-repository';
export { DrizzlePricingTierRepository } from './adapters/drizzle/drizzle-pricing-tier-repository';
export { DrizzleQuoteRepository } from './adapters/drizzle/drizzle-quote-repository';
export { DrizzleQuoteApprovalRepository } from './adapters/drizzle/drizzle-quote-approval-repository';

export {
  TaxRateService,
  type ImportedTaxRates,
  type TaxRateKey,
  type TaxRateRepository,
} from './services/tax-rate-service';
export { InMemoryTaxRateRepository } from './adapters/in-memory/in-memory-tax-rate-repository';
export { DrizzleTaxRateRepository } from './adapters/drizzle/drizzle-tax-rate-repository';

export {
  TaxCodeLookupService,
  consoleTaxCodeLookupLog,
  type TaxCodeLookupLog,
  type TaxRateHistory,
} from './services/tax-code-lookup-service';
export {
  DOR_LOOKUP_TIMEOUT_MS,
  DorAddressRatesLookup,
  type FetchLike,
} from './adapters/dor-address-rates/dor-address-rates-lookup';
export { readDorAnswer } from './adapters/dor-address-rates/dor-answer';
export {
  FAKE_TAX_CODE_ANSWERS,
  InMemoryTaxCodeLookup,
} from './adapters/dor-address-rates/in-memory-tax-code-lookup';
