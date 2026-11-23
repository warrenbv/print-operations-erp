// Tests the starting values of the line form, the paper picker, the folds and the reveal CSS.
import { describe, expect, it } from 'vitest';

import type { Grade, QuoteLine } from '@erp/types';

import {
  COST_PER_TON_PATTERN,
  LINE_FREIGHT_REVEAL_CSS,
  LINE_TAX_JURISDICTION_REVEAL_CSS,
  MARGIN_ENTERED_CHOICE,
  MARGIN_ENTERED_LABEL,
  MARGIN_ENTERED_REVEAL_CSS,
  MARGIN_PERCENT_PATTERN,
  PRINTED_NO_PRINT_COST_CSS,
  PRINTED_NO_PRINT_COST_HINT,
  SAME_AS_LINE_ONE_NOTE,
  SHIP_TO_CHOICES,
  SHIP_TO_LABELS,
  blankRowStart,
  catalogVariants,
  coreDefaults,
  deliveryDefaults,
  deliveryTaxValues,
  deliveryWords,
  firstAddressedLine,
  firstLine,
  freightBoxes,
  freightDefaults,
  gradeLabel,
  taxAndRevenueDefaults,
  lineOneSavedAddress,
  moreOptionsOpen,
  moreOptionsSum,
  lineAsksTax,
  marginEnteredHint,
  newLineSeeds,
  openForms,
  paperGroups,
  type MoreOptionsValues,
  paperValue,
  rowEcho,
  shipToStart,
  splitPaperValue,
  stepThreeHiddenValues,
  storedListed,
  storedLineValues,
  summaryPricedAt,
  taxJurisdictionRevealCss,
  typedPriceWords,
} from './line-defaults';

const line = (over: Record<string, unknown> = {}) =>
  ({ footageVariant: 'long', rollWidthIn: 12, ...over }) as unknown as QuoteLine;

const core = (over: Record<string, string> = {}) => ({
  footageVariant: 'long',
  rollWidthIn: '12',
  ...over,
});

const grade = (over: Record<string, unknown> = {}) =>
  ({
    id: 'grade-kraft-40',
    code: '40#',
    productFamily: 'kraft',
    footages: [
      { variant: 'short', label: 'Short roll', feetPerRoll: '1095.0000' },
      { variant: 'long', label: 'Long roll', feetPerRoll: '1250.0000' },
    ],
    ...over,
  }) as unknown as Grade;

const CATALOG: readonly Grade[] = [
  grade(),
  grade({ id: 'grade-kraft-50', code: '50#' }),
  grade({
    id: 'grade-db-20',
    code: '20# Digital Bond',
    productFamily: 'digital_bond',
    footages: [
      { variant: '410', label: "410' length", feetPerRoll: '410.0000' },
      { variant: '500', label: "500' length", feetPerRoll: '500.0000' },
    ],
  }),
];

describe('the papers one picker offers', () => {
  it('groups the pairs by the grade that carries them', () => {
    expect(paperGroups(CATALOG).map((g) => [g.label, g.options.map((o) => o.value)])).toEqual([
      ['Kraft — 40#', ['grade-kraft-40:short', 'grade-kraft-40:long']],
      ['Kraft — 50#', ['grade-kraft-50:short', 'grade-kraft-50:long']],
      ['Digital Bond — 20# Digital Bond', ['grade-db-20:410', 'grade-db-20:500']],
    ]);
  });

  it('names the paper, then the feet, then the variant label', () => {
    expect(paperGroups(CATALOG)[0]?.options.map((o) => o.label)).toEqual([
      'Kraft — 40# — 1,095 ft — Short roll',
      'Kraft — 40# — 1,250 ft — Long roll',
    ]);
  });

  it('starts every option with the heading of the group it sits in', () => {
    for (const group of paperGroups(CATALOG)) {
      for (const option of group.options) {
        expect(option.label.startsWith(`${group.label} — `)).toBe(true);
      }
    }
  });

  it('prints the feet grouped in thousands with no trailing zeros', () => {
    const feet = paperGroups(CATALOG).flatMap((g) =>
      g.options.map((o) => o.label.slice(`${g.label} — `.length).split(' ft')[0]),
    );
    expect(feet).toEqual(['1,095', '1,250', '1,095', '1,250', '410', '500']);
  });

  it('names a grade exactly as gradeLabel does', () => {
    expect(paperGroups(CATALOG)[0]?.label).toBe(gradeLabel(CATALOG[0] as Grade));
  });

  it('keeps a variant that several grades share, once per grade', () => {
    const short = paperGroups(CATALOG).filter((g) =>
      g.options.some((o) => o.value.endsWith(':short')),
    );
    expect(short).toHaveLength(2);
  });

  it('keeps a grade with no footages, as a group with nothing in it', () => {
    const withEmpty = [...CATALOG, grade({ id: 'grade-empty', code: '99#', footages: [] })];
    const empty = paperGroups(withEmpty).find((g) => g.gradeId === 'grade-empty');
    expect(empty?.label).toBe('Kraft — 99#');
    expect(empty?.options).toEqual([]);
  });

  it('follows the catalog order, so the picker reads like the grades page', () => {
    expect(paperGroups(CATALOG).map((g) => g.gradeId)).toEqual([
      'grade-kraft-40',
      'grade-kraft-50',
      'grade-db-20',
    ]);
  });

  it('offers every pair the catalog holds, and no more', () => {
    const options = paperGroups(CATALOG).flatMap((g) => g.options);
    expect(options).toHaveLength(CATALOG.reduce((n, g) => n + g.footages.length, 0));
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
  });
});

describe('the picker value that carries both halves', () => {
  it('joins the grade and the variant', () => {
    expect(paperValue('grade-kraft-40', 'long')).toBe('grade-kraft-40:long');
  });

  it('is empty for a row with no grade, so the blank option is the one selected', () => {
    expect(paperValue('', '')).toBe('');
  });

  it('splits on the first separator only', () => {
    expect(splitPaperValue('0a7c-3e51:500:short')).toEqual({
      gradeId: '0a7c-3e51',
      footageVariant: '500:short',
    });
  });

  it('round-trips a variant that contains the separator', () => {
    const value = paperValue('0a7c-3e51', '500:short');
    expect(splitPaperValue(value)).toEqual({ gradeId: '0a7c-3e51', footageVariant: '500:short' });
  });

  it('reads a value with no separator as a grade and no variant', () => {
    expect(splitPaperValue('0a7c-3e51')).toEqual({ gradeId: '0a7c-3e51', footageVariant: '' });
  });

  it('reads the blank row back as no grade and no variant', () => {
    expect(splitPaperValue('')).toEqual({ gradeId: '', footageVariant: '' });
  });
});

describe('the custom roll length', () => {
  const storedLine = (over: Record<string, unknown> = {}) =>
    line({ freight: { mode: 'pickup' }, ...over });

  it('shows a stored line the length it was saved with', () => {
    expect(coreDefaults(storedLine({ feetPerRollOverride: '1250.0000' }), undefined)).toMatchObject(
      {
        feetPerRollOverride: '1250.0000',
      },
    );
  });

  it('is empty on a line that has none, which means the catalog footage', () => {
    expect(coreDefaults(storedLine(), undefined).feetPerRollOverride).toBe('');
    expect(coreDefaults(undefined, undefined).feetPerRollOverride).toBe('');
  });

  it('comes back cleared when a refused save cleared it', () => {
    expect(
      coreDefaults(storedLine({ feetPerRollOverride: '1840.0000' }), { paper: 'kraft-40:long' })
        .feetPerRollOverride,
    ).toBe('');
  });
});

