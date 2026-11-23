// Turns the posted line form into the API's line requests, checked with the shared schema: docs/decisions/004-server-first-web-ui.md.
// The form posts every line, open or folded, because the API replaces the quote's whole set of lines.
// The action that calls it is apps/web/src/app/quoting/quotes/[id]/actions.ts.
import {
  MARGIN_ENTERED_MAX,
  TAX_STATUSES,
  formatRatePercent,
  jurisdictionFitsShipTo,
  jurisdictionShipToRefusal,
  quoteLineInputSchema,
  toDecimal,
  toRate,
  type QuoteLineInput,
  type TaxStatus,
} from '@erp/types';
import { optionalString } from '@erp/utils';

import { percentToRatio, type CollectedPercent } from '../../../../lib/percent';
import { treatmentWithJurisdiction } from '../../../../lib/tax-treatment';
import { collectLength, collectWidth } from './custom-width';
import {
  blankSelectDefaults,
  fillAgreedPriceFromCustomerPart,
  fillFromCustomerPart,
  fillLengthFromCustomerPart,
} from './customer-seed';
import {
  COST_PER_TON_PATTERN,
  MARGIN_ENTERED_CHOICE,
  MARGIN_ENTERED_MAX_PERCENT,
  MARGIN_FLOOR_FIELD,
  MARGIN_PERCENT_PATTERN,
  splitPaperValue,
} from './line-defaults';

export type CollectResult = { ok: true; lines: QuoteLineInput[] } | { ok: false; message: string };

export function collectLines(formData: FormData): CollectResult {
  const lines: QuoteLineInput[] = [];

  const billingState = optionalString(formData, 'billingState');
  for (let i = 0; ; i += 1) {
    const paperRaw = formData.get(`lines[${i}].paper`);
    if (paperRaw === null) {
      break;
    }
    if (formData.get(`lines[${i}].remove`) !== null) {
      continue;
    }
    const paper = splitPaperValue(typeof paperRaw === 'string' ? paperRaw.trim() : '');
    const gradeId = paper.gradeId;
    const quantity = optionalString(formData, `lines[${i}].quantityRolls`);
    if (gradeId === '' || quantity === undefined) {
      // An untouched blank row is skipped. A half-filled one is refused, so typed values are never dropped.
      if (quantity === undefined && !rowHasData(formData, i)) {
        continue;
      }

      return {
        ok: false,
        message:
          gradeId === ''
            ? `Line ${i + 1} has data but no paper — pick a paper or clear the row.`
            : `Line ${i + 1} has data but no quantity — enter a quantity (rolls).`,
      };
    }

    const freight = buildFreight(formData, i);
    if (typeof freight === 'string') {
      return { ok: false, message: `Line ${i + 1}: ${freight}` };
    }

    const taxTreatment = buildTaxTreatment(formData, i);
    if (typeof taxTreatment === 'string') {
      return { ok: false, message: `Line ${i + 1}: ${taxTreatment}` };
    }

    const delivery = buildDeliveryAddress(formData, i);
    if (typeof delivery === 'string') {
      return { ok: false, message: `Line ${i + 1}: ${delivery}` };
    }

    const width = collectWidth(formData, i);
    if (typeof width === 'string') {
      return { ok: false, message: `Line ${i + 1}: ${width}` };
    }

    const costs = collectCostsPerTon(formData, i);
    if (typeof costs === 'string') {
      return { ok: false, message: `Line ${i + 1}: ${costs}` };
    }

    const tierOrMargin = collectTierOrMargin(formData, i);
    if (typeof tierOrMargin === 'string') {
      return { ok: false, message: `Line ${i + 1}: ${tierOrMargin}` };
    }

    const names = fillFromCustomerPart(
      formData,
      i,
      { gradeId, rollWidthIn: width.rollWidthIn },
      {
        ...optionalField(
          'customerPartNumber',
          optionalString(formData, `lines[${i}].customerPartNumber`),
        ),
        ...optionalField(
          'customerDescription',
          optionalString(formData, `lines[${i}].customerDescription`),
        ),
      },
    );

    const pricingBasis = optionalString(formData, `lines[${i}].pricingBasis`);
    const handSet = fillAgreedPriceFromCustomerPart(
      formData,
      i,
      { gradeId, rollWidthIn: width.rollWidthIn, basis: pricingBasis ?? 'per_roll' },
      {
        ...optionalField(
          'overridePricePerRoll',
          optionalString(formData, `lines[${i}].overridePricePerRoll`),
        ),

        ...optionalField(
          'overridePricePerLb',
          optionalString(formData, `lines[${i}].overridePricePerLb`),
        ),
        ...tierOrMargin,
      },
    );

    const candidate = {
      gradeId,

      footageVariant: paper.footageVariant === '' ? undefined : paper.footageVariant,

      rollWidthIn: width.rollWidthIn,
      ...(width.customWidth ? { customWidth: true } : {}),
      quantityRolls: toInteger(quantity),
      overwrap: formData.get(`lines[${i}].overwrap`) !== null,

      printed: formData.get(`lines[${i}].printed`) !== null,
      ...names,

      ...tierOrMargin,

      ...handSet,

      ...optionalField('pricingBasis', pricingBasis),

      ...optionalField('orderedWeightLb', optionalString(formData, `lines[${i}].orderedWeightLb`)),

      ...optionalField(
        'feetPerRollOverride',
        fillLengthFromCustomerPart(
          formData,
          i,
          { gradeId, rollWidthIn: width.rollWidthIn },
          collectLength(formData, i),
        ),
      ),

      ...costs,
      freight,

      ...optionalField('revenueCategory', optionalString(formData, `lines[${i}].revenueCategory`)),
      taxTreatment,

      ...delivery,
    };

    const parsed = quoteLineInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const detail =
        issue === undefined ? 'invalid line' : `${issue.path.join('.')}: ${issue.message}`;
      return { ok: false, message: `Line ${i + 1}: ${detail}` };
    }

    // A collected line has no delivery address, so its jurisdiction is held to the billing state.
    const shipToState = parsed.data.deliveryAddress?.state ?? billingState;
    const { taxJurisdiction } = parsed.data.taxTreatment;
    if (!jurisdictionFitsShipTo(taxJurisdiction, shipToState)) {
      return {
        ok: false,
        message: `Line ${i + 1}: ${jurisdictionShipToRefusal(
          taxJurisdiction ?? '',
          shipToState ?? '',
        )}.`,
      };
    }

    lines.push(parsed.data);
  }
  return { ok: true, lines };
}

