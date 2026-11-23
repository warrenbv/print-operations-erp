// Words for a customer's agreed price on a part: the line on the customer page and the hint on the Lines step.
// The figure is printed by the shared formatters in packages/types/src/decimal.ts, which work on the decimal string.
// The agreed price itself is defined in packages/types/src/customer-defaults.ts.
import { formatMoney, formatPricePerPound, type AgreedPrice } from '@erp/types';

import { formatDay } from './dates';

export function agreedPriceFigure(agreed: Pick<AgreedPrice, 'basis' | 'price'>): string {
  return agreed.basis === 'per_pound'
    ? `${formatPricePerPound(agreed.price)} / lb`
    : `${formatMoney(agreed.price)} / roll`;
}

export function agreedPriceLine(agreed: AgreedPrice): string {
  return `Agreed price ${agreedPriceFigure(agreed)}, set by ${agreed.setBy} on ${formatDay(agreed.setAt)}`;
}

export function agreedPriceHint(agreed: Pick<AgreedPrice, 'basis' | 'price'>): string {
  return `This customer’s agreed price for this part is ${agreedPriceFigure(agreed)}. At that price no approval is needed.`;
}