describe('the Pricing Basis', () => {
  const storedLine = (over: Record<string, unknown> = {}) =>
    line({ freight: { mode: 'pickup' }, ...over });

  it('shows a stored line the basis it was saved with', () => {
    expect(coreDefaults(storedLine({ pricingBasis: 'per_pound' }), undefined).pricingBasis).toBe(
      'per_pound',
    );
    expect(coreDefaults(storedLine({ pricingBasis: 'per_roll' }), undefined).pricingBasis).toBe(
      'per_roll',
    );
  });

  it('starts a blank row on per_roll', () => {
    expect(coreDefaults(undefined, undefined).pricingBasis).toBe('per_roll');
  });

  it('comes back as it was posted when a save was refused', () => {
    expect(
      coreDefaults(storedLine({ pricingBasis: 'per_roll' }), {
        paper: 'kraft-40:long',
        pricingBasis: 'per_pound',
      }).pricingBasis,
    ).toBe('per_pound');
  });

  it('keeps a stored line on what it was saved with, whatever the customer seeds', () => {
    const stored = coreDefaults(storedLine({ pricingBasis: 'per_roll' }), undefined, {
      pricingBasis: 'per_pound',
      freightMode: 'carrier',
    });
    expect(stored.pricingBasis).toBe('per_roll');
    expect(stored.freightMode).toBe('pickup');
  });

  it('falls back to per_roll when the echo carries no basis', () => {
    expect(coreDefaults(undefined, { paper: 'kraft-40:long' }).pricingBasis).toBe('per_roll');
  });
});

describe('catalogVariants — what "is this stored variant still real?" asks', () => {
  it('dedupes a variant several grades share', () => {
    expect(catalogVariants(CATALOG).map((o) => o.value)).toEqual(['short', 'long', '410', '500']);
  });

  it('keeps the first label seen for a shared code', () => {
    expect(catalogVariants(CATALOG)[0]).toEqual({ value: 'short', label: 'Short roll' });
  });
});

describe('protecting what was stored', () => {
  const variants = [{ value: 'long' }];
  const fits = [{ rollWidthIn: 12 }] as never[];

  it('treats a blank row as fully listed, having nothing to protect', () => {
    expect(storedListed(undefined, core(), undefined, variants, fits)).toEqual({
      grade: true,
      variant: true,
      width: true,
    });
  });

  it('reports a stored value the catalog no longer offers', () => {
    const stored = storedListed(
      line({ footageVariant: 'retired' }),
      core({ footageVariant: 'retired' }),
      undefined,
      variants,
      fits,
    );
    expect(stored.grade).toBe(false);
    expect(stored.variant).toBe(false);
  });

  it('reports a stored width the pallet fits no longer list', () => {
    expect(
      storedListed(
        line({ rollWidthIn: 99 }),
        core({ rollWidthIn: '99' }),
        {} as never,
        variants,
        fits,
      ).width,
    ).toBe(false);
  });
});

describe('the freight inputs', () => {
  it('is all empty strings for a blank row', () => {
    expect(freightDefaults(undefined, undefined)).toEqual({
      rateOverride: '',
      carrierBid: '',
      freightMargin: '',
    });
  });

  it('yields an empty string, never undefined, for a bidless carrier line', () => {
    const defaults = freightDefaults(line({ freight: { mode: 'carrier' } }), undefined);
    expect(defaults.carrierBid).toBe('');
    expect(defaults.carrierBid).not.toBeUndefined();
    expect(defaults.freightMargin).toBe('');
  });

  it('carries a stored rate override on the modes that have one', () => {
    for (const mode of ['our_vehicle', 'pass_through']) {
      expect(
        freightDefaults(line({ freight: { mode, rateOverride: '9.7500' } }), undefined)
          .rateOverride,
      ).toBe('9.7500');
    }
  });

  it('offers no rate override on a pickup or carrier line', () => {
    expect(freightDefaults(line({ freight: { mode: 'pickup' } }), undefined).rateOverride).toBe('');
    expect(freightDefaults(line({ freight: { mode: 'carrier' } }), undefined).rateOverride).toBe(
      '',
    );
  });

  it('carries a stored carrier bid, and the margin as the percent the box asks for', () => {
    const defaults = freightDefaults(
      line({ freight: { mode: 'carrier', carrierBid: '800.0000', freightMarginPct: '0.120000' } }),
      undefined,
    );
    expect(defaults.carrierBid).toBe('800.0000');
    expect(defaults.freightMargin).toBe('12');
  });

  it('does not round a stored margin on the way into the box', () => {
    const defaults = freightDefaults(
      line({ freight: { mode: 'carrier', freightMarginPct: '0.163250' } }),
      undefined,
    );
    expect(defaults.freightMargin).toBe('16.325');
  });
});

describe('the delivery address inputs', () => {
  const SHIP_TO = {
    name: 'Receiving',
    line1: '500 Sample Road',
    line2: 'Dock 3',
    city: 'Sample Harbor',
    state: 'WA',
    postalCode: '98000-7290',
  };

  it('is six empty strings for a blank row on an account with no shipping address', () => {
    expect(deliveryDefaults(undefined, undefined, undefined)).toEqual({
      name: '',
      line1: '',
      line2: '',
      city: '',
      state: '',
      postalCode: '',
    });
  });

  it('seeds a blank row from the customer shipping address, by copy', () => {
    expect(deliveryDefaults(undefined, SHIP_TO, undefined)).toEqual(SHIP_TO);
  });

  it('never seeds from the billing address, which is a different field', () => {
    expect(deliveryDefaults(undefined, undefined, undefined).line1).toBe('');
  });

  it('shows a stored line exactly what it was saved with', () => {
    const stored = deliveryDefaults(
      line({
        deliveryAddress: {
          name: 'Receiving',
          line1: '500 Sample Road',
          line2: 'Dock 3',
          city: 'Sample Harbor',
          state: 'WA',
          postalCode: '98000-7290',
        },
      }),
      undefined,
      undefined,
    );
    expect(stored).toEqual({
      name: 'Receiving',
      line1: '500 Sample Road',
      line2: 'Dock 3',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000-7290',
    });
  });

  it('leaves a stored line alone when the customer shipping address has moved on', () => {
    const stored = deliveryDefaults(
      line({
        deliveryAddress: {
          line1: '700 Demo Way',
          city: 'Example City',
          state: 'ID',
          postalCode: '83010',
        },
      }),
      SHIP_TO,
      undefined,
    );
    expect(stored.line1).toBe('700 Demo Way');
    expect(stored.city).toBe('Example City');
    expect(stored.state).toBe('ID');
  });

  it('renders the optional parts as empty strings, never undefined', () => {
    const stored = deliveryDefaults(
      line({
        deliveryAddress: {
          line1: '700 Demo Way',
          city: 'Example City',
          state: 'ID',
          postalCode: '83010',
        },
      }),
      undefined,
      undefined,
    );
    expect(stored.name).toBe('');
    expect(stored.line2).toBe('');
    expect(stored.name).not.toBeUndefined();
  });

  it('renders a seeded row with empty strings for the parts the seed omits', () => {
    const seeded = deliveryDefaults(
      undefined,
      { line1: '700 Demo Way', city: 'Example City', state: 'ID', postalCode: '83010' },
      undefined,
    );
    expect(seeded.name).toBe('');
    expect(seeded.line2).toBe('');
    expect(seeded.name).not.toBeUndefined();
  });
});