// A select still on the value it started with counts as untouched. The new row's selects may start
// on the customer's seed, so the comparison is with that seed, not with a fixed default.
function rowHasData(formData: FormData, i: number): boolean {
  const textFields = [
    'rollWidthIn',
    'customWidthIn',
    'overridePricePerRoll',
    'overridePricePerLb',
    'orderedWeightLb',
    'customerPartNumber',
    'customerDescription',
    'feetPerRollOverride',
    'convertCostPerTon',
    'printCostPerTon',
    'rateOverride',
    'carrierBid',
    'freightMarginPct',
    ...DELIVERY_FIELDS.map((field) => `delivery.${field}`),
  ];
  if (textFields.some((field) => optionalString(formData, `lines[${i}].${field}`) !== undefined)) {
    return true;
  }
  if (
    formData.get(`lines[${i}].overwrap`) !== null ||
    formData.get(`lines[${i}].printed`) !== null ||
    formData.get(`lines[${i}].customWidth`) !== null
  ) {
    return true;
  }

  const start = blankSelectDefaults(formData, i);
  if (
    (optionalString(formData, `lines[${i}].pricingBasis`) ?? start.pricingBasis) !==
    start.pricingBasis
  ) {
    return true;
  }
  if ((optionalString(formData, `lines[${i}].tierOverrideCode`) ?? '') !== start.tierOverrideCode) {
    return true;
  }
  return (
    (optionalString(formData, `lines[${i}].freightMode`) ?? start.freightMode) !== start.freightMode
  );
}

function buildFreight(formData: FormData, i: number): Record<string, unknown> | string {
  const mode = optionalString(formData, `lines[${i}].freightMode`) ?? 'pickup';
  const rateOverride = optionalString(formData, `lines[${i}].rateOverride`);
  const carrierBid = optionalString(formData, `lines[${i}].carrierBid`);
  const typedMargin = optionalString(formData, `lines[${i}].freightMarginPct`);
  switch (mode) {
    case 'pickup':
      return { mode };
    case 'our_vehicle':
      return { mode, ...optionalField('rateOverride', rateOverride) };
    case 'pass_through':
      return {
        mode,
        ...optionalField('carrierBid', carrierBid),
        ...optionalField('rateOverride', rateOverride),
      };
    case 'carrier': {
      const margin = collectMargin(typedMargin);
      if (margin !== undefined && !margin.ok) {
        return margin.message;
      }
      return {
        mode,
        ...optionalField('carrierBid', carrierBid),
        ...optionalField('freightMarginPct', margin?.ratio),
      };
    }
    default:
      return `unknown shipping mode "${mode}"`;
  }
}

