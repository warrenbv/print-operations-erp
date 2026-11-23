// Tests the Delivery and tax step: rebuilding each line, same as line 1, saving to the customer, and the tax-code lookup.
import { describe, expect, it } from 'vitest';

import type { Customer, Grade, QuoteLine } from '@erp/types';

import {
  CUSTOMER_LOCK_FIELD,
  CUSTOMER_STALE,
  DELIVERY_SAVED,
  FREIGHT_IN_ROLL_PRICE_FIELD,
  FREIGHT_IN_ROLL_PRICE_HINT,
  FREIGHT_IN_ROLL_PRICE_PER_POUND_HINT,
  LINES_CHANGED,
  SAVE_SHIPPING_FIELD,
  SAVE_TAX_FIELD,
  SHIP_TO_REVEAL_CSS,
  TAX_JURISDICTION_REVEAL_CSS,
  TAX_TICK_REVEAL_CSS,
  collectCustomerWrite,
  collectDelivery,
  customerNotSavedSentence,
  freightInRollPriceChecked,
  hasPerPoundLine,
  offersShippingTick,
  offersTaxTick,
  onFileHint,
  postedFreightInRollPrice,
  postsCustomerTick,
  TAX_LOOKUP_SAVE_FIRST,
  lookupAddress,
  lookupFromQuery,
  lookupRedirect,
  taxLookupAriaLabel,
  taxLookupSentence,
  tickChecked,
} from './collect-delivery';

const GRADE_ID = '9f1c0b8e-2d4a-4b7e-9c31-6a0f5d8e2b74';
const GRADES: ReadonlyMap<string, Grade> = new Map([
  [GRADE_ID, { id: GRADE_ID, widths: [{ rollWidthIn: 12 }] } as unknown as Grade],
]);

const HARBOR = {
  name: 'Dock 4',
  line1: '900 Sample Way',
  city: 'Sample Harbor',
  state: 'WA',
  postalCode: '98000',
};

const stored = (over: Record<string, unknown> = {}) =>
  ({
    id: 'line-1',
    lineNumber: 1,
    gradeId: GRADE_ID,
    footageVariant: 'long',
    rollWidthIn: 12,
    quantityRolls: 40,
    pricingBasis: 'per_roll',
    overwrap: false,
    printed: false,
    revenueCategory: 'print',
    taxStatus: 'id_tax',
    taxJurisdiction: 'ID',
    freight: { mode: 'pickup' },
    ...over,
  }) as unknown as QuoteLine;

function formOf(rows: readonly Record<string, string>[], extra: Record<string, string> = {}) {
  const form = new FormData();
  rows.forEach((row, i) => {
    for (const [field, value] of Object.entries(row)) {
      form.append(`lines[${i}].${field}`, value);
    }
  });
  for (const [key, value] of Object.entries(extra)) {
    form.append(key, value);
  }
  return form;
}

function address(over: Partial<Record<keyof typeof HARBOR | 'line2', string>> = {}) {
  const all = { name: '', line1: '', line2: '', city: '', state: '', postalCode: '', ...over };
  return Object.fromEntries(
    Object.entries(all).map(([field, value]) => [`delivery.${field}`, value]),
  );
}

const tax = (taxStatus: string, taxJurisdiction: string) => ({
  taxStatus,
  taxJurisdiction,
  revenueCategory: 'print',
});

function collectOrThrow(lines: readonly QuoteLine[], form: FormData) {
  const result = collectDelivery({ lines, grades: GRADES, formData: form });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.lines;
}