describe("line 1's address on the other lines", () => {
  const RIDGE = {
    line1: '110 Example Road',
    city: 'Sample Ridge',
    state: 'ID',
    postalCode: '83040',
  };

  const HARBOR = {
    name: 'Receiving',
    line1: '500 Sample Road',
    city: 'Sample Harbor',
    state: 'WA',
    postalCode: '98000',
  };

  const ID_SEED = { taxStatus: 'id_tax' as const, taxJurisdiction: 'ID' };
  const NO_SEED = { taxStatus: '' as const, taxJurisdiction: '' };

  const stored = (lineNumber: number, over: Record<string, unknown> = {}) =>
    line({
      lineNumber,
      taxStatus: 'id_tax',
      taxJurisdiction: 'ID',
      revenueCategory: 'print',
      ...over,
    });
  const blank = (lineNumber: number) => stored(lineNumber);
  const atHarbor = (lineNumber: number) =>
    stored(lineNumber, {
      deliveryAddress: HARBOR,
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9010',
      revenueCategory: 'label',
    });

  describe('firstLine and firstAddressedLine', () => {
    it('is undefined on a quote with no lines, or no line with an address', () => {
      expect(firstLine([])).toBeUndefined();
      expect(firstAddressedLine([])).toBeUndefined();
      expect(firstAddressedLine([blank(1), blank(2)])).toBeUndefined();
    });

    it('is the lowest-numbered line, whatever the array order', () => {
      const three = stored(3, { deliveryAddress: RIDGE });
      const two = atHarbor(2);
      const one = blank(1);
      expect(firstLine([three, one, two])).toBe(one);
      expect(firstAddressedLine([three, one, two])).toBe(two);
    });
  });

  describe('newLineSeeds', () => {
    it("takes line 1's address and pair over the account's Shipping address", () => {
      const seeds = newLineSeeds(RIDGE, ID_SEED, [atHarbor(1)]);
      expect(seeds.shippingSeed).toEqual(HARBOR);
      expect(seeds.taxSeed).toEqual({ taxStatus: 'wa_tax', taxJurisdiction: 'WA-9010' });
    });

    it("keeps the account's Shipping address and the customer's tax seed when line 1 has none", () => {
      const seeds = newLineSeeds(RIDGE, ID_SEED, [blank(1), atHarbor(2)]);
      expect(seeds.shippingSeed).toBe(RIDGE);
      expect(seeds.taxSeed).toBe(ID_SEED);

      expect(newLineSeeds(RIDGE, ID_SEED, []).shippingSeed).toBe(RIDGE);
    });

    it("takes line N's address and its tax pair when neither line 1 nor the account has one", () => {
      const seeds = newLineSeeds(undefined, ID_SEED, [blank(1), atHarbor(2), atHarbor(3)]);
      expect(seeds.shippingSeed).toEqual(HARBOR);
      expect(seeds.taxSeed).toEqual({ taxStatus: 'wa_tax', taxJurisdiction: 'WA-9010' });
    });

    it('copies a non-taxable pair as a blank jurisdiction, the shape a new row renders', () => {
      const exempt = stored(1, {
        deliveryAddress: RIDGE,
        taxStatus: 'non_tax',
        taxJurisdiction: undefined,
      });
      expect(newLineSeeds(undefined, NO_SEED, [exempt]).taxSeed).toEqual({
        taxStatus: 'non_tax',
        taxJurisdiction: '',
      });
    });

    it("starts blank, on the customer's tax seed, when nothing has an address", () => {
      const seeds = newLineSeeds(undefined, NO_SEED, [blank(1)]);
      expect(seeds.shippingSeed).toBeUndefined();
      expect(seeds.taxSeed).toBe(NO_SEED);
    });

    it('reaches the new row, and only the new row', () => {
      const seeds = newLineSeeds(undefined, ID_SEED, [atHarbor(1)]);
      const row = deliveryTaxValues(undefined, seeds.taxSeed, seeds.shippingSeed, undefined);
      expect(row.delivery).toEqual({ ...HARBOR, line2: '' });
      expect(row.taxStatus).toBe('wa_tax');
      expect(row.taxJurisdiction).toBe('WA-9010');

      const kept = deliveryTaxValues(blank(2), seeds.taxSeed, seeds.shippingSeed, undefined);
      expect(kept.delivery.city).toBe('');
      expect(kept.taxStatus).toBe('id_tax');
      expect(kept.taxJurisdiction).toBe('');
    });
  });

  describe("where a later card's Ship to starts", () => {
    it('lists the three choices in the words of the owner', () => {
      expect(SHIP_TO_CHOICES.map((choice) => SHIP_TO_LABELS[choice])).toEqual([
        'Same as line 1',
        'A different address',
        'No delivery address (collected)',
      ]);
    });

    it("starts on Same as line 1 when the address and the tax pair are line 1's", () => {
      const start = shipToStart({ line: atHarbor(2), first: atHarbor(1), row: undefined });
      expect(start).toBe('same');

      const unnamed = stored(2, {
        deliveryAddress: { ...HARBOR, name: undefined },
        taxStatus: 'wa_tax',
        taxJurisdiction: 'WA-9010',
      });
      const named = stored(1, {
        deliveryAddress: { ...HARBOR, name: '' },
        taxStatus: 'wa_tax',
        taxJurisdiction: 'WA-9010',
      });
      expect(shipToStart({ line: unnamed, first: named, row: undefined })).toBe('same');
    });

    it('starts on Same as line 1 for two blank addresses with one tax pair', () => {
      expect(shipToStart({ line: blank(2), first: blank(1), row: undefined })).toBe('same');
    });

    it('starts on No delivery address when its address is blank and something differs', () => {
      expect(shipToStart({ line: blank(2), first: atHarbor(1), row: undefined })).toBe('collected');
      const otherTax = stored(2, { taxStatus: 'non_tax', taxJurisdiction: undefined });
      expect(shipToStart({ line: otherTax, first: blank(1), row: undefined })).toBe('collected');
    });

    it('starts on A different address when the address differs, or only the tax does', () => {
      const ridge = stored(2, { deliveryAddress: RIDGE });
      expect(shipToStart({ line: ridge, first: atHarbor(1), row: undefined })).toBe('different');

      const sameStreet = stored(2, { deliveryAddress: HARBOR, taxStatus: 'non_tax' });
      expect(shipToStart({ line: sameStreet, first: atHarbor(1), row: undefined })).toBe(
        'different',
      );
      const otherCity = stored(2, {
        deliveryAddress: { ...HARBOR, city: 'Demo Hollow' },
        taxStatus: 'wa_tax',
        taxJurisdiction: 'WA-9010',
      });
      expect(shipToStart({ line: otherCity, first: atHarbor(1), row: undefined })).toBe(
        'different',
      );
    });

    it('starts on the choice as posted after a refused save', () => {
      const first = atHarbor(1);
      expect(shipToStart({ line: atHarbor(2), first, row: { shipTo: 'collected' } })).toBe(
        'collected',
      );
      expect(shipToStart({ line: blank(2), first, row: { shipTo: 'same' } })).toBe('same');

      expect(shipToStart({ line: atHarbor(2), first, row: {} })).toBe('different');
      expect(shipToStart({ line: atHarbor(2), first, row: { shipTo: 'line-3' } })).toBe(
        'different',
      );
    });
  });

  describe('the Same as line 1 sentence', () => {
    it('says what the save does, in one section-note sentence', () => {
      expect(SAME_AS_LINE_ONE_NOTE).toBe("Saving copies line 1's address and tax onto this line.");
      expect(SAME_AS_LINE_ONE_NOTE.split(' ').length).toBeLessThanOrEqual(25);
    });

    it("names line 1's saved address, and nothing when it has none", () => {
      expect(lineOneSavedAddress(atHarbor(1))).toBe(
        "Line 1's saved address: Receiving, 500 Sample Road, Sample Harbor, WA 98000.",
      );
      expect(lineOneSavedAddress(blank(1))).toBeUndefined();
    });
  });
});

