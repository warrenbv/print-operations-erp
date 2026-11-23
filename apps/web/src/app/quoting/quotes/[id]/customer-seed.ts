// Seeds a new quote line from the customer's defaults and parts: pricing basis, tier, freight mode,
// part number, description, roll length and agreed price. Only the new row is seeded, never a stored line.
// The defaults are edited on the customer page, apps/web/src/app/crm/customers/[id]/defaults/edit/page.tsx.
import {
  PRICING_BASES,
  SHIPPING_MODES,
  agreedPriceFigureSchema,
  customerPartFeetPerRollSchema,
  partFor,
  tierCodeSchema,
  type AgreedPriceTerms,
  type CustomerDefaults,
  type CustomerPart,
  type PricingBasis,
  type ShippingMode,
  type StoredCustomerPart,
} from '@erp/types';

import { LENGTH_CHOICE } from './custom-width';

export const NEW_LINE_INDEX_FIELD = 'newLineIndex';

export const CUSTOMER_PARTS_FIELD = 'customerParts';

export const SEED_PRICING_BASIS_FIELD = 'seed.pricingBasis';
export const SEED_FREIGHT_MODE_FIELD = 'seed.freightMode';
export const SEED_TIER_CODE_FIELD = 'seed.tierCode';

const HOUSE_PRICING_BASIS: PricingBasis = 'per_roll';
const HOUSE_FREIGHT_MODE: ShippingMode = 'pickup';

const HOUSE_TIER_CODE = '';

export interface LineSeed {
  readonly pricingBasis?: PricingBasis;

  readonly tierCode?: string;
  readonly freightMode?: ShippingMode;
}

// A customer's default tier that no longer exists is dropped, so the line falls back to the tier by volume.
export function lineSeedOf(
  defaults: CustomerDefaults | null,
  tiers: readonly { code: string }[],
): LineSeed {
  const tierCode = defaults?.tierCode;
  const listed = tierCode !== undefined && tiers.some((tier) => tier.code === tierCode);
  return {
    ...(defaults?.pricingBasis === undefined ? {} : { pricingBasis: defaults.pricingBasis }),
    ...(listed ? { tierCode } : {}),
    ...(defaults?.freightMode === undefined ? {} : { freightMode: defaults.freightMode }),
  };
}

export type SeedPart = CustomerPart & { readonly agreedPrice?: AgreedPriceTerms };

export function encodeCustomerParts(parts: readonly StoredCustomerPart[]): string | undefined {
  return parts.length === 0
    ? undefined
    : JSON.stringify(
        parts.map(({ agreedPrice, ...part }): SeedPart =>
          agreedPrice === undefined
            ? part
            : { ...part, agreedPrice: { basis: agreedPrice.basis, price: agreedPrice.price } },
        ),
      );
}

/**
 * The customer's parts, carried in a hidden field. The field comes back from the browser, so each
 * entry is checked before use and a malformed one is dropped.
 */
export function readCustomerParts(formData: FormData): readonly SeedPart[] {
  const raw = formData.get(CUSTOMER_PARTS_FIELD);
  if (typeof raw !== 'string' || raw === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPart) : [];
  } catch {
    return [];
  }
}

function isPart(value: unknown): value is SeedPart {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const part = value as Record<string, unknown>;
  const feet = part['feetPerRoll'];
  return (
    typeof part['gradeId'] === 'string' &&
    typeof part['rollWidthIn'] === 'number' &&
    (part['partNumber'] === undefined || typeof part['partNumber'] === 'string') &&
    (part['description'] === undefined || typeof part['description'] === 'string') &&
    (feet === undefined ||
      (typeof feet === 'string' && customerPartFeetPerRollSchema.safeParse(feet).success)) &&
    (part['agreedPrice'] === undefined || isAgreedPriceTerms(part['agreedPrice']))
  );
}

function isAgreedPriceTerms(value: unknown): value is AgreedPriceTerms {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const agreed = value as Record<string, unknown>;
  const basis = agreed['basis'];
  const price = agreed['price'];
  return (
    typeof basis === 'string' &&
    (PRICING_BASES as readonly string[]).includes(basis) &&
    typeof price === 'string' &&
    agreedPriceFigureSchema.safeParse(price).success
  );
}

// Only the blank row the page drew is seeded. A stored line keeps what was saved on it.
function isNewLine(formData: FormData, i: number): boolean {
  return formData.get(NEW_LINE_INDEX_FIELD) === String(i);
}