describe('collectDelivery', () => {
  it('merges a posted address onto a stored line and keeps every other stored value', () => {
    const line = stored({
      rollWidthIn: 17,
      customWidth: true,
      quantityRolls: 25,
      overridePricePerRoll: '44.2500',
      printed: true,
      overwrap: true,
      feetPerRollOverride: '900.0000',
      convertCostPerTon: '48.6000',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
    });
    const [saved] = collectOrThrow(
      [line],
      formOf([{ lineId: 'line-1', ...address(HARBOR), ...tax('wa_tax', 'WA-9137') }]),
    );
    expect(saved).toMatchObject({
      gradeId: GRADE_ID,
      footageVariant: 'long',
      rollWidthIn: 17,
      customWidth: true,
      quantityRolls: 25,
      overridePricePerRoll: '44.2500',
      printed: true,
      overwrap: true,
      feetPerRollOverride: '900.0000',
      convertCostPerTon: '48.6000',
      taxTreatment: { taxStatus: 'wa_tax', taxJurisdiction: 'WA-9137' },
      deliveryAddress: HARBOR,
    });
  });

  it('clears a stored address when all six boxes are posted blank', () => {
    const line = stored({ deliveryAddress: { ...HARBOR, state: 'ID', city: 'Example City' } });
    const [saved] = collectOrThrow(
      [line],
      formOf([{ lineId: 'line-1', ...address(), ...tax('id_tax', 'ID') }]),
    );
    expect(saved).not.toHaveProperty('deliveryAddress');
  });

  it('refuses a partial address and names the line', () => {
    const result = collectDelivery({
      lines: [stored(), stored({ id: 'line-2', lineNumber: 2 })],
      grades: GRADES,
      formData: formOf([
        { lineId: 'line-1', ...address(), ...tax('id_tax', 'ID') },
        {
          lineId: 'line-2',
          ...address({ name: 'Dock 4', line1: '900 Sample Way' }),
          ...tax('id_tax', 'ID'),
        },
      ]),
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(
      /^Line 2: a delivery address needs a street, city, state and ZIP\. Still blank: city, state, ZIP\./,
    );
  });

  it("fills a cleared jurisdiction from the line's tax treatment", () => {
    const [saved] = collectOrThrow(
      [stored()],
      formOf([{ lineId: 'line-1', ...address(), ...tax('id_tax', '') }]),
    );
    expect(saved?.taxTreatment).toEqual({ taxStatus: 'id_tax', taxJurisdiction: 'ID' });
  });

  it('drops the seeded jurisdiction when the line turns non-taxable', () => {
    const [saved] = collectOrThrow(
      [stored()],
      formOf([{ lineId: 'line-1', ...address(), ...tax('non_tax', 'ID') }]),
    );
    expect(saved?.taxTreatment).toEqual({ taxStatus: 'non_tax' });
  });

  it('ignores a box its treatment hides, so a code typed under Washington never refuses', () => {
    const [idaho] = collectOrThrow(
      [stored()],
      formOf([{ lineId: 'line-1', ...address(), ...tax('id_tax', 'WA 9137') }]),
    );
    expect(idaho?.taxTreatment).toEqual({ taxStatus: 'id_tax', taxJurisdiction: 'ID' });

    const [none] = collectOrThrow(
      [stored()],
      formOf([{ lineId: 'line-1', ...address(), ...tax('non_tax', 'WA 9137') }]),
    );
    expect(none?.taxTreatment).toEqual({ taxStatus: 'non_tax' });
  });

  it('shows the Tax jurisdiction field only on Washington taxable, and fails visible', () => {
    const washington = ':has(select[name$=".taxStatus"] option[value="wa_tax"]:checked)';
    expect(TAX_JURISDICTION_REVEAL_CSS).toContain('.tax-jurisdiction {\n  display: contents;\n}');
    expect(TAX_JURISDICTION_REVEAL_CSS).toContain(
      `.delivery-card:not(${washington}) .tax-jurisdiction {\n  display: none;\n}`,
    );

    const rules = TAX_JURISDICTION_REVEAL_CSS.split('}').filter((rule) =>
      rule.includes('display: none'),
    );
    expect(rules).toHaveLength(1);
    expect(rules.every((rule) => rule.includes(':has('))).toBe(true);
  });

  it('takes a freight margin as a percent, and refuses one of 100 or more', () => {
    const line = stored({ freight: { mode: 'carrier' } });
    const [saved] = collectOrThrow(
      [line],
      formOf([{ lineId: 'line-1', ...address(), ...tax('id_tax', 'ID'), freightMarginPct: '12' }]),
    );
    expect(saved?.freight).toEqual({ mode: 'carrier', freightMarginPct: '0.120000' });

    const refused = collectDelivery({
      lines: [line],
      grades: GRADES,
      formData: formOf([
        { lineId: 'line-1', ...address(), ...tax('id_tax', 'ID'), freightMarginPct: '245' },
      ]),
    });
    expect(!refused.ok && refused.message).toBe(
      'Line 1: Freight margin must be under 100%. You entered 245%.',
    );
  });

  it('drops a freight box the mode does not read, and keeps one it does', () => {
    const [pickup] = collectOrThrow(
      [stored()],
      formOf([{ lineId: 'line-1', ...address(), ...tax('id_tax', 'ID'), carrierBid: '371' }]),
    );
    expect(pickup?.freight).toEqual({ mode: 'pickup' });

    const [harbor] = collectOrThrow(
      [stored({ freight: { mode: 'our_vehicle', rateOverride: '86.0000' } })],
      formOf([{ lineId: 'line-1', ...address(), ...tax('id_tax', 'ID'), rateOverride: '95' }]),
    );
    expect(harbor?.freight).toEqual({ mode: 'our_vehicle', rateOverride: '95' });
  });

  it('refuses a jurisdiction that does not fit the ship-to, by address or by billing state', () => {
    const line = stored({ taxStatus: 'wa_tax', taxJurisdiction: 'WA-9137' });
    const byAddress = collectDelivery({
      lines: [line],
      grades: GRADES,
      formData: formOf([
        {
          lineId: 'line-1',
          ...address({ ...HARBOR, state: 'OR', city: 'Demo Port', postalCode: '97000' }),
          ...tax('wa_tax', 'WA-9137'),
        },
      ]),
    });
    expect(!byAddress.ok && byAddress.message).toMatch(
      /^Line 1: tax jurisdiction "WA-9137" .* OR,/,
    );

    const byBilling = collectDelivery({
      lines: [line],
      grades: GRADES,
      formData: formOf([{ lineId: 'line-1', ...address(), ...tax('wa_tax', 'WA-9137') }], {
        billingState: 'ID',
      }),
    });
    expect(!byBilling.ok && byBilling.message).toMatch(
      /^Line 1: tax jurisdiction "WA-9137" .* ID,/,
    );
  });

  it('refuses posted lines that are not the stored ones', () => {
    const mismatched = collectDelivery({
      lines: [stored()],
      grades: GRADES,
      formData: formOf([{ lineId: 'line-9', ...address(), ...tax('id_tax', 'ID') }]),
    });
    expect(!mismatched.ok && mismatched.message).toBe(LINES_CHANGED);

    const missing = collectDelivery({
      lines: [stored(), stored({ id: 'line-2', lineNumber: 2 })],
      grades: GRADES,
      formData: formOf([{ lineId: 'line-1', ...address(), ...tax('id_tax', 'ID') }]),
    });
    expect(!missing.ok && missing.message).toBe(LINES_CHANGED);
  });
});

describe("a later line's Ship to choice", () => {
  const RIDGE = {
    line1: '120 Demo Street',
    city: 'Sample Ridge',
    state: 'ID',
    postalCode: '83040',
  };

  const line1 = stored();

  const line2 = stored({
    id: 'line-2',
    lineNumber: 2,
    deliveryAddress: HARBOR,
    taxStatus: 'wa_tax',
    taxJurisdiction: 'WA-9137',
    revenueCategory: 'label',
    freight: { mode: 'carrier', carrierBid: '257.0000' },
  });

  it("saves line 1's address and tax as posted in this save, and keeps its own revenue and freight", () => {
    const [one, two] = collectOrThrow(
      [line1, line2],
      formOf([
        { lineId: 'line-1', ...address(RIDGE), ...tax('id_tax', 'ID') },
        {
          lineId: 'line-2',
          shipTo: 'same',
          ...address(HARBOR),
          taxStatus: 'wa_tax',
          taxJurisdiction: 'WA-9137',
          revenueCategory: 'label',
          carrierBid: '436',
        },
      ]),
    );
    expect(one?.deliveryAddress).toEqual(RIDGE);
    expect(two).toMatchObject({
      deliveryAddress: RIDGE,
      taxTreatment: { taxStatus: 'id_tax', taxJurisdiction: 'ID' },
      revenueCategory: 'label',
      freight: { mode: 'carrier', carrierBid: '436' },
    });
  });

  it('saves no address on Same as line 1 when line 1 posts none: two blanks are equal', () => {
    const [, two] = collectOrThrow(
      [line1, line2],
      formOf([
        { lineId: 'line-1', ...address(), ...tax('id_tax', 'ID') },
        { lineId: 'line-2', shipTo: 'same', ...address(HARBOR), ...tax('wa_tax', 'WA-9137') },
      ]),
    );
    expect(two).not.toHaveProperty('deliveryAddress');
    expect(two?.taxTreatment).toEqual({ taxStatus: 'id_tax', taxJurisdiction: 'ID' });
  });

  it('saves no address on No delivery address, whatever its hidden boxes hold, and its own tax', () => {
    const [, two] = collectOrThrow(
      [line1, line2],
      formOf(
        [
          { lineId: 'line-1', ...address(RIDGE), ...tax('id_tax', 'ID') },
          {
            lineId: 'line-2',
            shipTo: 'collected',
            ...address(HARBOR),
            ...tax('wa_tax', 'WA-9137'),
          },
        ],

        { billingState: 'WA' },
      ),
    );
    expect(two).not.toHaveProperty('deliveryAddress');
    expect(two?.taxTreatment).toEqual({ taxStatus: 'wa_tax', taxJurisdiction: 'WA-9137' });
  });

  it('saves its own boxes on A different address, on no choice, and on one the select cannot hold', () => {
    for (const choice of [{ shipTo: 'different' }, {}, { shipTo: 'line-3' }]) {
      const [, two] = collectOrThrow(
        [line1, line2],
        formOf([
          { lineId: 'line-1', ...address(RIDGE), ...tax('id_tax', 'ID') },
          { lineId: 'line-2', ...choice, ...address(HARBOR), ...tax('wa_tax', 'WA-9137') },
        ]),
      );
      expect(two?.deliveryAddress).toEqual(HARBOR);
      expect(two?.taxTreatment).toEqual({ taxStatus: 'wa_tax', taxJurisdiction: 'WA-9137' });
    }
  });

  it('ignores a choice posted for line 1, which has no select', () => {
    const [one] = collectOrThrow(
      [line1, line2],
      formOf([
        { lineId: 'line-1', shipTo: 'collected', ...address(RIDGE), ...tax('id_tax', 'ID') },
        { lineId: 'line-2', ...address(HARBOR), ...tax('wa_tax', 'WA-9137') },
      ]),
    );
    expect(one?.deliveryAddress).toEqual(RIDGE);
  });

  it('shows each group only while the choice asks for it, and fails visible', () => {
    const chosen = (choice: string) =>
      `:has(select[name$=".shipTo"] option[value="${choice}"]:checked)`;
    expect(SHIP_TO_REVEAL_CSS).toContain(
      `.delivery-card:has(select[name$=".shipTo"]):not(${chosen('different')}) .ship-to-own-address {`,
    );
    expect(SHIP_TO_REVEAL_CSS).toContain(`.delivery-card${chosen('same')} .ship-to-own-tax {`);
    expect(SHIP_TO_REVEAL_CSS).toContain(
      `.delivery-card:not(${chosen('same')}) .ship-to-same-as-line-1 {`,
    );

    const rules = SHIP_TO_REVEAL_CSS.split('}').filter((rule) => rule.includes('display: none'));
    expect(rules).toHaveLength(3);
    expect(rules.every((rule) => rule.includes(':has('))).toBe(true);
  });
});

describe("the quote's freight-in-the-price box", () => {
  const perPound = stored({ id: 'line-2', lineNumber: 2, pricingBasis: 'per_pound' });

  it('sends true when the box is ticked and every line is per roll', () => {
    const form = formOf([{ lineId: 'line-1' }], { [FREIGHT_IN_ROLL_PRICE_FIELD]: 'on' });
    expect(postedFreightInRollPrice(form, [stored()])).toBe(true);
  });

  it('sends false when the box is left unticked, which posts nothing', () => {
    const form = formOf([{ lineId: 'line-1' }]);
    expect(postedFreightInRollPrice(form, [stored()])).toBe(false);
  });

  it('sends no flag at all while a per-pound line disables the box', () => {
    const form = formOf([{ lineId: 'line-1' }, { lineId: 'line-2' }]);
    expect(postedFreightInRollPrice(form, [stored(), perPound])).toBeUndefined();
    expect(hasPerPoundLine([stored(), perPound])).toBe(true);
    expect(hasPerPoundLine([stored()])).toBe(false);
  });

  it('renders ticked from the stored flag on an ordinary load', () => {
    expect(freightInRollPriceChecked(true, {})).toBe(true);
    expect(freightInRollPriceChecked(false, {})).toBe(false);
  });

  it('renders as posted when a refused save sent the form back', () => {
    const refusedTicked = { 'lines[0].lineId': 'line-1', [FREIGHT_IN_ROLL_PRICE_FIELD]: 'on' };
    const refusedUnticked = { 'lines[0].lineId': 'line-1' };
    expect(freightInRollPriceChecked(false, refusedTicked)).toBe(true);
    expect(freightInRollPriceChecked(true, refusedUnticked)).toBe(false);
  });

  it('says why the box is disabled, and what it changes when it is not', () => {
    expect(FREIGHT_IN_ROLL_PRICE_PER_POUND_HINT).toBe(
      'Freight stays separate while a line is priced per pound, which is billed on the shipped weight.',
    );
    expect(FREIGHT_IN_ROLL_PRICE_HINT).toContain(
      'Each line still keeps its freight as a separate figure.',
    );
  });
});

describe("a line's value saved to the customer's record", () => {
  const SPRINGS = {
    name: 'Receiving',
    line1: '638 Demo Way',
    city: 'Sample City',
    state: 'ID',
    postalCode: '83030',
  };
  const customerOf = (over: Record<string, unknown> = {}) =>
    ({
      id: 'customer-1',
      name: 'Example Demo Paper',
      taxExempt: false,
      reseller: false,
      taxJurisdiction: 'ID',
      shippingAddress: SPRINGS,
      lockVersion: 4,
      ...over,
    }) as unknown as Customer;

  const line1 = stored();
  const line2 = stored({ id: 'line-2', lineNumber: 2 });
  const RIDGE = {
    line1: '120 Demo Street',
    city: 'Sample Ridge',
    state: 'ID',
    postalCode: '83040',
  };
  const ON = 'on';

  function writeOf(
    rows: readonly Record<string, string>[],
    customer: Customer | null = customerOf(),
    lines: readonly QuoteLine[] = [line1, line2].slice(0, rows.length),
    lock = '4',
  ) {
    const form = formOf(rows, { [CUSTOMER_LOCK_FIELD]: lock });
    return collectCustomerWrite({
      lines,
      saved: collectOrThrow(lines, form),
      customer,
      formData: form,
    });
  }

  it('offers the address tick whenever the customer was read', () => {
    expect(offersShippingTick(customerOf())).toBe(true);
    expect(offersShippingTick(customerOf({ shippingAddress: undefined }))).toBe(true);
    expect(offersShippingTick(null)).toBe(false);
  });

  it('offers no tax tick for an exempt or reseller customer', () => {
    expect(offersTaxTick(customerOf())).toBe(true);
    expect(offersTaxTick(customerOf({ taxExempt: true }))).toBe(false);
    expect(offersTaxTick(customerOf({ reseller: true }))).toBe(false);
    expect(offersTaxTick(null)).toBe(false);
  });

  it('shows the tax tick only for a taxable treatment, and the hint only for Non-taxable', () => {
    const chosen = (status: string) =>
      `:has(select[name$=".taxStatus"] option[value="${status}"]:checked)`;
    expect(TAX_TICK_REVEAL_CSS).toContain(
      `.delivery-card:not(${chosen('id_tax')}):not(${chosen('wa_tax')}) .tax-tick {`,
    );
    expect(TAX_TICK_REVEAL_CSS).toContain(
      `.delivery-card:not(${chosen('non_tax')}) .non-tax-hint {`,
    );
    expect(TAX_TICK_REVEAL_CSS.match(/display: none;/g)).toHaveLength(2);
  });

  it('says what is on file under each tick', () => {
    expect(onFileHint('WA-9010')).toBe('On file now: WA-9010.');
    expect(onFileHint(undefined)).toBe('None on file now.');
  });

  it('renders a tick ticked only as a refused save posted it', () => {
    expect(tickChecked({}, 0, SAVE_SHIPPING_FIELD)).toBe(false);
    expect(tickChecked({ [`lines[1].${SAVE_TAX_FIELD}`]: ON }, 1, SAVE_TAX_FIELD)).toBe(true);
    expect(tickChecked({ [`lines[1].${SAVE_TAX_FIELD}`]: ON }, 0, SAVE_TAX_FIELD)).toBe(false);
  });

  it('knows whether any tick was posted, so the action reads the customer only then', () => {
    expect(postsCustomerTick(formOf([{ lineId: 'line-1' }]))).toBe(false);
    expect(
      postsCustomerTick(formOf([{ lineId: 'line-1' }, { lineId: 'line-2', [SAVE_TAX_FIELD]: ON }])),
    ).toBe(true);
  });

  it('writes nothing and says nothing more when no tick is posted', () => {
    const write = writeOf([
      { lineId: 'line-1', ...address(RIDGE), ...tax('id_tax', 'ID') },
      { lineId: 'line-2', ...address(SPRINGS), ...tax('id_tax', 'ID') },
    ]);
    expect(write).toEqual({ ok: true, body: null, notice: DELIVERY_SAVED });
  });

  it("builds the PATCH from the line's saved address, with the lock version the page read", () => {
    const write = writeOf([
      { lineId: 'line-1', ...address(RIDGE), ...tax('id_tax', 'ID'), [SAVE_SHIPPING_FIELD]: ON },
      { lineId: 'line-2', ...address(SPRINGS), ...tax('id_tax', 'ID') },
    ]);
    expect(write).toEqual({
      ok: true,
      body: { shippingAddress: RIDGE, lockVersion: 4 },
      notice: "Delivery and tax saved. The customer's shipping address now matches line 1.",
    });
  });

  it('sends no PATCH for a value already on file, and the notice says it already matched', () => {
    const write = writeOf([
      { lineId: 'line-1', ...address(SPRINGS), ...tax('id_tax', 'ID'), [SAVE_SHIPPING_FIELD]: ON },
    ]);
    expect(write).toEqual({
      ok: true,
      body: null,
      notice: "Delivery and tax saved. The customer's shipping address already matched line 1.",
    });

    const sameCode = writeOf([
      { lineId: 'line-1', ...address(SPRINGS), ...tax('id_tax', 'ID'), [SAVE_TAX_FIELD]: ON },
    ]);
    expect(sameCode).toEqual({
      ok: true,
      body: null,
      notice: "Delivery and tax saved. The customer's tax jurisdiction already matched line 1.",
    });
  });

  it('writes the jurisdiction the line saves with, after the treatment rule fills it', () => {
    const write = writeOf(
      [{ lineId: 'line-1', ...address(), ...tax('id_tax', ''), [SAVE_TAX_FIELD]: ON }],
      customerOf({ taxJurisdiction: 'WA-9137' }),
    );
    expect(write).toEqual({
      ok: true,
      body: { taxJurisdiction: 'ID', lockVersion: 4 },
      notice: "Delivery and tax saved. The customer's tax jurisdiction now matches line 1.",
    });
  });

  it('carries both fields in one PATCH', () => {
    const write = writeOf(
      [
        { lineId: 'line-1', ...address(HARBOR), ...tax('wa_tax', 'WA-9010') },
        {
          lineId: 'line-2',
          ...address(HARBOR),
          ...tax('wa_tax', 'WA-9010'),
          [SAVE_SHIPPING_FIELD]: ON,
          [SAVE_TAX_FIELD]: ON,
        },
      ],
      customerOf(),
    );
    expect(write).toEqual({
      ok: true,
      body: { shippingAddress: HARBOR, taxJurisdiction: 'WA-9010', lockVersion: 4 },
      notice:
        "Delivery and tax saved. The customer's shipping address now matches line 2. " +
        "The customer's tax jurisdiction now matches line 2.",
    });
  });

  it('ignores both ticks on a line on Same as line 1, which hides them', () => {
    const write = writeOf(
      [
        { lineId: 'line-1', ...address(HARBOR), ...tax('wa_tax', 'WA-9010') },
        {
          lineId: 'line-2',
          shipTo: 'same',
          ...address(RIDGE),
          ...tax('id_tax', 'ID'),
          [SAVE_SHIPPING_FIELD]: ON,
          [SAVE_TAX_FIELD]: ON,
        },
      ],
      customerOf(),
    );
    expect(write).toEqual({ ok: true, body: null, notice: DELIVERY_SAVED });
  });

  it('ignores the address tick on No delivery address, and keeps its tax tick', () => {
    const write = writeOf(
      [
        { lineId: 'line-1', ...address(SPRINGS), ...tax('id_tax', 'ID') },
        {
          lineId: 'line-2',
          shipTo: 'collected',
          ...address(RIDGE),
          ...tax('id_tax', 'ID'),
          [SAVE_SHIPPING_FIELD]: ON,
          [SAVE_TAX_FIELD]: ON,
        },
      ],
      customerOf({ taxJurisdiction: 'WA-9010' }),
    );
    expect(write).toEqual({
      ok: true,
      body: { taxJurisdiction: 'ID', lockVersion: 4 },
      notice: "Delivery and tax saved. The customer's tax jurisdiction now matches line 2.",
    });
  });

  it('ignores a tax tick on a Non-taxable line: no taxJurisdiction in the PATCH', () => {
    const write = writeOf([
      {
        lineId: 'line-1',
        ...address(RIDGE),
        ...tax('non_tax', ''),
        [SAVE_SHIPPING_FIELD]: ON,
        [SAVE_TAX_FIELD]: ON,
      },
    ]);
    expect(write.ok && write.body).toEqual({ shippingAddress: RIDGE, lockVersion: 4 });
    expect(write.ok && write.body).not.toHaveProperty('taxJurisdiction');
  });

  it('ignores a tax tick for an exempt or reseller customer: no taxJurisdiction in the PATCH', () => {
    for (const customer of [customerOf({ taxExempt: true }), customerOf({ reseller: true })]) {
      const write = writeOf(
        [
          {
            lineId: 'line-1',
            ...address(HARBOR),
            ...tax('wa_tax', 'WA-9010'),
            [SAVE_SHIPPING_FIELD]: ON,
            [SAVE_TAX_FIELD]: ON,
          },
        ],
        customer,
      );
      expect(write.ok && write.body).toEqual({ shippingAddress: HARBOR, lockVersion: 4 });
      expect(write.ok && write.body).not.toHaveProperty('taxJurisdiction');
    }
  });

  it('refuses two lines ticked with different addresses, naming the lines', () => {
    const write = writeOf([
      { lineId: 'line-1', ...address(RIDGE), ...tax('id_tax', 'ID'), [SAVE_SHIPPING_FIELD]: ON },
      { lineId: 'line-2', ...address(SPRINGS), ...tax('id_tax', 'ID'), [SAVE_SHIPPING_FIELD]: ON },
    ]);
    expect(write).toEqual({
      ok: false,
      message:
        "Lines 1 and 2 are both ticked to save a shipping address on the customer's record, " +
        'and the addresses differ. Untick one, or make them match.',
    });
  });

  it('refuses two lines ticked with different jurisdictions, naming the lines', () => {
    const write = writeOf(
      [
        {
          lineId: 'line-1',
          ...address(HARBOR),
          ...tax('wa_tax', 'WA-9137'),
          [SAVE_TAX_FIELD]: ON,
        },
        {
          lineId: 'line-2',
          ...address(HARBOR),
          ...tax('wa_tax', 'WA-9010'),
          [SAVE_TAX_FIELD]: ON,
        },
      ],
      customerOf(),
    );
    expect(write).toEqual({
      ok: false,
      message:
        "Lines 1 and 2 are both ticked to save a tax jurisdiction on the customer's record, " +
        'and the jurisdictions differ. Untick one, or make them match.',
    });
  });

  it('takes two lines ticked with the same value as one write, naming both', () => {
    const write = writeOf([
      { lineId: 'line-1', ...address(RIDGE), ...tax('id_tax', 'ID'), [SAVE_SHIPPING_FIELD]: ON },
      { lineId: 'line-2', ...address(RIDGE), ...tax('id_tax', 'ID'), [SAVE_SHIPPING_FIELD]: ON },
    ]);
    expect(write).toEqual({
      ok: true,
      body: { shippingAddress: RIDGE, lockVersion: 4 },
      notice: "Delivery and tax saved. The customer's shipping address now matches lines 1 and 2.",
    });
  });

  it('refuses a ticked address on a line with none', () => {
    const write = writeOf([
      { lineId: 'line-1', ...address(), ...tax('id_tax', 'ID'), [SAVE_SHIPPING_FIELD]: ON },
    ]);
    expect(write).toEqual({
      ok: false,
      message:
        "Line 1 has no delivery address to save on the customer's record. Fill it in, or untick the box.",
    });
  });

  it("refuses with the step's stale sentence when the customer moved on since the page was drawn", () => {
    expect(CUSTOMER_STALE).toBe(
      'Save failed: this changed while you were reading it, so nothing was saved. Reload and check the new figures before trying again.',
    );
    const row = {
      lineId: 'line-1',
      ...address(RIDGE),
      ...tax('id_tax', 'ID'),
      [SAVE_SHIPPING_FIELD]: ON,
    };
    expect(writeOf([row], customerOf({ lockVersion: 5 }))).toEqual({
      ok: false,
      message: CUSTOMER_STALE,
    });
    expect(writeOf([row], customerOf(), [line1], '')).toEqual({
      ok: false,
      message: CUSTOMER_STALE,
    });
  });

  it('writes nothing when the customer could not be read', () => {
    const write = writeOf(
      [
        {
          lineId: 'line-1',
          ...address(RIDGE),
          ...tax('id_tax', 'ID'),
          [SAVE_SHIPPING_FIELD]: ON,
        },
      ],
      null,
    );
    expect(write).toEqual({ ok: true, body: null, notice: DELIVERY_SAVED });
  });

  it('words a write refused after the lines saved: a 409 and a server failure have their own', () => {
    expect(customerNotSavedSentence(409)).toBe(
      "Delivery and tax saved. The customer's record was not changed, because somebody saved the customer while this page was open. Check it on the customer page.",
    );

    expect(customerNotSavedSentence(500)).toBe(
      "Delivery and tax saved. The customer's record was not changed, because the server failed. Tick it again, and tell IT if it fails twice.",
    );
    expect(customerNotSavedSentence(503)).toBe(customerNotSavedSentence(500));

    expect(customerNotSavedSentence(403)).toBeUndefined();
    expect(customerNotSavedSentence(400)).toBeUndefined();
  });
});

describe('"Look up tax code"', () => {
  const WAREHOUSE = {
    line1: '470 Demo Avenue',
    city: 'Sample Harbor',
    state: 'WA',
    postalCode: '98000',
  };
  const MATCHED = {
    outcome: 'matched',
    locationCode: '9010',
    key: 'WA-9010',
    name: 'SAMPLE CITY',
    ourRate: '0.087000',
    effectiveFrom: '2026-10-01',
    stateRate: '0.087',
  } as const;

  describe('lookupAddress: the address a save would keep for the line', () => {
    it("reads line 1's own boxes", () => {
      const form = formOf([{ lineId: 'a', ...address(WAREHOUSE) }]);
      expect(lookupAddress(form, 0, 0)).toEqual({
        line1: '470 Demo Avenue',
        city: 'Sample Harbor',
        postalCode: '98000',
        state: 'WA',
      });
    });

    it('reads a later line on "A different address" from its own boxes', () => {
      const form = formOf([
        { lineId: 'a', ...address(HARBOR) },
        { lineId: 'b', shipTo: 'different', ...address(WAREHOUSE) },
      ]);
      expect(lookupAddress(form, 1, 0)).toMatchObject({ line1: '470 Demo Avenue' });
    });

    it('reads a line on "Same as line 1" from line 1\'s boxes, as the save does', () => {
      const form = formOf([
        { lineId: 'a', ...address(WAREHOUSE) },
        { lineId: 'b', shipTo: 'same', ...address(HARBOR) },
      ]);
      expect(lookupAddress(form, 1, 0)).toMatchObject({ line1: '470 Demo Avenue' });
    });

    it('reads a collected line as having no address, whatever its hidden boxes hold', () => {
      const form = formOf([
        { lineId: 'a', ...address(HARBOR) },
        { lineId: 'b', shipTo: 'collected', ...address(WAREHOUSE) },
      ]);
      expect(lookupAddress(form, 1, 0)).toEqual({
        line1: '',
        city: '',
        postalCode: '',
        state: '',
      });
    });
  });

  describe('lookupRedirect: back to the card, with the form and the answer', () => {
    const echo = {
      'was.lines[0].delivery.line1': '470 Demo Avenue',
      'was.lines[0].taxJurisdiction': 'WA-0000',
    };
    const base = {
      path: '/quoting/quotes/q1/delivery',
      index: 0,
      lineNumber: 1,
      echo,
      lockVersion: '7',
    };
    const queryOf = (url: string) =>
      new URLSearchParams(url.slice(url.indexOf('?') + 1).split('#')[0]);

    it('fills the box over what was typed, and lands on the card', () => {
      const url = lookupRedirect({ ...base, result: MATCHED });
      expect(url.startsWith('/quoting/quotes/q1/delivery?')).toBe(true);
      expect(url.endsWith('#line-1')).toBe(true);
      const query = queryOf(url);
      expect(query.get('was.lines[0].taxJurisdiction')).toBe('WA-9010');
      expect(query.get('was.lines[0].delivery.line1')).toBe('470 Demo Avenue');
      expect(query.get('linesDrawnAt')).toBe('7');
      expect(query.get('lookup.line')).toBe('0');
      expect(query.get('lookup.key')).toBe('WA-9010');
    });

    it('keeps what was typed when the answer does not fill', () => {
      for (const result of [
        { outcome: 'not_loaded', locationCode: '9015', key: 'WA-9015', stateRate: '0.078' },
        { outcome: 'zip_only' },
        { outcome: 'unavailable' },
      ] as const) {
        const query = queryOf(lookupRedirect({ ...base, result }));
        expect(query.get('was.lines[0].taxJurisdiction')).toBe('WA-0000');
        expect(query.get('lookup.outcome')).toBe(result.outcome);
      }
    });

    it('carries no form when the echo could not travel, only the sentence', () => {
      const query = queryOf(
        lookupRedirect({ ...base, echo: {}, result: { outcome: 'save_first' } }),
      );
      expect([...query.keys()]).toEqual(['lookup.line', 'lookup.outcome']);
    });

    it('reads back as the same answer on the page', () => {
      const url = lookupRedirect({ ...base, index: 2, lineNumber: 3, result: MATCHED });
      const query = Object.fromEntries(queryOf(url).entries());
      expect(lookupFromQuery(query)).toEqual({ index: 2, result: MATCHED });
      expect(
        lookupFromQuery(
          Object.fromEntries(
            queryOf(lookupRedirect({ ...base, result: { outcome: 'save_first' } })).entries(),
          ),
        ),
      ).toEqual({ index: 0, result: { outcome: 'save_first' } });
    });

    it('reads nothing from a URL with no press, or with one that does not read', () => {
      expect(lookupFromQuery({})).toBeUndefined();
      expect(lookupFromQuery({ 'lookup.line': 'x', 'lookup.outcome': 'matched' })).toBeUndefined();
      expect(lookupFromQuery({ 'lookup.line': '0', 'lookup.outcome': 'maybe' })).toBeUndefined();
    });
  });

  describe('taxLookupSentence', () => {
    it('names the place and our rate, and says to save', () => {
      expect(taxLookupSentence(MATCHED)).toBe(
        'The state matched this address: WA-9010 SAMPLE CITY, our rate 8.7% from 2026-10-01. Press Save to keep it.',
      );
    });

    it('asks the person to check the address on a ZIP+4 match and a corrected one', () => {
      expect(taxLookupSentence({ ...MATCHED, outcome: 'matched_zip4' })).toBe(
        'The state matched the ZIP+4: WA-9010 SAMPLE CITY, our rate 8.7% from 2026-10-01. Check the address before you save.',
      );
      expect(taxLookupSentence({ ...MATCHED, outcome: 'corrected' })).toBe(
        'The state corrected the address to find it: WA-9010 SAMPLE CITY, our rate 8.7% from 2026-10-01. Check the address before you save.',
      );
    });

    it("names both rates when the state's differs from ours", () => {
      expect(taxLookupSentence({ ...MATCHED, stateRate: '0.088' })).toBe(
        'The state matched this address: WA-9010 SAMPLE CITY, our rate 8.7% from 2026-10-01. ' +
          "The state's rate is 8.8%, not 8.7%, so the current quarter may not be loaded yet. " +
          'Press Save to keep it.',
      );
    });

    it('names the key alone when our row has no name', () => {
      const nameless = { ...MATCHED, name: undefined };
      expect(taxLookupSentence(nameless)).toMatch(/^The state matched this address: WA-9010, our/);
    });

    it('says each other outcome in its own words', () => {
      expect(
        taxLookupSentence({
          outcome: 'not_loaded',
          locationCode: '9015',
          key: 'WA-9015',
          stateRate: '0.078',
        }),
      ).toBe(
        'The state says location 9015, but no rate is loaded for WA-9015. Load the current quarter on Settings > Tax rates.',
      );
      expect(taxLookupSentence({ outcome: 'zip_only' })).toBe(
        'The state matched only the ZIP code, which covers more than one tax location. Type the code.',
      );
      expect(taxLookupSentence({ outcome: 'not_found' })).toBe(
        'The state found no match for this address. Type the code.',
      );
      expect(taxLookupSentence({ outcome: 'unavailable' })).toBe(
        "The state's lookup could not be reached. Type the code as before.",
      );
      expect(taxLookupSentence({ outcome: 'not_washington' })).toBe(
        'This line does not ship to Washington.',
      );
      expect(taxLookupSentence({ outcome: 'incomplete_address' })).toBe(
        'The lookup is for a Washington street address. Type the street and ZIP first.',
      );
      expect(taxLookupSentence({ outcome: 'save_first' })).toBe(TAX_LOOKUP_SAVE_FIRST);
    });

    it('gives each button a name that says which line', () => {
      expect(taxLookupAriaLabel(2)).toBe('Look up tax code for line 2');
    });
  });
});