describe('the tax treatment and revenue category', () => {
  const seed = { taxStatus: 'id_tax' as const, taxJurisdiction: 'ID' };

  it('seeds a blank row from the customer', () => {
    expect(taxAndRevenueDefaults(undefined, seed, undefined)).toEqual({
      revenueCategory: 'print',
      taxStatus: 'id_tax',
      taxJurisdiction: '',
    });
  });

  it('keeps what a stored line was saved with, seed or no seed', () => {
    const stored = taxAndRevenueDefaults(
      line({ revenueCategory: 'freight', taxStatus: 'non_tax', taxJurisdiction: undefined }),
      seed,
      undefined,
    );
    expect(stored).toEqual({
      revenueCategory: 'freight',
      taxStatus: 'non_tax',
      taxJurisdiction: '',
    });
  });

  it('defaults the category but never invents a tax status', () => {
    expect(
      taxAndRevenueDefaults(undefined, { taxStatus: '', taxJurisdiction: '' }, undefined),
    ).toEqual({
      revenueCategory: 'print',
      taxStatus: '',
      taxJurisdiction: '',
    });
  });
});

describe('the Tax jurisdiction box starts empty off Washington taxable', () => {
  const idaho = line({ taxStatus: 'id_tax', taxJurisdiction: 'ID', freight: { mode: 'pickup' } });
  const washington = line({ taxStatus: 'wa_tax', taxJurisdiction: 'WA-9137' });
  const NO_SEED = { taxStatus: '' as const, taxJurisdiction: '' };

  it('starts a saved Idaho line empty, so a switch to Washington taxable shows no ID', () => {
    expect(deliveryTaxValues(idaho, NO_SEED, undefined, undefined)).toMatchObject({
      taxStatus: 'id_tax',
      taxJurisdiction: '',
    });
  });

  it('keeps a saved Washington code: WA-9137 stays WA-9137', () => {
    expect(deliveryTaxValues(washington, NO_SEED, undefined, undefined)).toMatchObject({
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
    });
  });

  it("starts a new line seeded Idaho empty, and keeps a Washington seed's code", () => {
    const seededIdaho = { taxStatus: 'id_tax' as const, taxJurisdiction: 'ID' };
    const seededWashington = { taxStatus: 'wa_tax' as const, taxJurisdiction: 'WA-9137' };
    expect(deliveryTaxValues(undefined, seededIdaho, undefined, undefined)).toMatchObject({
      taxStatus: 'id_tax',
      taxJurisdiction: '',
    });
    expect(deliveryTaxValues(undefined, seededWashington, undefined, undefined)).toMatchObject({
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
    });
  });

  it('posts a saved Idaho line with its treatment and no code, which saves as ID', () => {
    const posted = storedLineValues(idaho, undefined);
    expect(posted).toHaveProperty('taxStatus', 'id_tax');
    expect(posted).not.toHaveProperty('taxJurisdiction');
  });

  it('shows a refused save as posted, whatever the box held', () => {
    for (const typed of ['ID', 'WA 9137', 'WA-9137']) {
      expect(
        taxAndRevenueDefaults(idaho, NO_SEED, { taxStatus: 'wa_tax', taxJurisdiction: typed })
          .taxJurisdiction,
        typed,
      ).toBe(typed);
    }
    expect(
      taxAndRevenueDefaults(idaho, NO_SEED, { taxStatus: 'id_tax', taxJurisdiction: 'WA 9137' }),
    ).toMatchObject({ taxStatus: 'id_tax', taxJurisdiction: 'WA 9137' });
  });
});

