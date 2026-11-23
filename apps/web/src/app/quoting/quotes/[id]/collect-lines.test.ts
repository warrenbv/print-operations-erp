// Tests reading the line form, and checks that what it produces passes the API's request schema.
import { SHIPPING_MODES, setQuoteLinesRequestSchema, type QuoteLine } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { STEP_THREE_FIELDS } from './collect-delivery';
import { collectLines } from './collect-lines';
import {
  FREIGHT_BOX_ORDER,
  FREIGHT_FIELD,
  MARGIN_ENTERED_CHOICE,
  MARGIN_FLOOR_FIELD,
  deliveryTaxValues,
  freightBoxes,
  freightDefaults,
  stepThreeHiddenValues,
  storedLineValues,
  type FreightBox,
} from './line-defaults';

const GRADE_ID = '9f1c0b8e-2d4a-4b7e-9c31-6a0f5d8e2b74';

const RENDERED_ROW: Record<string, string> = {
  paper: `${GRADE_ID}:long`,
  rollWidthIn: '18',
  quantityRolls: '40',
  tierOverrideCode: '',
  overridePricePerRoll: '',
  overridePricePerLb: '',

  pricingBasis: 'per_roll',

  orderedWeightLb: '',

  customerPartNumber: '',
  customerDescription: '',

  convertCostPerTon: '',
  printCostPerTon: '',
  freightMode: 'pickup',
  rateOverride: '',
  carrierBid: '',
  freightMarginPct: '',
  revenueCategory: 'print',
  taxStatus: 'id_tax',
  taxJurisdiction: 'ID',

  'delivery.name': '',
  'delivery.line1': '',
  'delivery.line2': '',
  'delivery.city': '',
  'delivery.state': '',
  'delivery.postalCode': '',
};

const HARBOR_ROW: Record<string, string> = {
  taxStatus: 'wa_tax',
  taxJurisdiction: 'WA-9137',
  'delivery.name': 'Receiving',
  'delivery.line1': '500 Sample Road',
  'delivery.line2': 'Dock 3',
  'delivery.city': 'Sample Harbor',
  'delivery.state': 'WA',
  'delivery.postalCode': '98000-3381',
};

function formOf(...rows: Record<string, string>[]): FormData {
  const form = new FormData();
  form.set('quoteId', '4d2b9a10-7c53-4a8f-b0e6-1f9c3d5a8e02');
  rows.forEach((row, i) => {
    for (const [field, value] of Object.entries(row)) {
      form.set(`lines[${i}].${field}`, value);
    }
  });
  return form;
}

function collectOrThrow(form: FormData) {
  const result = collectLines(form);
  if (!result.ok) {
    throw new Error(`collectLines rejected the form: ${result.message}`);
  }
  return result.lines;
}

const LOCK_VERSION = 3;