export function blankSelectDefaults(
  formData: FormData,
  i: number,
): { pricingBasis: string; tierOverrideCode: string; freightMode: string } {
  if (!isNewLine(formData, i)) {
    return {
      pricingBasis: HOUSE_PRICING_BASIS,
      tierOverrideCode: HOUSE_TIER_CODE,
      freightMode: HOUSE_FREIGHT_MODE,
    };
  }
  const basis = formData.get(SEED_PRICING_BASIS_FIELD);
  const tier = formData.get(SEED_TIER_CODE_FIELD);
  const mode = formData.get(SEED_FREIGHT_MODE_FIELD);
  return {
    pricingBasis:
      typeof basis === 'string' && (PRICING_BASES as readonly string[]).includes(basis)
        ? basis
        : HOUSE_PRICING_BASIS,
    tierOverrideCode:
      typeof tier === 'string' && tierCodeSchema.safeParse(tier).success ? tier : HOUSE_TIER_CODE,
    freightMode:
      typeof mode === 'string' && (SHIPPING_MODES as readonly string[]).includes(mode)
        ? mode
        : HOUSE_FREIGHT_MODE,
  };
}

export function fillFromCustomerPart(
  formData: FormData,
  i: number,
  line: { gradeId: string; rollWidthIn: number | undefined },
  typed: { customerPartNumber?: string; customerDescription?: string },
): { customerPartNumber?: string; customerDescription?: string } {
  if (
    !isNewLine(formData, i) ||
    typed.customerPartNumber !== undefined ||
    typed.customerDescription !== undefined ||
    line.rollWidthIn === undefined
  ) {
    return typed;
  }
  const part = partFor(readCustomerParts(formData), line.gradeId, line.rollWidthIn);
  if (part === undefined) {
    return typed;
  }
  return {
    ...(part.partNumber === undefined ? {} : { customerPartNumber: part.partNumber }),
    ...(part.description === undefined ? {} : { customerDescription: part.description }),
  };
}

export function fillLengthFromCustomerPart(
  formData: FormData,
  i: number,
  line: { gradeId: string; rollWidthIn: number | undefined },
  typed: string | undefined,
): string | undefined {
  if (
    !isNewLine(formData, i) ||
    formData.get(`lines[${i}].lengthChoice`) !== LENGTH_CHOICE.own ||
    line.rollWidthIn === undefined
  ) {
    return typed;
  }
  return partFor(readCustomerParts(formData), line.gradeId, line.rollWidthIn)?.feetPerRoll ?? typed;
}

export function agreedPriceOfRow(
  parts: readonly {
    gradeId: string;
    rollWidthIn: number;
    agreedPrice?: AgreedPriceTerms | undefined;
  }[],
  gradeId: string,
  widthText: string,
): AgreedPriceTerms | undefined {
  if (gradeId === '' || widthText.trim() === '') {
    return undefined;
  }
  const width = Number(widthText);
  return Number.isFinite(width) ? partFor(parts, gradeId, width)?.agreedPrice : undefined;
}

export interface TypedPrices {
  overridePricePerRoll?: string;
  overridePricePerLb?: string;
  marginOverridePct?: string;
}

/**
 * Fills a new line's hand-set price from the part's agreed price when nothing was typed. It applies only
 * on the same pricing basis, never over a typed price or margin. A line at the agreed price owes no
 * Billing approval: modules/quoting/src/services/quote-service.ts, docs/product/requirements.md (R7).
 */
export function fillAgreedPriceFromCustomerPart(
  formData: FormData,
  i: number,
  line: { gradeId: string; rollWidthIn: number | undefined; basis: string },
  typed: TypedPrices,
): Pick<TypedPrices, 'overridePricePerRoll' | 'overridePricePerLb'> {
  const asTyped = {
    ...(typed.overridePricePerRoll === undefined
      ? {}
      : { overridePricePerRoll: typed.overridePricePerRoll }),
    ...(typed.overridePricePerLb === undefined
      ? {}
      : { overridePricePerLb: typed.overridePricePerLb }),
  };
  if (
    !isNewLine(formData, i) ||
    typed.overridePricePerRoll !== undefined ||
    typed.overridePricePerLb !== undefined ||
    typed.marginOverridePct !== undefined ||
    line.rollWidthIn === undefined
  ) {
    return asTyped;
  }
  const agreed = partFor(readCustomerParts(formData), line.gradeId, line.rollWidthIn)?.agreedPrice;
  if (agreed === undefined || agreed.basis !== line.basis) {
    return asTyped;
  }
  return agreed.basis === 'per_pound'
    ? { overridePricePerLb: agreed.price }
    : { overridePricePerRoll: agreed.price };
}