describe('the row as it was posted', () => {
  const seed = { taxStatus: 'id_tax' as const, taxJurisdiction: 'ID' };

  it('scopes the URL echo to one row', () => {
    const echo = {
      'lines[0].paper': 'kraft-40:long',
      'lines[1].paper': 'bond-20:500',
      'lines[1].delivery.city': 'Sample Harbor',
      resend: '1',
    };

    expect(rowEcho(echo, 1)).toEqual({ paper: 'bond-20:500', 'delivery.city': 'Sample Harbor' });
  });

  it('is absent when the URL carries no line echo at all', () => {
    expect(rowEcho({ error: 'Could not email the quote' }, 0)).toBeUndefined();
  });

  it('is an empty row, not an absent one, for a row that posted nothing', () => {
    expect(rowEcho({ 'lines[0].paper': 'kraft-40:long' }, 1)).toEqual({});
  });

  it('outranks the stored line on every core input', () => {
    const stored = line({
      gradeId: 'kraft-40',
      footageVariant: 'long',
      rollWidthIn: 12,
      quantityRolls: 4,
      overwrap: true,
      printed: true,

      feetPerRollOverride: '1840.0000',
      tierOverrideCode: 'V5',
      overridePricePerRoll: '87.0000',

      convertCostPerTon: '200.0000',
      printCostPerTon: '300.0000',
      freight: { mode: 'carrier' },
    });

    expect(
      coreDefaults(stored, {
        paper: 'bond-20:short',
        feetPerRollOverride: '1615.0000',
        rollWidthIn: '24',
        quantityRolls: '7',
        convertCostPerTon: '250',
        freightMode: 'pickup',
      }),
    ).toEqual({
      gradeId: 'bond-20',
      footageVariant: 'short',
      feetPerRollOverride: '1615.0000',
      rollWidthIn: '24',
      quantityRolls: '7',

      overwrap: false,
      printed: false,
      tierOverrideCode: '',

      marginOverridePct: '',
      overridePricePerRoll: '',
      overridePricePerLb: '',
      pricingBasis: 'per_roll',
      orderedWeightLb: '',
      customerPartNumber: '',
      customerDescription: '',

      convertCostPerTon: '250',
      printCostPerTon: '',
      freightMode: 'pickup',
    });
  });

  it('shows a stored hand-set price per pound, and lets the echo outrank it', () => {
    const stored = line({
      pricingBasis: 'per_pound',
      overridePricePerLb: '0.8350',
      freight: { mode: 'pickup' },
    });

    expect(coreDefaults(stored, undefined).overridePricePerLb).toBe('0.8350');

    expect(
      coreDefaults(stored, { paper: 'bond-20:500', overridePricePerLb: '1.1400' })
        .overridePricePerLb,
    ).toBe('1.1400');
  });

  it('shows the stored pounds ordered, and lets the echo outrank them', () => {
    const stored = line({
      pricingBasis: 'per_pound',
      orderedWeightLb: '1000.0000',
      freight: { mode: 'pickup' },
    });

    expect(coreDefaults(stored, undefined).orderedWeightLb).toBe('1000.0000');
    expect(coreDefaults(line({ freight: { mode: 'pickup' } }), undefined).orderedWeightLb).toBe('');

    expect(
      coreDefaults(stored, { paper: 'bond-20:500', orderedWeightLb: '1850' }).orderedWeightLb,
    ).toBe('1850');
  });

  it('shows the stored customer names, and lets the echo outrank them', () => {
    const stored = line({
      customerPartNumber: 'LN-1300-C',
      customerDescription: 'CEDAR CORE SHEET',
      freight: { mode: 'pickup' },
    });

    expect(coreDefaults(stored, undefined)).toMatchObject({
      customerPartNumber: 'LN-1300-C',
      customerDescription: 'CEDAR CORE SHEET',
    });
    expect(coreDefaults(line({ freight: { mode: 'pickup' } }), undefined)).toMatchObject({
      customerPartNumber: '',
      customerDescription: '',
    });

    expect(
      coreDefaults(stored, {
        paper: 'bond-20:500',
        customerPartNumber: 'LN-870',
        customerDescription: 'CEDAR CORE',
      }),
    ).toMatchObject({ customerPartNumber: 'LN-870', customerDescription: 'CEDAR CORE' });
  });

  it('keeps a variant containing the separator across a refusal', () => {
    const values = coreDefaults(undefined, { paper: '0a7c-3e51:500:short' });
    expect(values.gradeId).toBe('0a7c-3e51');
    expect(values.footageVariant).toBe('500:short');
  });

  it('reads a ticked checkbox back as ticked', () => {
    const values = coreDefaults(undefined, { overwrap: 'on', printed: 'on' });
    expect(values.overwrap).toBe(true);
    expect(values.printed).toBe(true);
  });

  it('gives the append row its blank-row fallbacks when the echo is silent', () => {
    expect(coreDefaults(undefined, {})).toEqual({
      gradeId: '',
      footageVariant: '',
      feetPerRollOverride: '',
      rollWidthIn: '',
      quantityRolls: '',
      overwrap: false,
      printed: false,
      tierOverrideCode: '',
      marginOverridePct: '',
      overridePricePerRoll: '',
      overridePricePerLb: '',
      pricingBasis: 'per_roll',
      orderedWeightLb: '',
      customerPartNumber: '',
      customerDescription: '',
      convertCostPerTon: '',
      printCostPerTon: '',
      freightMode: 'pickup',
    });
  });

  it('keeps the three freight boxes as typed, whatever the mode says', () => {
    expect(
      freightDefaults(line({ freight: { mode: 'pickup' } }), {
        rateOverride: '9.7500',
        carrierBid: '800.0000',
        freightMarginPct: '12',
      }),
    ).toEqual({
      rateOverride: '9.7500',
      carrierBid: '800.0000',
      freightMargin: '12',
    });
  });

  it('brings back the half address the refusal is about', () => {
    expect(
      deliveryDefaults(undefined, undefined, {
        'delivery.name': 'Receiving',
        'delivery.city': 'Example City',
      }),
    ).toEqual({
      name: 'Receiving',
      line1: '',
      line2: '',
      city: 'Example City',
      state: '',
      postalCode: '',
    });
  });

  it('does not re-seed the delivery address over a box the person cleared', () => {
    const shipTo = {
      name: 'Receiving',
      line1: '500 Sample Road',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000',
    };

    expect(deliveryDefaults(undefined, shipTo, { rollWidthIn: '12' })).toEqual({
      name: '',
      line1: '',
      line2: '',
      city: '',
      state: '',
      postalCode: '',
    });
  });

  it('shows what was typed over the seed when only part of the address was changed', () => {
    const shipTo = {
      line1: '500 Sample Road',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000',
    };

    expect(
      deliveryDefaults(undefined, shipTo, {
        'delivery.line1': '130 Sample Lane',
        'delivery.city': 'Demo Port',
        'delivery.state': 'OR',
        'delivery.postalCode': '97000',
      }),
    ).toEqual({
      name: '',
      line1: '130 Sample Lane',
      line2: '',
      city: 'Demo Port',
      state: 'OR',
      postalCode: '97000',
    });
  });

  it('does not re-seed the tax treatment over an answer somebody gave', () => {
    expect(taxAndRevenueDefaults(undefined, seed, { taxStatus: 'non_tax' })).toEqual({
      revenueCategory: 'print',
      taxStatus: 'non_tax',
      taxJurisdiction: '',
    });
  });

  it('shows the stored costs per US ton in their boxes', () => {
    const stored = line({
      convertCostPerTon: '200.0000',
      printCostPerTon: '300.0000',
      freight: { mode: 'pickup' },
    });

    expect(coreDefaults(stored, undefined)).toMatchObject({
      convertCostPerTon: '200.0000',
      printCostPerTon: '300.0000',
    });
    expect(coreDefaults(line({ freight: { mode: 'pickup' } }), undefined)).toMatchObject({
      convertCostPerTon: '',
      printCostPerTon: '',
    });

    expect(coreDefaults(undefined, undefined)).toMatchObject({
      convertCostPerTon: '',
      printCostPerTon: '',
    });
  });

  it('brings a refused cost back exactly as typed, so the box the banner names holds it', () => {
    const stored = line({ printCostPerTon: '300.0000', freight: { mode: 'pickup' } });

    expect(
      coreDefaults(stored, {
        paper: 'bond-20:500',
        convertCostPerTon: 'abc',
        printCostPerTon: '-5',
      }),
    ).toMatchObject({ convertCostPerTon: 'abc', printCostPerTon: '-5' });
  });
});

describe('blankRowStart', () => {
  const PAPER = 'grade-1:long';

  it('reads a paper-only echo as a blank row with that paper chosen, so the seeds apply', () => {
    expect(blankRowStart({ paper: PAPER }, PAPER)).toEqual({ echo: undefined, chosenPaper: PAPER });
  });

  it('keeps the paper when only the echo carried it', () => {
    expect(blankRowStart({ paper: PAPER }, undefined)).toEqual({
      echo: undefined,
      chosenPaper: PAPER,
    });
  });

  it('keeps a fuller echo as the row as posted', () => {
    const echo = { paper: PAPER, quantityRolls: '10', taxStatus: 'id_tax' };
    expect(blankRowStart(echo, PAPER)).toEqual({ echo, chosenPaper: PAPER });
  });

  it('takes the paper off the URL when the echo was too long to travel', () => {
    expect(blankRowStart(undefined, PAPER)).toEqual({ echo: undefined, chosenPaper: PAPER });
  });

  it('starts an ordinary blank row with nothing chosen', () => {
    expect(blankRowStart(undefined, undefined)).toEqual({
      echo: undefined,
      chosenPaper: undefined,
    });
  });
});

describe('openForms', () => {
  const none = { echo: {}, edit: undefined, add: false, newLinePaper: undefined };

  it('opens the blank form when there are no lines, and nothing else', () => {
    const open = openForms({ ...none, lineCount: 0 });
    expect(open.blank).toBe(true);
    expect(open.stored.size).toBe(0);
  });

  it('shows saved lines as rows, with no blank form, by default', () => {
    const open = openForms({ ...none, lineCount: 2 });
    expect(open.blank).toBe(false);
    expect(open.stored.size).toBe(0);
  });

  it('opens the line "Edit line N" names, by its number, and ignores a number off the quote', () => {
    expect([...openForms({ ...none, lineCount: 2, edit: '2' }).stored]).toEqual([1]);
    expect(openForms({ ...none, lineCount: 2, edit: '3' }).stored.size).toBe(0);
    expect(openForms({ ...none, lineCount: 2, edit: 'x' }).stored.size).toBe(0);
  });

  it('opens the blank form for "Add another line" and for a paper Choose widths picked', () => {
    expect(openForms({ ...none, lineCount: 1, add: true }).blank).toBe(true);
    expect(openForms({ ...none, lineCount: 1, newLinePaper: 'g:long' }).blank).toBe(true);
  });

  it('reopens exactly the forms a refused save posted as open', () => {
    const open = openForms({
      ...none,
      lineCount: 2,
      echo: { 'lines[1].open': '1', 'lines[1].paper': 'g:long', 'lines[2].open': '1' },
    });
    expect([...open.stored]).toEqual([1]);
    expect(open.blank).toBe(true);
  });
});