describe('collectLines → the save endpoint', () => {
  it('builds a payload the PUT :id/lines schema accepts', () => {
    const lines = collectOrThrow(formOf(RENDERED_ROW));

    const parsed = setQuoteLinesRequestSchema.safeParse({ lines, lockVersion: LOCK_VERSION });

    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('carries the classification the form collected', () => {
    const lines = collectOrThrow(formOf(RENDERED_ROW));

    expect(lines[0]?.revenueCategory).toBe('print');
    expect(lines[0]?.taxTreatment).toEqual({ taxStatus: 'id_tax', taxJurisdiction: 'ID' });
  });

  it('carries the Pricing Basis the form collected', () => {
    expect(collectOrThrow(formOf(RENDERED_ROW))[0]?.pricingBasis).toBe('per_roll');

    const perPound = collectOrThrow(
      formOf({ ...RENDERED_ROW, pricingBasis: 'per_pound', orderedWeightLb: '1000' }),
    );
    expect(perPound[0]?.pricingBasis).toBe('per_pound');
    expect(perPound[0]?.orderedWeightLb).toBe('1000');
    expect(
      setQuoteLinesRequestSchema.safeParse({ lines: perPound, lockVersion: LOCK_VERSION }).success,
    ).toBe(true);
  });

  it('carries a hand-set price per pound', () => {
    const typed = collectOrThrow(
      formOf({ ...RENDERED_ROW, pricingBasis: 'per_pound', overridePricePerLb: '0.8350' }),
    );

    expect(typed[0]?.overridePricePerLb).toBe('0.8350');
    expect(
      setQuoteLinesRequestSchema.safeParse({ lines: typed, lockVersion: LOCK_VERSION }).success,
    ).toBe(true);

    const blank = collectOrThrow(formOf({ ...RENDERED_ROW, pricingBasis: 'per_pound' }));
    expect(blank[0]).not.toHaveProperty('overridePricePerLb');
  });

  it('carries the costs per US ton as typed, and the endpoint takes them', () => {
    const lines = collectOrThrow(
      formOf({ ...RENDERED_ROW, convertCostPerTon: '200', printCostPerTon: ' 196.2500 ' }),
    );

    expect(lines[0]).toMatchObject({ convertCostPerTon: '200', printCostPerTon: '196.2500' });
    expect(setQuoteLinesRequestSchema.safeParse({ lines, lockVersion: LOCK_VERSION }).success).toBe(
      true,
    );
  });

  it('sends nothing for a blank cost, which clears a stored one', () => {
    const [line] = collectOrThrow(formOf(RENDERED_ROW));

    expect(line).not.toHaveProperty('convertCostPerTon');
    expect(line).not.toHaveProperty('printCostPerTon');
  });

  it('keeps a typed 0, which is a value', () => {
    const [line] = collectOrThrow(formOf({ ...RENDERED_ROW, convertCostPerTon: '0' }));

    expect(line?.convertCostPerTon).toBe('0');
  });

  it('refuses a cost that is not dollars, naming the box and what was typed', () => {
    expect(collectLines(formOf({ ...RENDERED_ROW, convertCostPerTon: 'abc' }))).toEqual({
      ok: false,
      message:
        'Line 1: Converting cost must be a number of dollars per US ton, such as 180. You entered "abc".',
    });
    expect(collectLines(formOf(RENDERED_ROW, { ...RENDERED_ROW, printCostPerTon: '-5' }))).toEqual({
      ok: false,
      message:
        'Line 2: Print cost must be a number of dollars per US ton, such as 260. You entered "-5".',
    });

    expect(collectLines(formOf({ ...RENDERED_ROW, printCostPerTon: '3.80417' }))).toMatchObject({
      ok: false,
    });
  });

  it("passes a closed line's stored costs through untouched", () => {
    const [line] = collectOrThrow(
      formOf({ ...RENDERED_ROW, convertCostPerTon: '47.2500', printCostPerTon: '120.0000' }),
    );

    expect(line).toMatchObject({ convertCostPerTon: '47.2500', printCostPerTon: '120.0000' });
  });

  it("carries the customer's part number and description the form collected", () => {
    const lines = collectOrThrow(
      formOf({
        ...RENDERED_ROW,
        customerPartNumber: ' LN-1300-C ',
        customerDescription: 'CEDAR CORE SHEET',
      }),
    );
    expect(lines[0]?.customerPartNumber).toBe('LN-1300-C');
    expect(lines[0]?.customerDescription).toBe('CEDAR CORE SHEET');
    expect(setQuoteLinesRequestSchema.safeParse({ lines, lockVersion: LOCK_VERSION }).success).toBe(
      true,
    );

    const blank = collectOrThrow(formOf(RENDERED_ROW));
    expect(blank[0]).not.toHaveProperty('customerPartNumber');
    expect(blank[0]).not.toHaveProperty('customerDescription');
  });

  it('refuses a part number over 40 characters, naming the box', () => {
    const result = collectLines(formOf({ ...RENDERED_ROW, customerPartNumber: 'X'.repeat(41) }));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('customerPartNumber');
  });

  it('counts a typed customer description alone as a row somebody meant to add', () => {
    const result = collectLines(
      formOf({
        ...RENDERED_ROW,
        paper: '',
        quantityRolls: '',
        rollWidthIn: '',
        customerDescription: 'CEDAR CORE SHEET',
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('leaves blank pounds ordered absent, for the engine to refuse by name', () => {
    const blank = collectOrThrow(formOf({ ...RENDERED_ROW, pricingBasis: 'per_pound' }));
    expect(blank[0]).not.toHaveProperty('orderedWeightLb');
  });

  it('counts pounds ordered alone as a row somebody meant to add', () => {
    const result = collectLines(
      formOf({
        ...RENDERED_ROW,
        paper: '',
        quantityRolls: '',
        rollWidthIn: '',
        orderedWeightLb: '1000',
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('falls to the schema default when the Priced select is absent', () => {
    const withoutBasis = { ...RENDERED_ROW };
    delete withoutBasis['pricingBasis'];

    expect(collectOrThrow(formOf(withoutBasis))[0]?.pricingBasis).toBe('per_roll');
  });

  it('accepts a non-taxable line with no jurisdiction', () => {
    const lines = collectOrThrow(
      formOf({ ...RENDERED_ROW, taxStatus: 'non_tax', taxJurisdiction: '' }),
    );

    expect(lines[0]?.taxTreatment).toEqual({ taxStatus: 'non_tax' });
    expect(setQuoteLinesRequestSchema.safeParse({ lines, lockVersion: LOCK_VERSION }).success).toBe(
      true,
    );
  });

  it('falls to the schema default when the category select is absent', () => {
    const withoutCategory = { ...RENDERED_ROW };
    delete withoutCategory.revenueCategory;

    const lines = collectOrThrow(formOf(withoutCategory));

    expect(lines[0]?.revenueCategory).toBe('print');
  });
});

describe('collectLines — the Paper picker value', () => {
  it('splits one picked option into the two fields the API takes', () => {
    const lines = collectOrThrow(formOf(RENDERED_ROW));

    expect(lines[0]?.gradeId).toBe(GRADE_ID);
    expect(lines[0]?.footageVariant).toBe('long');
  });

  it('keeps a variant that contains the separator', () => {
    const lines = collectOrThrow(formOf({ ...RENDERED_ROW, paper: `${GRADE_ID}:500:short` }));

    expect(lines[0]?.gradeId).toBe(GRADE_ID);
    expect(lines[0]?.footageVariant).toBe('500:short');
  });

  it('posts a typed custom length, and omits the key when the box is blank', () => {
    const typed = collectOrThrow(formOf({ ...RENDERED_ROW, feetPerRollOverride: '1250.0000' }));
    expect(typed[0]?.feetPerRollOverride).toBe('1250.0000');

    const cleared = collectOrThrow(formOf({ ...RENDERED_ROW, feetPerRollOverride: '' }));
    expect(cleared[0]).not.toHaveProperty('feetPerRollOverride');
    expect(
      setQuoteLinesRequestSchema.safeParse({ lines: cleared, lockVersion: LOCK_VERSION }).success,
    ).toBe(true);
  });

  it('refuses a zero or negative custom length at the endpoint schema', () => {
    for (const value of ['0', '0.0000', '-5']) {
      const result = collectLines(formOf({ ...RENDERED_ROW, feetPerRollOverride: value }));

      expect(result.ok, `expected ${value} to be refused`).toBe(false);
      expect(result.ok ? '' : result.message).toContain('custom length');
    }
  });

  it('refuses a value carrying no variant, naming the field', () => {
    const result = collectLines(formOf({ ...RENDERED_ROW, paper: GRADE_ID }));

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('footageVariant');
  });
});

describe('collectLines — the printed flag', () => {
  it('reads an unticked box as not printed, and the endpoint accepts it', () => {
    const lines = collectOrThrow(formOf(RENDERED_ROW));

    expect(lines[0]?.printed).toBe(false);
    expect(setQuoteLinesRequestSchema.safeParse({ lines, lockVersion: LOCK_VERSION }).success).toBe(
      true,
    );
  });

  it('reads a ticked box as printed', () => {
    const lines = collectOrThrow(formOf({ ...RENDERED_ROW, printed: 'on' }));

    expect(lines[0]?.printed).toBe(true);
  });

  it('never infers printed from a print cost', () => {
    const lines = collectOrThrow(formOf({ ...RENDERED_ROW, printCostPerTon: '120.0000' }));

    expect(lines[0]?.printed).toBe(false);
  });

  it('treats a ticked box on the append row as data worth keeping', () => {
    const appendRow = {
      paper: '',
      quantityRolls: '',
      freightMode: 'pickup',
      revenueCategory: 'print',
      taxStatus: 'id_tax',
      taxJurisdiction: 'ID',
      printed: 'on',
    };

    const result = collectLines(formOf(RENDERED_ROW, appendRow));

    expect(result).toEqual({
      ok: false,
      message: 'Line 2 has data but no paper — pick a paper or clear the row.',
    });
  });
});

describe('collectLines — the tax pairing', () => {
  it('asks for a treatment when the customer record seeded none', () => {
    const result = collectLines(formOf({ ...RENDERED_ROW, taxStatus: '', taxJurisdiction: '' }));

    expect(result).toEqual({
      ok: false,
      message: 'Line 1: choose a tax treatment — the customer record did not settle one.',
    });
  });

  it('reports the row number, not just the fault', () => {
    const result = collectLines(
      formOf(RENDERED_ROW, { ...RENDERED_ROW, taxStatus: '', taxJurisdiction: '' }),
    );

    expect(result).toEqual({
      ok: false,
      message: 'Line 2: choose a tax treatment — the customer record did not settle one.',
    });
  });
});

describe('collectLines — the jurisdiction follows the treatment', () => {
  const treatmentOf = (taxStatus: string, taxJurisdiction: string) =>
    collectOrThrow(formOf({ ...RENDERED_ROW, taxStatus, taxJurisdiction }))[0]?.taxTreatment;

  it.each([
    ['non_tax', 'ID', { taxStatus: 'non_tax' }],
    ['id_tax', '', { taxStatus: 'id_tax', taxJurisdiction: 'ID' }],
    ['id_tax', 'WA-9137', { taxStatus: 'id_tax', taxJurisdiction: 'ID' }],
    ['wa_tax', 'WA-9137', { taxStatus: 'wa_tax', taxJurisdiction: 'WA-9137' }],
    ['wa_tax', ' WA-9010 ', { taxStatus: 'wa_tax', taxJurisdiction: 'WA-9010' }],
  ])('saves %s with "%s" as %j', (taxStatus, taxJurisdiction, saved) => {
    expect(treatmentOf(taxStatus, taxJurisdiction)).toEqual(saved);
  });

  it.each([
    ['id_tax', 'WA 9137', { taxStatus: 'id_tax', taxJurisdiction: 'ID' }],
    ['id_tax', 'ID-1', { taxStatus: 'id_tax', taxJurisdiction: 'ID' }],
    ['id_tax', 'HARBOR', { taxStatus: 'id_tax', taxJurisdiction: 'ID' }],
    ['non_tax', 'WA 9137', { taxStatus: 'non_tax' }],
  ])('ignores the box %s hides: "%s" saves as %j', (taxStatus, taxJurisdiction, saved) => {
    expect(treatmentOf(taxStatus, taxJurisdiction)).toEqual(saved);
  });

  it.each([[''], ['ID']])(
    'refuses Washington taxable with "%s" in the box, giving the format',
    (typed) => {
      expect(
        collectLines(formOf({ ...RENDERED_ROW, taxStatus: 'wa_tax', taxJurisdiction: typed })),
      ).toEqual({
        ok: false,
        message:
          'Line 1: a Washington taxable line needs WA- and the four-digit DOR location code, ' +
          'such as WA-0202 for Clarkston.',
      });
    },
  );

  it.each([['WA'], ['WA-HARBOR'], ['WA-731']])(
    'refuses a Washington code that is not a key, "%s", in these words',
    (typed) => {
      expect(
        collectLines(formOf({ ...RENDERED_ROW, taxStatus: 'wa_tax', taxJurisdiction: typed })),
      ).toEqual({
        ok: false,
        message:
          `Line 1: tax jurisdiction "${typed}" is not one a tax rate can match. ` +
          'Use ID, or WA- and the four-digit DOR location code, such as WA-0202 for Clarkston.',
      });
    },
  );

  it('refuses a code naming neither state, rather than flattening it', () => {
    const result = collectLines(
      formOf({ ...RENDERED_ROW, taxStatus: 'wa_tax', taxJurisdiction: 'WA HARBOR' }),
    );

    expect(result).toEqual({
      ok: false,
      message:
        'Line 1: tax jurisdiction "WA HARBOR" names neither Idaho nor Washington. ' +
        'Use ID, or WA- and the four-digit DOR location code, such as WA-0202 for Clarkston.',
    });
  });

  it('still refuses a treatment whose state is not where the line ships', () => {
    const form = formOf({ ...RENDERED_ROW, taxStatus: 'id_tax', taxJurisdiction: '' });
    form.set('billingState', 'WA');

    const result = collectLines(form);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.message).toContain('"ID" does not belong to WA');
  });
});

describe('collectLines — the delivery address', () => {
  it('carries a whole address the save endpoint accepts', () => {
    const lines = collectOrThrow(formOf({ ...RENDERED_ROW, ...HARBOR_ROW }));

    expect(lines[0]?.deliveryAddress).toEqual({
      name: 'Receiving',
      line1: '500 Sample Road',
      line2: 'Dock 3',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000-3381',
    });
    expect(setQuoteLinesRequestSchema.safeParse({ lines, lockVersion: LOCK_VERSION }).success).toBe(
      true,
    );
  });

  it('omits the key entirely when all six boxes are blank', () => {
    const lines = collectOrThrow(formOf(RENDERED_ROW));

    expect(lines[0]).not.toHaveProperty('deliveryAddress');
  });

  it('keeps a minimal address without its optional parts', () => {
    const lines = collectOrThrow(
      formOf({
        ...RENDERED_ROW,
        'delivery.line1': '700 Demo Way',
        'delivery.city': 'Example City',
        'delivery.state': 'ID',
        'delivery.postalCode': '83010',
      }),
    );

    expect(lines[0]?.deliveryAddress).toEqual({
      line1: '700 Demo Way',
      city: 'Example City',
      state: 'ID',
      postalCode: '83010',
    });
  });

  it('refuses a half-filled address and names what is still blank', () => {
    const result = collectLines(
      formOf({ ...RENDERED_ROW, ...HARBOR_ROW, 'delivery.city': '', 'delivery.postalCode': '' }),
    );

    expect(result).toEqual({
      ok: false,
      message:
        'Line 1: a delivery address needs a street, city, state and ZIP. Still blank: city, ZIP. ' +
        'Fill those in, or clear the whole address to quote this line for collection.',
    });
  });

  it('refuses a ship-to name standing on its own', () => {
    const result = collectLines(formOf({ ...RENDERED_ROW, 'delivery.name': 'Receiving' }));

    expect(result).toEqual({
      ok: false,
      message:
        'Line 1: a delivery address needs a street, city, state and ZIP. ' +
        'Still blank: street, city, state, ZIP. ' +
        'Fill those in, or clear the whole address to quote this line for collection.',
    });
  });

  it('leaves a malformed state to the schema, with the row number attached', () => {
    const result = collectLines(
      formOf({ ...RENDERED_ROW, ...HARBOR_ROW, 'delivery.state': 'Wash' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toBe(
      'Line 1: deliveryAddress.state: state must be a two-letter code, e.g. WA',
    );
  });

  it('reports the row number, not just the fault', () => {
    const result = collectLines(
      formOf(RENDERED_ROW, { ...RENDERED_ROW, 'delivery.line1': '500 Sample Road' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('Line 2:');
  });
});

describe('collectLines — stock and custom widths', () => {
  const STEP_ONE_ROW = { paper: `${GRADE_ID}:long` };

  it('passes by the append row while it holds only the paper picked for Choose widths', () => {
    const lines = collectOrThrow(formOf(RENDERED_ROW, STEP_ONE_ROW));
    expect(lines).toHaveLength(1);
  });

  it('passes by the step-two row until a width or a quantity is given', () => {
    const stepTwo = {
      ...RENDERED_ROW,
      rollWidthIn: '',
      quantityRolls: '',
      revenueCategory: 'print',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
    };
    expect(collectOrThrow(formOf(RENDERED_ROW, stepTwo))).toHaveLength(1);
  });

  it('posts the typed width and the custom flag when the box is ticked, ignoring the select', () => {
    const lines = collectOrThrow(
      formOf({ ...RENDERED_ROW, rollWidthIn: '18', customWidth: 'on', customWidthIn: '17' }),
    );
    expect(lines[0]?.rollWidthIn).toBe(17);
    expect(lines[0]?.customWidth).toBe(true);
    expect(setQuoteLinesRequestSchema.safeParse({ lines, lockVersion: LOCK_VERSION }).success).toBe(
      true,
    );
  });

  it('ignores a typed width while the box is unticked', () => {
    const lines = collectOrThrow(formOf({ ...RENDERED_ROW, customWidthIn: '17' }));
    expect(lines[0]?.rollWidthIn).toBe(18);
    expect(Object.hasOwn(lines[0] ?? {}, 'customWidth')).toBe(false);
  });

  it('asks for the width when the box is ticked and empty, naming the line', () => {
    expect(collectLines(formOf({ ...RENDERED_ROW, customWidth: 'on', customWidthIn: '' }))).toEqual(
      {
        ok: false,
        message: 'Line 1: Custom width is chosen - type the width in whole inches.',
      },
    );
  });

  it('reads "Custom width" chosen in the width select as the custom flag', () => {
    const lines = collectOrThrow(
      formOf({ ...RENDERED_ROW, rollWidthIn: 'custom', customWidthIn: '17' }),
    );
    expect(lines[0]?.rollWidthIn).toBe(17);
    expect(lines[0]?.customWidth).toBe(true);
  });

  it('refuses "Custom width" chosen with the box left empty, keeping the old sentence shape', () => {
    expect(
      collectLines(formOf({ ...RENDERED_ROW, rollWidthIn: 'custom', customWidthIn: '' })),
    ).toEqual({
      ok: false,
      message: 'Line 1: Custom width is chosen - type the width in whole inches.',
    });
  });

  it('refuses a custom width that is not whole inches from 1 to 1000', () => {
    for (const typed of ['23.5', '11.3125', '0', '1001', 'wide']) {
      expect(
        collectLines(formOf({ ...RENDERED_ROW, customWidth: 'on', customWidthIn: typed })),
      ).toEqual({
        ok: false,
        message: 'Line 1: a custom width is a whole number of inches from 1 to 1000.',
      });
    }
  });

  it('posts a stock width in sixteenths from the select as its number', () => {
    const lines = collectOrThrow(formOf({ ...RENDERED_ROW, rollWidthIn: '11.3125' }));
    expect(lines[0]?.rollWidthIn).toBe(11.3125);
    expect(Object.hasOwn(lines[0] ?? {}, 'customWidth')).toBe(false);
  });

  it('refuses a stock width that is not a sixteenth with the API sentence', () => {
    expect(collectLines(formOf({ ...RENDERED_ROW, rollWidthIn: '29.3' }))).toEqual({
      ok: false,
      message:
        'Line 1: rollWidthIn: a width is whole inches or sixteenths of an inch, from 1 to 1000 (11 5/16 is 11.3125)',
    });
  });

  it('drops a typed custom length while the paper’s own length is chosen', () => {
    const lines = collectOrThrow(
      formOf({ ...RENDERED_ROW, lengthChoice: 'own', feetPerRollOverride: '900' }),
    );
    expect(Object.hasOwn(lines[0] ?? {}, 'feetPerRollOverride')).toBe(false);
  });

  it('posts the custom length while Custom length is chosen, and from a closed row', () => {
    const chosen = collectOrThrow(
      formOf({ ...RENDERED_ROW, lengthChoice: 'custom', feetPerRollOverride: '900' }),
    );
    expect(chosen[0]?.feetPerRollOverride).toBe('900');
    const closed = collectOrThrow(formOf({ ...RENDERED_ROW, feetPerRollOverride: '900' }));
    expect(closed[0]?.feetPerRollOverride).toBe('900');
  });

  it('never reads the open-form marker as data', () => {
    expect(collectOrThrow(formOf(RENDERED_ROW, { paper: '', open: '1' }))).toHaveLength(1);
  });

  it('counts a ticked box on the append row as a line somebody meant to add', () => {
    const appendRow = { paper: '', customWidth: 'on', customWidthIn: '17' };
    expect(collectLines(formOf(RENDERED_ROW, appendRow))).toMatchObject({ ok: false });
  });
});

describe('collectLines — the append row', () => {
  it('drops a wholly untouched append row despite its seeded classification', () => {
    const appendRow = {
      paper: '',
      rollWidthIn: '',
      quantityRolls: '',
      tierOverrideCode: '',
      overridePricePerRoll: '',
      freightMode: 'pickup',
      rateOverride: '',
      carrierBid: '',
      freightMarginPct: '',
      revenueCategory: 'print',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',

      'delivery.name': '',
      'delivery.line1': '',
      'delivery.line2': '',
      'delivery.city': '',
      'delivery.state': '',
      'delivery.postalCode': '',
    };

    const lines = collectOrThrow(formOf(RENDERED_ROW, appendRow));

    expect(lines).toHaveLength(1);
  });

  it('drops an append row whose Priced select is still on Per roll', () => {
    const appendRow = {
      paper: '',
      quantityRolls: '',
      pricingBasis: 'per_roll',
      freightMode: 'pickup',
      revenueCategory: 'print',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
    };

    expect(collectOrThrow(formOf(RENDERED_ROW, appendRow))).toHaveLength(1);
  });

  it('refuses an append row where the only thing typed is a price per pound', () => {
    const priceOnly = {
      paper: '',
      quantityRolls: '',
      overridePricePerLb: '0.8350',
      pricingBasis: 'per_pound',
      freightMode: 'pickup',
      revenueCategory: 'print',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
    };

    expect(collectLines(formOf(RENDERED_ROW, priceOnly))).toEqual({
      ok: false,
      message: 'Line 2 has data but no paper — pick a paper or clear the row.',
    });
  });

  it('refuses an append row where the only thing chosen is Per pound', () => {
    const basisOnly = {
      paper: '',
      quantityRolls: '',
      pricingBasis: 'per_pound',
      freightMode: 'pickup',
      revenueCategory: 'print',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
    };

    expect(collectLines(formOf(RENDERED_ROW, basisOnly))).toEqual({
      ok: false,
      message: 'Line 2 has data but no paper — pick a paper or clear the row.',
    });
  });

  it('refuses an append row where the only thing typed is an address', () => {
    const addressOnly = {
      paper: '',
      quantityRolls: '',
      freightMode: 'pickup',
      revenueCategory: 'print',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
      'delivery.city': 'Sample Harbor',
    };

    const result = collectLines(formOf(RENDERED_ROW, addressOnly));

    expect(result).toEqual({
      ok: false,
      message: 'Line 2 has data but no paper — pick a paper or clear the row.',
    });
  });

  it('still refuses a row someone half-filled', () => {
    const halfFilled = {
      paper: '',
      quantityRolls: '',
      rollWidthIn: '24',
      freightMode: 'pickup',
      revenueCategory: 'print',
      taxStatus: 'id_tax',
      taxJurisdiction: 'ID',
    };

    const result = collectLines(formOf(RENDERED_ROW, halfFilled));

    expect(result).toEqual({
      ok: false,
      message: 'Line 2 has data but no paper — pick a paper or clear the row.',
    });
  });
});

describe('collectLines - the jurisdiction and the ship-to', () => {
  const rowShippingTo = (state: string, taxJurisdiction: string): Record<string, string> => ({
    ...RENDERED_ROW,
    taxStatus: taxJurisdiction === '' ? 'non_tax' : 'wa_tax',
    taxJurisdiction,
    'delivery.line1': '1 Somewhere',
    'delivery.city': 'A Town',
    'delivery.state': state,
    'delivery.postalCode': '98000',
  });

  it('accepts a jurisdiction matching the line address', () => {
    expect(collectOrThrow(formOf(rowShippingTo('WA', 'WA-9137')))).toHaveLength(1);
  });

  it('refuses a Washington jurisdiction on an Oregon delivery, naming both', () => {
    const result = collectLines(formOf(rowShippingTo('OR', 'WA-9137')));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.message).toContain('Line 1');
    expect(result.message).toContain('WA-9137');
    expect(result.message).toContain('OR');
  });

  it('accepts a non-taxable line to any destination', () => {
    expect(collectOrThrow(formOf(rowShippingTo('OR', '')))).toHaveLength(1);
  });

  it('falls back to the billing state when the line names no address', () => {
    const form = formOf({ ...RENDERED_ROW, taxStatus: 'wa_tax', taxJurisdiction: 'WA-9137' });
    form.set('billingState', 'ID');

    const result = collectLines(form);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.message).toContain('ID');
  });

  it('checks nothing when neither a line address nor a billing state is known', () => {
    expect(collectOrThrow(formOf(RENDERED_ROW))).toHaveLength(1);
  });
});

describe('collectLines - the freight margin is a percent in the box', () => {
  const carrierRow = (freightMarginPct: string): Record<string, string> => ({
    ...RENDERED_ROW,
    freightMode: 'carrier',
    carrierBid: '400.00',
    freightMarginPct,
  });

  it.each([
    ['12', '0.120000'],
    ['16.325', '0.163250'],
    ['0', '0.000000'],
  ])('converts %s%% to %s', (typed, ratio) => {
    const [line] = collectOrThrow(formOf(carrierRow(typed)));

    expect(line?.freight).toEqual({
      mode: 'carrier',
      carrierBid: '400.00',
      freightMarginPct: ratio,
    });
  });

  it('reads 0.12 as twelve hundredths of a percent, which is what the box now asks for', () => {
    const [line] = collectOrThrow(formOf(carrierRow('0.12')));

    expect(line?.freight).toMatchObject({ freightMarginPct: '0.001200' });
  });

  it('sends nothing at all when the box is blank', () => {
    const [line] = collectOrThrow(formOf(carrierRow('')));

    expect(line?.freight).toEqual({ mode: 'carrier', carrierBid: '400.00' });
  });

  it('names the row and the units when the percent is out of range', () => {
    const result = collectLines(formOf(RENDERED_ROW, carrierRow('230')));

    expect(result).toEqual({
      ok: false,
      message: 'Line 2: Freight margin must be under 100%. You entered 230%.',
    });
  });

  it('refuses text before it can reach the schema', () => {
    const result = collectLines(formOf(carrierRow('twelve')));

    expect(result).toEqual({
      ok: false,
      message:
        'Line 1: Freight margin must be a number of percent, such as 12. You entered "twelve".',
    });
  });
});

describe('collectLines - a freight box posted from the Lines step', () => {
  const TYPED: Readonly<Record<FreightBox, { typed: string; saved: string }>> = {
    rateOverride: { typed: '26.75', saved: '26.75' },
    carrierBid: { typed: '400.00', saved: '400.00' },

    freightMargin: { typed: '12', saved: '0.120000' },
  };

  it.each(SHIPPING_MODES.flatMap((mode) => FREIGHT_BOX_ORDER.map((box) => [mode, box] as const)))(
    'a %s line keeps a posted %s exactly when the mode reads it',
    (mode, box) => {
      const [line] = collectOrThrow(
        formOf({
          ...RENDERED_ROW,
          open: '1',
          freightMode: mode,
          [FREIGHT_FIELD[box]]: TYPED[box].typed,
        }),
      );

      expect(line?.freight).toEqual(
        freightBoxes(mode)[box] ? { mode, [FREIGHT_FIELD[box]]: TYPED[box].saved } : { mode },
      );
    },
  );
});

describe('collectLines - an open line priced with its fold untouched', () => {
  const STORED = {
    id: 'line-1',
    lineNumber: 1,
    gradeId: GRADE_ID,
    footageVariant: 'long',
    rollWidthIn: 18,
    quantityRolls: 40,
    pricingBasis: 'per_roll',
    overwrap: false,
    printed: true,
    revenueCategory: 'label',
    taxStatus: 'wa_tax',
    taxJurisdiction: 'WA-9137',
    deliveryAddress: {
      name: 'Receiving',
      line1: '500 Sample Road',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000',
    },
    freight: { mode: 'carrier', carrierBid: '400.0000', freightMarginPct: '0.120000' },
  } as unknown as QuoteLine;

  it('saves what its closed row saves, so the hidden address, tax and category still ride', () => {
    const closedRow = storedLineValues(STORED, undefined);

    const shown = Object.fromEntries(
      Object.entries(closedRow).filter(
        ([field]) => !(STEP_THREE_FIELDS as readonly string[]).includes(field),
      ),
    );
    const freight = freightDefaults(STORED, undefined);
    const fold = Object.fromEntries(
      FREIGHT_BOX_ORDER.map((box) => [FREIGHT_FIELD[box], freight[box]]),
    );
    const hidden = stepThreeHiddenValues(
      deliveryTaxValues(STORED, { taxStatus: '', taxJurisdiction: '' }, undefined, undefined),
      false,
    );
    for (const box of FREIGHT_BOX_ORDER) {
      expect(hidden).not.toHaveProperty(FREIGHT_FIELD[box]);
    }

    const [saved] = collectOrThrow(formOf({ ...shown, open: '1', ...fold, ...hidden }));

    expect(saved).toEqual(collectOrThrow(formOf(closedRow))[0]);
    expect(saved).toMatchObject({
      revenueCategory: 'label',
      taxTreatment: { taxStatus: 'wa_tax', taxJurisdiction: 'WA-9137' },
      deliveryAddress: {
        name: 'Receiving',
        line1: '500 Sample Road',
        city: 'Sample Harbor',
        state: 'WA',
        postalCode: '98000',
      },
      freight: { mode: 'carrier', carrierBid: '400.0000', freightMarginPct: '0.120000' },
    });
  });

  it('saves a stored Idaho line as ID, though neither of its forms posts the code', () => {
    const idaho = {
      ...STORED,
      taxStatus: 'id_tax',
      taxJurisdiction: 'ID',
      deliveryAddress: undefined,
      freight: { mode: 'pickup' },
    } as unknown as QuoteLine;
    const closedRow = storedLineValues(idaho, undefined);
    const hidden = stepThreeHiddenValues(
      deliveryTaxValues(idaho, { taxStatus: '', taxJurisdiction: '' }, undefined, undefined),
      false,
    );
    expect(closedRow).toHaveProperty('taxStatus', 'id_tax');
    expect(closedRow).not.toHaveProperty('taxJurisdiction');
    expect(hidden).toHaveProperty('taxStatus', 'id_tax');
    expect(hidden).not.toHaveProperty('taxJurisdiction');

    const [saved] = collectOrThrow(formOf(closedRow));
    expect(saved?.taxTreatment).toEqual({ taxStatus: 'id_tax', taxJurisdiction: 'ID' });
  });
});

describe('collectLines - a margin entered manually', () => {
  const entered = (typed: string): Record<string, string> => ({
    ...RENDERED_ROW,
    tierOverrideCode: MARGIN_ENTERED_CHOICE,
    marginOverridePct: typed,
  });

  function withFloor(form: FormData, floor = '0.120000'): FormData {
    form.set(MARGIN_FLOOR_FIELD, floor);
    return form;
  }

  it('sends the margin as a ratio and no tier, and the endpoint takes it', () => {
    const lines = collectOrThrow(withFloor(formOf(entered('42.0'))));

    expect(lines[0]?.marginOverridePct).toBe('0.420000');
    expect(lines[0]).not.toHaveProperty('tierOverrideCode');
    expect(setQuoteLinesRequestSchema.safeParse({ lines, lockVersion: LOCK_VERSION }).success).toBe(
      true,
    );
  });

  it('ignores the box while a tier or Auto is chosen, so a stale margin prices nothing', () => {
    const tiered = collectOrThrow(
      withFloor(formOf({ ...RENDERED_ROW, tierOverrideCode: 'volume_5', marginOverridePct: '42' })),
    );
    expect(tiered[0]).toMatchObject({ tierOverrideCode: 'volume_5' });
    expect(tiered[0]).not.toHaveProperty('marginOverridePct');

    const auto = collectOrThrow(withFloor(formOf({ ...RENDERED_ROW, marginOverridePct: '42' })));
    expect(auto[0]).not.toHaveProperty('marginOverridePct');
    expect(auto[0]).not.toHaveProperty('tierOverrideCode');
  });

  it('refuses the choice with a blank box', () => {
    expect(collectLines(withFloor(formOf(entered(''))))).toEqual({
      ok: false,
      message:
        'Line 1: Enter margin manually is chosen and the Margin box is blank. Type the margin, or choose a tier.',
    });
  });

  it('refuses a margin that is not a percent to one decimal place, naming what was typed', () => {
    expect(collectLines(withFloor(formOf(entered('42.25'))))).toEqual({
      ok: false,
      message:
        'Line 1: Margin must be a percent to one decimal place, such as 42.0. You entered "42.25".',
    });
    expect(collectLines(withFloor(formOf(RENDERED_ROW, entered('abc'))))).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^Line 2: Margin must be a percent/),
    });
  });

  it('refuses a margin over 95%', () => {
    expect(collectLines(withFloor(formOf(entered('95.0'))))).toMatchObject({ ok: true });
    expect(collectLines(withFloor(formOf(entered('96'))))).toEqual({
      ok: false,
      message: 'Line 1: a margin entered manually can be at most 95%. You entered 96%.',
    });
  });

  it('refuses a margin under the floor the page was drawn with, naming the floor', () => {
    expect(collectLines(withFloor(formOf(entered('10.0'))))).toEqual({
      ok: false,
      message:
        'Line 1: the margin floor is 12%, so a margin entered manually must be 12% or more. You entered 10.0%.',
    });

    expect(collectLines(withFloor(formOf(entered('12.0'))))).toMatchObject({ ok: true });

    expect(collectLines(withFloor(formOf(entered('18.0')), '0.215000'))).toMatchObject({
      ok: false,
      message: expect.stringContaining('the margin floor is 21.5%'),
    });
  });

  it('leaves the floor to the module when the page posts none', () => {
    expect(collectLines(formOf(entered('10.0')))).toMatchObject({ ok: true });
  });

  it("passes a closed line's stored margin through, exactly", () => {
    const stored = {
      id: 'line-1',
      lineNumber: 1,
      gradeId: GRADE_ID,
      footageVariant: 'long',
      rollWidthIn: 18,
      quantityRolls: 40,
      pricingBasis: 'per_roll',
      overwrap: false,
      printed: false,
      revenueCategory: 'print',
      taxStatus: 'id_tax',
      taxJurisdiction: 'ID',
      freight: { mode: 'pickup' },
      priceSource: 'margin',
      marginOverridePct: '0.425000',
    } as unknown as QuoteLine;
    const [saved] = collectOrThrow(withFloor(formOf(storedLineValues(stored, undefined))));

    expect(saved?.marginOverridePct).toBe('0.425000');
    expect(saved).not.toHaveProperty('tierOverrideCode');
  });
});
