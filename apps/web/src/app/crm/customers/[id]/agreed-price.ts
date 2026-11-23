// Reads the form that sets or removes the agreed price on one of a customer's parts.
// A price is dollars greater than zero with at most four decimal places, kept as a string.
import {
  PRICING_BASES,
  setAgreedPriceRequestSchema,
  type PricingBasis,
  type SetAgreedPriceRequest,
} from '@erp/types';
import { optionalString } from '@erp/utils';

export const REMOVE_AGREED_PRICE_FIELD = 'remove';

export const AGREED_PRICE_PATTERN = '\\d+(\\.\\d{1,4})?';

const AGREED_PRICE_TEXT = new RegExp(`^(?:${AGREED_PRICE_PATTERN})$`);

export type CollectedAgreedPrice =
  { ok: true; customerId: string; request: SetAgreedPriceRequest } | { ok: false; message: string };

export function collectSetAgreedPrice(formData: FormData): CollectedAgreedPrice {
  const customerId = formData.get('customerId');
  if (typeof customerId !== 'string' || customerId === '') {
    return { ok: false, message: 'That form did not say which customer.' };
  }
  const remove = formData.get(REMOVE_AGREED_PRICE_FIELD) !== null;

  let agreedPrice: SetAgreedPriceRequest['agreedPrice'] = null;
  if (!remove) {
    const basis = optionalString(formData, 'basis');
    if (basis === undefined || !(PRICING_BASES as readonly string[]).includes(basis)) {
      return { ok: false, message: 'Choose Per pound or Per roll.' };
    }
    const price = optionalString(formData, 'price');
    if (price === undefined) {
      return { ok: false, message: 'Enter the agreed price, in dollars.' };
    }
    if (!AGREED_PRICE_TEXT.test(price) || Number(price) <= 0) {
      return {
        ok: false,
        message: `Agreed price must be dollars greater than 0, at most four places, such as 0.6400. You entered "${price}".`,
      };
    }
    agreedPrice = { basis: basis as PricingBasis, price };
  }

  const parsed = setAgreedPriceRequestSchema.safeParse({
    gradeId: formData.get('gradeId'),
    rollWidthIn: Number(formData.get('rollWidthIn')),
    agreedPrice,
    lockVersion: Number(formData.get('lockVersion')),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      message: `Could not read the form${issue === undefined ? '' : `: ${issue.path.join('.')} ${issue.message}`}.`,
    };
  }
  return { ok: true, customerId, request: parsed.data };
}