describe('blankRowStart and the open marker', () => {
  it('reads an echo of only the paper and the marker as a blank row with that paper', () => {
    expect(blankRowStart({ paper: 'g:long', open: '1' }, undefined)).toEqual({
      echo: undefined,
      chosenPaper: 'g:long',
    });
  });
});

const PLAIN: MoreOptionsValues = {
  pricingBasis: 'per_roll',
  tierOverrideCode: '',
  marginOverridePct: '',
  overridePricePerRoll: '',
  overridePricePerLb: '',
  orderedWeightLb: '',
  customerDescription: '',
  customerPartNumber: '',
  printed: false,
  overwrap: false,
  convertCostPerTon: '',
  printCostPerTon: '',
  freightMode: 'pickup',
  rateOverride: '',
  carrierBid: '',
  freightMargin: '',
};
const TIERS = [{ code: 'TRADE', name: 'Trade' }];

describe('moreOptionsSum', () => {
  it('reads one plain sentence for a line that holds nothing', () => {
    expect(moreOptionsSum(PLAIN, TIERS)).toBe(
      'priced per roll · tier by volume · plain, no overwrap · no customer description',
    );
  });

  it('names every value set, the hand-set price included', () => {
    expect(
      moreOptionsSum(
        {
          ...PLAIN,
          pricingBasis: 'per_pound',
          orderedWeightLb: '1850',
          tierOverrideCode: 'TRADE',
          overridePricePerRoll: '38.6',
          printed: true,
          overwrap: true,
          customerDescription: 'Deli wrap',
          customerPartNumber: 'P-7',
        },
        TIERS,
      ),
    ).toBe(
      'priced per pound · Trade tier · 1850 lb ordered · hand-set $38.60 / roll · ' +
        'printed, overwrap · described as "Deli wrap" · part P-7',
    );
  });
});

describe('the costs per US ton in More options', () => {
  it('names both costs after Printed and Overwrap', () => {
    expect(
      moreOptionsSum(
        { ...PLAIN, printed: true, convertCostPerTon: '200', printCostPerTon: '300.0000' },
        TIERS,
      ),
    ).toBe(
      'priced per roll · tier by volume · printed, no overwrap · converting $200.00 / ton · ' +
        'print $300.00 / ton · no customer description',
    );
  });

  it('names only the one that is set, and adds nothing for a blank box', () => {
    expect(moreOptionsSum({ ...PLAIN, convertCostPerTon: '143.5' }, TIERS)).toBe(
      'priced per roll · tier by volume · plain, no overwrap · converting $143.50 / ton · ' +
        'no customer description',
    );
    expect(moreOptionsSum({ ...PLAIN, printCostPerTon: '300' }, TIERS)).toBe(
      'priced per roll · tier by volume · plain, no overwrap · print $300.00 / ton · ' +
        'no customer description',
    );
  });

  it('reads a typed 0 as $0.00, since it is what the person typed', () => {
    expect(moreOptionsSum({ ...PLAIN, convertCostPerTon: '0' }, TIERS)).toContain(
      'converting $0.00 / ton',
    );
    expect(moreOptionsOpen({ ...PLAIN, convertCostPerTon: '0' })).toBe(true);
  });

  it('opens the fold on a cost, stored or posted', () => {
    expect(moreOptionsOpen({ ...PLAIN, convertCostPerTon: '200.0000' })).toBe(true);
    expect(moreOptionsOpen({ ...PLAIN, printCostPerTon: '300' })).toBe(true);

    expect(moreOptionsOpen({ ...PLAIN, printCostPerTon: 'abc' })).toBe(true);
  });

  it('gives the box and the collector one pattern: dollars to four places, no sign', () => {
    const anchored = new RegExp(`^(?:${COST_PER_TON_PATTERN})$`);
    for (const ok of ['0', '200', '143.5', '143.5000']) {
      expect(anchored.test(ok)).toBe(true);
    }
    for (const bad of ['-5', 'abc', '43.80271', '1,200', '.5', '$200']) {
      expect(anchored.test(bad)).toBe(false);
    }
  });
});

describe('PRINTED_NO_PRINT_COST_CSS', () => {
  it('says the Printed hint in one sentence within the hint budget', () => {
    expect(PRINTED_NO_PRINT_COST_HINT).toBe(
      'Printed, with no print cost entered, so printing adds nothing to the price.',
    );
    expect(PRINTED_NO_PRINT_COST_HINT.split(/\s+/).length).toBeLessThanOrEqual(15);
  });

  it('shows the hint only while its own line is ticked Printed with Print cost empty', () => {
    expect(PRINTED_NO_PRINT_COST_CSS).toContain(
      '.line-form:has(input[name$=".printed"]:checked)' +
        ':has(input[name$=".printCostPerTon"]:placeholder-shown) .printed-no-print-cost {\n' +
        '  display: contents;\n}',
    );
  });

  it('fails hidden: the rule that hides it has no :has(), so it stands where :has() is unsupported', () => {
    expect(PRINTED_NO_PRINT_COST_CSS).toContain('.printed-no-print-cost {\n  display: none;\n}');
    expect(PRINTED_NO_PRINT_COST_CSS.match(/display: none;/g)).toHaveLength(1);
  });
});

