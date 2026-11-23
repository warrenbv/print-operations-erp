// Tests reading the agreed price form and the agreed price in words.
import { describe, expect, it } from 'vitest';

import { agreedPriceFigure, agreedPriceHint, agreedPriceLine } from '../../../../lib/agreed-price';
import { REMOVE_AGREED_PRICE_FIELD, collectSetAgreedPrice } from './agreed-price';

const GRADE = '01988a00-0819-7000-8000-000000000001';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    customerId: 'cust-1',
    lockVersion: '3',
    gradeId: GRADE,
    rollWidthIn: '9.75',
    ...fields,
  })) {
    data.set(name, value);
  }
  return data;
}

describe('collectSetAgreedPrice', () => {
  it('reads Save agreed price as the request the route takes', () => {
    expect(collectSetAgreedPrice(form({ basis: 'per_pound', price: '0.69' }))).toEqual({
      ok: true,
      customerId: 'cust-1',
      request: {
        gradeId: GRADE,
        rollWidthIn: 9.75,
        agreedPrice: { basis: 'per_pound', price: '0.69' },
        lockVersion: 3,
      },
    });
  });

  it('reads Remove the agreed price as null, whatever else was posted', () => {
    const result = collectSetAgreedPrice(
      form({ [REMOVE_AGREED_PRICE_FIELD]: '1', basis: 'per_pound', price: 'junk' }),
    );
    expect(result).toMatchObject({ ok: true, request: { agreedPrice: null } });
  });

  it('refuses a blank, zero, signed or five-place figure in the box words', () => {
    expect(collectSetAgreedPrice(form({ basis: 'per_pound', price: '' }))).toEqual({
      ok: false,
      message: 'Enter the agreed price, in dollars.',
    });
    for (const price of ['0', '0.0000', '-1', '0.69001', '$0.69']) {
      const result = collectSetAgreedPrice(form({ basis: 'per_pound', price }));
      expect(result.ok, price).toBe(false);
      expect(result.ok ? '' : result.message).toContain('Agreed price must be dollars');
    }
  });

  it('refuses a basis that is not one, and a form that names no customer', () => {
    expect(collectSetAgreedPrice(form({ basis: 'per_ton', price: '0.69' }))).toEqual({
      ok: false,
      message: 'Choose Per pound or Per roll.',
    });
    expect(collectSetAgreedPrice(form({ customerId: '', basis: 'per_roll', price: '1' }))).toEqual({
      ok: false,
      message: 'That form did not say which customer.',
    });
  });
});

describe('the agreed price in words', () => {
  const agreed = {
    basis: 'per_pound' as const,
    price: '0.6900',
    setBy: 'dev-billing',
    setAt: '2026-11-16T17:00:00.000Z',
  };

  it('keeps four places per pound and prints money per roll', () => {
    expect(agreedPriceFigure(agreed)).toBe('$0.6900 / lb');
    expect(agreedPriceFigure({ basis: 'per_roll', price: '21.7500' })).toBe('$21.75 / roll');
  });

  it('says who set it and on which day, on the part row', () => {
    expect(agreedPriceLine(agreed)).toBe(
      'Agreed price $0.6900 / lb, set by dev-billing on 2026-11-16',
    );
  });

  it('says it under the hand-set box', () => {
    expect(agreedPriceHint(agreed)).toBe(
      'This customer’s agreed price for this part is $0.6900 / lb. At that price no approval is needed.',
    );
  });
});