function buildTaxTreatment(formData: FormData, i: number): Record<string, unknown> | string {
  const taxStatus = optionalString(formData, `lines[${i}].taxStatus`);
  if (taxStatus === undefined) {
    return 'choose a tax treatment — the customer record did not settle one.';
  }
  if (!(TAX_STATUSES as readonly string[]).includes(taxStatus)) {
    return `unknown tax treatment "${taxStatus}"`;
  }
  const washington: TaxStatus = 'wa_tax';
  return treatmentWithJurisdiction(
    taxStatus as TaxStatus,
    taxStatus === washington ? optionalString(formData, `lines[${i}].taxJurisdiction`) : undefined,
  );
}

const DELIVERY_FIELDS = ['name', 'line1', 'line2', 'city', 'state', 'postalCode'] as const;

const DELIVERY_REQUIRED = [
  { field: 'line1', label: 'street' },
  { field: 'city', label: 'city' },
  { field: 'state', label: 'state' },
  { field: 'postalCode', label: 'ZIP' },
] as const;

function buildDeliveryAddress(formData: FormData, i: number): Record<string, unknown> | string {
  const parts: Record<string, string> = {};
  for (const field of DELIVERY_FIELDS) {
    const value = optionalString(formData, `lines[${i}].delivery.${field}`);
    if (value !== undefined) {
      parts[field] = value;
    }
  }
  if (Object.keys(parts).length === 0) {
    return {};
  }
  const missing = DELIVERY_REQUIRED.filter(({ field }) => parts[field] === undefined).map(
    ({ label }) => label,
  );
  if (missing.length > 0) {
    return (
      `a delivery address needs a street, city, state and ZIP. Still blank: ${missing.join(', ')}. ` +
      'Fill those in, or clear the whole address to quote this line for collection.'
    );
  }
  return { deliveryAddress: parts };
}

const COST_PER_TON_BOXES = [
  { field: 'convertCostPerTon', label: 'Converting cost', example: '180' },
  { field: 'printCostPerTon', label: 'Print cost', example: '260' },
] as const;

const COST_PER_TON_TEXT = new RegExp(`^(?:${COST_PER_TON_PATTERN})$`);

function collectCostsPerTon(formData: FormData, i: number): Record<string, string> | string {
  const costs: Record<string, string> = {};
  for (const box of COST_PER_TON_BOXES) {
    const typed = optionalString(formData, `lines[${i}].${box.field}`);
    if (typed === undefined) {
      continue;
    }
    if (!COST_PER_TON_TEXT.test(typed)) {
      return `${box.label} must be a number of dollars per US ton, such as ${box.example}. You entered "${typed}".`;
    }
    costs[box.field] = typed;
  }
  return costs;
}

const MARGIN_PERCENT_TEXT = new RegExp(`^(?:${MARGIN_PERCENT_PATTERN})$`);

const RATIO_TEXT = /^\d+(\.\d+)?$/;

function collectTierOrMargin(formData: FormData, i: number): Record<string, string> | string {
  const choice = optionalString(formData, `lines[${i}].tierOverrideCode`);
  if (choice !== MARGIN_ENTERED_CHOICE) {
    return optionalField('tierOverrideCode', choice);
  }
  const typed = optionalString(formData, `lines[${i}].marginOverridePct`);
  if (typed === undefined) {
    return 'Enter margin manually is chosen and the Margin box is blank. Type the margin, or choose a tier.';
  }
  if (!MARGIN_PERCENT_TEXT.test(typed)) {
    return `Margin must be a percent to one decimal place, such as 42.0. You entered "${typed}".`;
  }
  const ratio = toDecimal(typed).div('100');
  if (ratio.gt(MARGIN_ENTERED_MAX)) {
    return `a margin entered manually can be at most ${MARGIN_ENTERED_MAX_PERCENT}%. You entered ${typed}%.`;
  }
  // The floor travels as a hidden field so the action can refuse before it calls the API. This check
  // only gives a clearer message. The API refuses a margin entered below the floor at save:
  // modules/quoting/src/services/quote-service.ts, docs/product/requirements.md (R6).
  const floor = optionalString(formData, MARGIN_FLOOR_FIELD);
  if (floor !== undefined && RATIO_TEXT.test(floor) && ratio.lt(floor)) {
    const floorText = formatRatePercent(floor);
    return `the margin floor is ${floorText}, so a margin entered manually must be ${floorText} or more. You entered ${typed}%.`;
  }
  return { marginOverridePct: toRate(ratio) };
}

function optionalField(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function collectMargin(typed: string | undefined): CollectedPercent | undefined {
  return typed === undefined
    ? undefined
    : percentToRatio(typed, { subject: 'Freight margin', maxExclusive: '1' });
}

function toInteger(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}