describe('a margin entered manually', () => {
  const priced = (over: Record<string, unknown>) =>
    line({ pricingBasis: 'per_roll', freight: { mode: 'pickup' }, ...over });

  it('reopens a stored margin line on its own choice, with the margin as a lossless percent', () => {
    const stored = coreDefaults(priced({ marginOverridePct: '0.420000' }), undefined);
    expect(stored.tierOverrideCode).toBe(MARGIN_ENTERED_CHOICE);
    expect(stored.marginOverridePct).toBe('42');

    expect(
      coreDefaults(priced({ marginOverridePct: '0.425000' }), undefined).marginOverridePct,
    ).toBe('42.5');
  });

  it('leaves a line with no margin on its tier, with an empty box', () => {
    const tiered = coreDefaults(priced({ tierOverrideCode: 'volume_5' }), undefined);
    expect(tiered.tierOverrideCode).toBe('volume_5');
    expect(tiered.marginOverridePct).toBe('');
    expect(coreDefaults(undefined, undefined).marginOverridePct).toBe('');
  });

  it('brings a refused margin back exactly as typed, the choice with it', () => {
    const echoed = coreDefaults(priced({ marginOverridePct: '0.420000' }), {
      tierOverrideCode: MARGIN_ENTERED_CHOICE,
      marginOverridePct: '10.0',
    });
    expect(echoed.tierOverrideCode).toBe(MARGIN_ENTERED_CHOICE);
    expect(echoed.marginOverridePct).toBe('10.0');
  });

  it('posts the choice and the margin from a closed line, so a save keeps it', () => {
    const stored = line({
      gradeId: 'grade-kraft-40',
      quantityRolls: 10,
      pricingBasis: 'per_roll',
      freight: { mode: 'pickup' },
      revenueCategory: 'print',
      taxStatus: 'non_tax',
      marginOverridePct: '0.420000',
    });
    const values = storedLineValues(stored, undefined);
    expect(values['tierOverrideCode']).toBe(MARGIN_ENTERED_CHOICE);
    expect(values['marginOverridePct']).toBe('42');
  });

  it('names the margin in the sum line in the tier’s place, and opens the fold', () => {
    const values = { ...PLAIN, tierOverrideCode: MARGIN_ENTERED_CHOICE, marginOverridePct: '42' };
    expect(moreOptionsSum(values, TIERS)).toBe(
      'priced per roll · margin entered manually, 42% · plain, no overwrap · no customer description',
    );
    expect(moreOptionsOpen(values)).toBe(true);
    expect(moreOptionsSum({ ...values, marginOverridePct: '' }, TIERS)).toContain(
      '· margin entered manually ·',
    );
  });

  it('keeps the choice outside every tier code the tiers page can create', () => {
    expect(/^[a-z][a-z0-9_]*$/.test(MARGIN_ENTERED_CHOICE)).toBe(false);
    expect(MARGIN_ENTERED_LABEL).toBe('Enter margin manually');
  });

  it('gives the box and the collector one pattern: a percent to one decimal place', () => {
    const anchored = new RegExp(`^(?:${MARGIN_PERCENT_PATTERN})$`);
    for (const ok of ['42', '42.0', '63.5', '95']) {
      expect(anchored.test(ok)).toBe(true);
    }
    for (const bad of ['42.25', '-5', 'abc', '.5', '42%', '']) {
      expect(anchored.test(bad)).toBe(false);
    }
  });

  it('reads the floor into the hint, within the hint budget', () => {
    expect(marginEnteredHint('0.240000')).toBe(
      'From 24% to 95%, to one decimal place. Needs no approval.',
    );
    expect(marginEnteredHint('0.275000')).toContain('From 27.5% to 95%');
    expect(marginEnteredHint('0.240000').split(/\s+/).length).toBeLessThanOrEqual(15);
  });

  it('opens the summary row note with the margin where a tier line names its tier', () => {
    const tierLine = line({ tier: { name: 'Small batch' }, marginPct: '0.380000' });
    expect(summaryPricedAt(tierLine)).toBe('Small batch tier, 38% margin');
    const entered = line({
      tier: { name: 'Trade' },
      marginPct: '0.420000',
      marginOverridePct: '0.420000',
    });
    expect(summaryPricedAt(entered)).toBe('Margin entered manually, 42%');
  });

  it('names a line at the customer agreed price, with the tier price in its basis', () => {
    expect(
      typedPriceWords(
        line({
          priceSource: 'agreed',
          pricingBasis: 'per_pound',
          overridePricePerLb: '0.6900',
          basePricePerRoll: '12.7107',
          basePricePerLb: '0.5842',
        }),
      ),
    ).toEqual({
      label: 'Customer’s agreed price',
      inline: 'customer’s agreed price',
      tierPrice: '$0.5842 / lb',
    });
    expect(
      typedPriceWords(
        line({
          priceSource: 'agreed',
          pricingBasis: 'per_roll',
          overridePricePerRoll: '21.7500',
          basePricePerRoll: '12.7107',
        }),
      ),
    ).toMatchObject({ label: 'Customer’s agreed price', tierPrice: '$12.71' });

    expect(
      typedPriceWords(
        line({
          priceSource: 'manual',
          overridePricePerRoll: '21.7500',
          basePricePerRoll: '12.7107',
        }),
      ),
    ).toEqual({ label: 'Hand-set price', inline: 'hand-set', tierPrice: '$12.71' });
    expect(typedPriceWords(line({ priceSource: 'tier', basePricePerRoll: '12.7107' }))).toBe(
      undefined,
    );
  });

  it('names a hand-set price per pound, with the tier price per pound beside it', () => {
    expect(
      typedPriceWords(
        line({
          priceSource: 'manual',
          pricingBasis: 'per_pound',
          overridePricePerLb: '0.6050',
          basePricePerRoll: '12.7107',
          basePricePerLb: '0.5842',
        }),
      ),
    ).toEqual({ label: 'Hand-set price', inline: 'hand-set', tierPrice: '$0.5842 / lb' });

    expect(
      typedPriceWords(
        line({
          priceSource: 'tier',
          pricingBasis: 'per_pound',
          basePricePerRoll: '12.7107',
          basePricePerLb: '0.5842',
        }),
      ),
    ).toBe(undefined);
  });

  it('shows the box only while its own line chose the margin, failing visible', () => {
    expect(MARGIN_ENTERED_REVEAL_CSS).toContain(
      '.line-margin:not(:has(option[value="entered-margin"]:checked)) .margin-entered-box {\n' +
        '  display: none;\n}',
    );

    expect(MARGIN_ENTERED_REVEAL_CSS.match(/display: none;/g)).toHaveLength(1);
  });
});

describe('moreOptionsOpen', () => {
  it('stays closed on a plain line and opens on any value, a seeded per-pound basis included', () => {
    expect(moreOptionsOpen(PLAIN)).toBe(false);
    expect(moreOptionsOpen({ ...PLAIN, pricingBasis: 'per_pound' })).toBe(true);
    expect(moreOptionsOpen({ ...PLAIN, overridePricePerRoll: '40' })).toBe(true);
    expect(moreOptionsOpen({ ...PLAIN, printed: true })).toBe(true);
  });
});

describe('the freight boxes in More options', () => {
  const carrier = (over: Partial<MoreOptionsValues> = {}): MoreOptionsValues => ({
    ...PLAIN,
    freightMode: 'carrier',
    ...over,
  });

  it('opens the fold on a freight value the rendered mode reads', () => {
    expect(moreOptionsOpen(carrier())).toBe(false);
    expect(moreOptionsOpen(carrier({ carrierBid: '400.0000' }))).toBe(true);
    expect(moreOptionsOpen(carrier({ freightMargin: '12' }))).toBe(true);
    expect(moreOptionsOpen({ ...PLAIN, freightMode: 'our_vehicle', rateOverride: '30' })).toBe(
      true,
    );
  });

  it('names the freight values in the sum line, lower-case like the rest of it', () => {
    expect(moreOptionsSum(carrier({ carrierBid: '400.0000', freightMargin: '12' }), TIERS)).toBe(
      'priced per roll · tier by volume · carrier bid $400.00 · freight margin 12% · ' +
        'plain, no overwrap · no customer description',
    );
    expect(
      moreOptionsSum(
        { ...PLAIN, freightMode: 'pass_through', rateOverride: '41', carrierBid: '236.5' },
        TIERS,
      ),
    ).toBe(
      'priced per roll · tier by volume · rate override $41.00 · carrier bid $236.50 · ' +
        'plain, no overwrap · no customer description',
    );
  });

  it('counts only the boxes the select renders on, so an off-mode value stays shut and unnamed', () => {
    const switched = {
      ...PLAIN,
      freightMode: 'our_vehicle',
      carrierBid: '400',
      freightMargin: '12',
    };
    expect(moreOptionsOpen(switched)).toBe(false);
    expect(moreOptionsSum(switched, TIERS)).toBe(
      'priced per roll · tier by volume · plain, no overwrap · no customer description',
    );
  });
});

describe('freightBoxes', () => {
  it('asks for the boxes each shipping mode reads', () => {
    expect(freightBoxes('pickup')).toEqual({
      rateOverride: false,
      carrierBid: false,
      freightMargin: false,
    });
    expect(freightBoxes('our_vehicle')).toEqual({
      rateOverride: true,
      carrierBid: false,
      freightMargin: false,
    });
    expect(freightBoxes('pass_through')).toEqual({
      rateOverride: true,
      carrierBid: true,
      freightMargin: false,
    });
    expect(freightBoxes('carrier')).toEqual({
      rateOverride: false,
      carrierBid: true,
      freightMargin: true,
    });
  });
});

describe('LINE_FREIGHT_REVEAL_CSS', () => {
  const chosen = (mode: string) =>
    `:has(select[name$=".freightMode"] option[value="${mode}"]:checked)`;

  it('hides each box unless its own line chose a mode that reads it, failing visible', () => {
    expect(LINE_FREIGHT_REVEAL_CSS).toContain(
      `.line-form:not(${chosen('our_vehicle')}):not(${chosen('pass_through')}) .freight-rate {`,
    );
    expect(LINE_FREIGHT_REVEAL_CSS).toContain(
      `.line-form:not(${chosen('pass_through')}):not(${chosen('carrier')}) .freight-bid {`,
    );
    expect(LINE_FREIGHT_REVEAL_CSS).toContain(
      `.line-form:not(${chosen('carrier')}) .freight-margin {`,
    );
  });

  it('hides the whole row while the line is a pickup at Demo Printworks, which asks for none', () => {
    expect(LINE_FREIGHT_REVEAL_CSS).toContain(`.line-form${chosen('pickup')} .freight-row {`);
    expect(LINE_FREIGHT_REVEAL_CSS.match(/display: none;/g)).toHaveLength(4);
  });
});

describe('LINE_TAX_JURISDICTION_REVEAL_CSS', () => {
  it('shows the field only while its own line reads Washington taxable, failing visible', () => {
    const washington = ':has(select[name$=".taxStatus"] option[value="wa_tax"]:checked)';
    expect(LINE_TAX_JURISDICTION_REVEAL_CSS).toContain(
      `.line-form:not(${washington}) .tax-jurisdiction {\n  display: none;\n}`,
    );

    expect(LINE_TAX_JURISDICTION_REVEAL_CSS).toContain(
      '.tax-jurisdiction {\n  display: contents;\n}',
    );

    expect(LINE_TAX_JURISDICTION_REVEAL_CSS.match(/display: none;/g)).toHaveLength(1);
    expect(LINE_TAX_JURISDICTION_REVEAL_CSS).toBe(taxJurisdictionRevealCss('line-form'));
  });
});

describe('stepThreeHiddenValues', () => {
  const values = deliveryTaxValues(
    line({
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
      revenueCategory: 'design',
      deliveryAddress: {
        name: 'Dock 4',
        line1: '900 Sample Way',
        city: 'Sample Harbor',
        state: 'WA',
        postalCode: '98000',
      },
      freight: { mode: 'carrier', carrierBid: '400.0000', freightMarginPct: '0.120000' },
    }),
    { taxStatus: '', taxJurisdiction: '' },
    undefined,
    undefined,
  );

  it('carries the address, the tax pair and the revenue category, and never a freight box', () => {
    expect(stepThreeHiddenValues(values, false)).toEqual({
      'delivery.name': 'Dock 4',
      'delivery.line1': '900 Sample Way',
      'delivery.city': 'Sample Harbor',
      'delivery.state': 'WA',
      'delivery.postalCode': '98000',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
      revenueCategory: 'design',
    });
  });

  it('leaves the tax pair to the boxes when the form shows them', () => {
    const hidden = stepThreeHiddenValues(values, true);
    expect(hidden).not.toHaveProperty('taxStatus');
    expect(hidden).not.toHaveProperty('taxJurisdiction');
    expect(hidden).toHaveProperty('revenueCategory', 'design');
  });
});

describe('lineAsksTax', () => {
  it('asks when the pair the form renders does not settle the tax', () => {
    expect(lineAsksTax({ taxStatus: '', taxJurisdiction: '' }, false)).toBe(true);
    expect(lineAsksTax({ taxStatus: 'wa_tax', taxJurisdiction: '' }, false)).toBe(true);
  });

  it('carries a settled seed hidden, and asks again after a refused save', () => {
    expect(lineAsksTax({ taxStatus: 'wa_tax', taxJurisdiction: 'WA-9137' }, false)).toBe(false);
    expect(lineAsksTax({ taxStatus: 'non_tax', taxJurisdiction: '' }, false)).toBe(false);
    expect(lineAsksTax({ taxStatus: 'wa_tax', taxJurisdiction: 'WA-9137' }, true)).toBe(true);
  });

  it('carries an Idaho pair with no code hidden: its save fills ID', () => {
    const noSeed = { taxStatus: '' as const, taxJurisdiction: '' };
    const saved = deliveryTaxValues(
      line({ taxStatus: 'id_tax', taxJurisdiction: 'ID' }),
      noSeed,
      undefined,
      undefined,
    );
    expect(lineAsksTax(saved, false)).toBe(false);

    const noCode = { taxStatus: 'id_tax' as const, taxJurisdiction: '' };
    const seeded = deliveryTaxValues(undefined, noCode, undefined, undefined);
    expect(lineAsksTax(seeded, false)).toBe(false);
    expect(lineAsksTax({ taxStatus: 'id_tax', taxJurisdiction: '' }, true)).toBe(true);
  });
});

describe('storedLineValues', () => {
  it('posts every stored value under its form name, and leaves the empty ones out', () => {
    const stored = line({
      gradeId: 'grade-kraft-40',
      rollWidthIn: 17,
      customWidth: true,
      quantityRolls: 40,
      pricingBasis: 'per_roll',
      printed: true,
      overwrap: false,
      convertCostPerTon: '58.2500',
      printCostPerTon: '120.0000',
      revenueCategory: 'print',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
      freight: { mode: 'carrier', carrierBid: '446.0000', freightMarginPct: '0.1600' },
      deliveryAddress: {
        name: 'Dock 4',
        line1: '900 Sample Way',
        city: 'Sample Harbor',
        state: 'WA',
        postalCode: '98000',
      },
    });
    expect(storedLineValues(stored, grade({ widths: [{ rollWidthIn: 12 }] }))).toEqual({
      paper: 'grade-kraft-40:long',
      rollWidthIn: '17',
      customWidth: 'on',
      customWidthIn: '17',
      quantityRolls: '40',
      printed: 'on',
      pricingBasis: 'per_roll',

      convertCostPerTon: '58.2500',
      printCostPerTon: '120.0000',
      freightMode: 'carrier',
      carrierBid: '446.0000',
      freightMarginPct: '16',
      revenueCategory: 'print',
      taxStatus: 'wa_tax',
      taxJurisdiction: 'WA-9137',
      'delivery.name': 'Dock 4',
      'delivery.line1': '900 Sample Way',
      'delivery.city': 'Sample Harbor',
      'delivery.state': 'WA',
      'delivery.postalCode': '98000',
    });
  });
});

describe('deliveryWords', () => {
  it('names the shipping mode, and the destination when one is stored', () => {
    expect(
      deliveryWords('carrier', {
        line1: '600 Example Street',
        city: 'Example City',
        state: 'ID',
        postalCode: '83010',
      }),
    ).toBe('Freight · Example City, ID');
    expect(deliveryWords('pickup', undefined)).toBe('Customer pickup - Demo Printworks plant');
  });
});
