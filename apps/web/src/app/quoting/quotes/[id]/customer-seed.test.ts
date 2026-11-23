// Tests seeding a new line from the customer's defaults and parts, and what a blank row starts on.
import type { CustomerPart, QuoteLine, StoredCustomerPart } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { collectLines } from './collect-lines';
import {
  CUSTOMER_PARTS_FIELD,
  NEW_LINE_INDEX_FIELD,
  SEED_FREIGHT_MODE_FIELD,
  SEED_PRICING_BASIS_FIELD,
  SEED_TIER_CODE_FIELD,
  agreedPriceOfRow,
  encodeCustomerParts,
  lineSeedOf,
  readCustomerParts,
} from './customer-seed';
import { coreDefaults, moreOptionsOpen, moreOptionsSum } from './line-defaults';

const GRADE_ID = '9f1c0b8e-2d4a-4b7e-9c31-6a0f5d8e2b74';
const OTHER_GRADE_ID = '9f1c0b8e-2d4a-4b7e-9c31-6a0f5d8e2b75';

const PARTS: CustomerPart[] = [
  { gradeId: GRADE_ID, rollWidthIn: 18, partNumber: 'LN-16', description: 'CEDAR CORE 18' },
  { gradeId: GRADE_ID, rollWidthIn: 22, partNumber: 'LN-21' },
];

const TIERS = [
  { code: 'small_batch', name: 'Small batch' },
  { code: 'list', name: 'List' },
  { code: 'volume_3', name: 'Volume 3' },
];

const storedLine = () =>
  ({
    gradeId: GRADE_ID,
    footageVariant: 'long',
    rollWidthIn: 18,
    quantityRolls: 40,
    pricingBasis: 'per_roll',
    freight: { mode: 'pickup' },
  }) as unknown as QuoteLine;

const ROW: Record<string, string> = {
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
};

function form(
  rows: Record<string, string>[],
  options: { newLineIndex: number; parts?: StoredCustomerPart[]; seed?: Record<string, string> },
): FormData {
  const data = new FormData();
  data.set(NEW_LINE_INDEX_FIELD, String(options.newLineIndex));
  const encoded = encodeCustomerParts(options.parts ?? []);
  if (encoded !== undefined) {
    data.set(CUSTOMER_PARTS_FIELD, encoded);
  }
  for (const [name, value] of Object.entries(options.seed ?? {})) {
    data.set(name, value);
  }
  rows.forEach((row, i) => {
    for (const [field, value] of Object.entries(row)) {
      data.set(`lines[${i}].${field}`, value);
    }
  });
  return data;
}

function collect(data: FormData) {
  const result = collectLines(data);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.lines;
}

describe('filling the new line from the customer part', () => {
  it('fills both names from the part on the same paper and width', () => {
    const [line] = collect(form([ROW], { newLineIndex: 0, parts: PARTS }));
    expect(line?.customerPartNumber).toBe('LN-16');
    expect(line?.customerDescription).toBe('CEDAR CORE 18');
  });

  it('fills only the name the part has', () => {
    const [line] = collect(
      form([{ ...ROW, rollWidthIn: '22' }], { newLineIndex: 0, parts: PARTS }),
    );
    expect(line?.customerPartNumber).toBe('LN-21');
    expect(line?.customerDescription).toBeUndefined();
  });

  it('matches a custom width by its inches, as a stock width matches', () => {
    const custom = { ...ROW, rollWidthIn: '', customWidth: 'on', customWidthIn: '22' };
    const [line] = collect(form([custom], { newLineIndex: 0, parts: PARTS }));
    expect(line?.customWidth).toBe(true);
    expect(line?.customerPartNumber).toBe('LN-21');
  });

  it('fills a stock width in sixteenths from the part keyed at the same sixteenths', () => {
    const wrap: CustomerPart[] = [
      {
        gradeId: GRADE_ID,
        rollWidthIn: 9.75,
        partNumber: 'MW-20463',
        description: 'CEDAR CORE SHEET',
      },
    ];
    const [quarter] = collect(
      form([{ ...ROW, rollWidthIn: '9.75' }], { newLineIndex: 0, parts: wrap }),
    );
    expect(quarter?.customerPartNumber).toBe('MW-20463');
    expect(quarter?.customerDescription).toBe('CEDAR CORE SHEET');
    const [whole] = collect(form([{ ...ROW, rollWidthIn: '9' }], { newLineIndex: 0, parts: wrap }));
    expect(whole?.customerPartNumber).toBeUndefined();
  });

  it('fills nothing at a width or on a paper the customer has no part for', () => {
    const [atWidth] = collect(
      form([{ ...ROW, rollWidthIn: '24' }], { newLineIndex: 0, parts: PARTS }),
    );
    expect(atWidth?.customerPartNumber).toBeUndefined();
    const [onPaper] = collect(
      form([{ ...ROW, paper: `${OTHER_GRADE_ID}:long` }], { newLineIndex: 0, parts: PARTS }),
    );
    expect(onPaper?.customerPartNumber).toBeUndefined();
  });

  it('keeps what the rep typed, in either box, and fills neither', () => {
    const [numbered] = collect(
      form([{ ...ROW, customerPartNumber: 'MINE' }], { newLineIndex: 0, parts: PARTS }),
    );
    expect(numbered?.customerPartNumber).toBe('MINE');
    expect(numbered?.customerDescription).toBeUndefined();

    const [described] = collect(
      form([{ ...ROW, customerDescription: 'MY WORDS' }], { newLineIndex: 0, parts: PARTS }),
    );
    expect(described?.customerDescription).toBe('MY WORDS');
    expect(described?.customerPartNumber).toBeUndefined();
  });

  it('never fills a stored line, so a rep who cleared both boxes keeps them clear', () => {
    const lines = collect(form([ROW, ROW], { newLineIndex: 1, parts: PARTS }));
    expect(lines[0]?.customerPartNumber).toBeUndefined();
    expect(lines[1]?.customerPartNumber).toBe('LN-16');
  });

  it('fills nothing from a malformed part list, and still saves', () => {
    const data = form([ROW], { newLineIndex: 0 });
    data.set(CUSTOMER_PARTS_FIELD, '{not json');
    expect(collect(data)[0]?.customerPartNumber).toBeUndefined();
    expect(readCustomerParts(data)).toEqual([]);
  });
});

describe('filling the new line from the part agreed price', () => {
  const AGREED: StoredCustomerPart[] = [
    {
      gradeId: GRADE_ID,
      rollWidthIn: 18,
      partNumber: 'TEST-18',
      agreedPrice: {
        basis: 'per_pound',
        price: '0.6900',
        setBy: 'dev-billing',
        setAt: '2026-11-16T17:00:00.000Z',
      },
    },
    {
      gradeId: GRADE_ID,
      rollWidthIn: 22,
      partNumber: 'TEST-22',
      agreedPrice: {
        basis: 'per_roll',
        price: '21.7500',
        setBy: 'dev-billing',
        setAt: '2026-11-16T17:00:00.000Z',
      },
    },
  ];

  const POUND = { ...ROW, pricingBasis: 'per_pound', orderedWeightLb: '500' };

  it('fills the per-pound box from a per-pound agreed price', () => {
    const [line] = collect(form([POUND], { newLineIndex: 0, parts: AGREED }));
    expect(line?.overridePricePerLb).toBe('0.6900');
    expect(line?.overridePricePerRoll).toBeUndefined();
  });

  it('fills the per-roll box from a per-roll agreed price', () => {
    const [line] = collect(
      form([{ ...ROW, rollWidthIn: '22' }], { newLineIndex: 0, parts: AGREED }),
    );
    expect(line?.overridePricePerRoll).toBe('21.7500');
    expect(line?.overridePricePerLb).toBeUndefined();
  });

  it('gives a line in the other basis nothing', () => {
    const [line] = collect(form([ROW], { newLineIndex: 0, parts: AGREED }));
    expect(line?.overridePricePerRoll).toBeUndefined();
    expect(line?.overridePricePerLb).toBeUndefined();
  });

  it('lets a typed price or an entered margin win, and never refills a stored line', () => {
    const [typed] = collect(
      form([{ ...POUND, overridePricePerLb: '0.7850' }], { newLineIndex: 0, parts: AGREED }),
    );
    expect(typed?.overridePricePerLb).toBe('0.7850');

    const [margin] = collect(
      form([{ ...POUND, tierOverrideCode: 'entered-margin', marginOverridePct: '42.0' }], {
        newLineIndex: 0,
        parts: AGREED,
      }),
    );
    expect(margin?.overridePricePerLb).toBeUndefined();
    expect(margin?.marginOverridePct).toBeDefined();

    const lines = collect(form([POUND, POUND], { newLineIndex: 1, parts: AGREED }));
    expect(lines[0]?.overridePricePerLb).toBeUndefined();
    expect(lines[1]?.overridePricePerLb).toBe('0.6900');
  });

  it('carries only the basis and the figure in the hidden field, never who set it', () => {
    const encoded = encodeCustomerParts(AGREED) ?? '';
    expect(encoded).not.toContain('dev-billing');
    expect(JSON.parse(encoded)[0].agreedPrice).toEqual({ basis: 'per_pound', price: '0.6900' });
  });

  it('posts a forged agreed price as a plain hand-set price, and a malformed one as no part', () => {
    const data = form([POUND], { newLineIndex: 0 });
    data.set(
      CUSTOMER_PARTS_FIELD,
      JSON.stringify([
        {
          gradeId: GRADE_ID,
          rollWidthIn: 18,
          partNumber: 'TEST-18',
          agreedPrice: { basis: 'per_pound', price: '0.0150' },
        },
      ]),
    );
    const [forged] = collect(data);
    expect(forged?.overridePricePerLb).toBe('0.0150');
    expect(Object.keys(forged ?? {})).not.toContain('priceSource');
    expect(Object.keys(forged ?? {})).not.toContain('agreedPrice');

    data.set(
      CUSTOMER_PARTS_FIELD,
      JSON.stringify([
        {
          gradeId: GRADE_ID,
          rollWidthIn: 18,
          partNumber: 'TEST-18',
          agreedPrice: { basis: 'per_pound', price: '0' },
        },
      ]),
    );
    const [malformed] = collect(data);
    expect(malformed?.overridePricePerLb).toBeUndefined();
    expect(malformed?.customerPartNumber).toBeUndefined();
  });

  it('finds the row agreed price only when the paper and the width are both known', () => {
    expect(agreedPriceOfRow(AGREED, GRADE_ID, '18')).toEqual(AGREED[0]?.agreedPrice);
    expect(agreedPriceOfRow(AGREED, GRADE_ID, '')).toBeUndefined();
    expect(agreedPriceOfRow(AGREED, '', '18')).toBeUndefined();
    expect(agreedPriceOfRow(AGREED, GRADE_ID, '24')).toBeUndefined();
  });
});

describe('filling the new line from the part roll length', () => {
  const BOND: CustomerPart[] = [
    {
      gradeId: GRADE_ID,
      rollWidthIn: 11.3125,
      partNumber: 'MW-1175-A',
      description: 'CEDAR CORE SHEET',
      feetPerRoll: '1480.0000',
    },
    { gradeId: GRADE_ID, rollWidthIn: 9.75, partNumber: 'MW-20463' },
  ];

  const OWN = { ...ROW, rollWidthIn: '11.3125', lengthChoice: 'own', feetPerRollOverride: '' };

  it('fills the part length on the new line left on the paper own', () => {
    const [line] = collect(form([OWN], { newLineIndex: 0, parts: BOND }));
    expect(line?.feetPerRollOverride).toBe('1480.0000');
  });

  it('fills the length whether the two name boxes were blank or typed', () => {
    const [blank] = collect(form([OWN], { newLineIndex: 0, parts: BOND }));
    expect(blank?.customerPartNumber).toBe('MW-1175-A');
    expect(blank?.feetPerRollOverride).toBe('1480.0000');
    const [typed] = collect(
      form([{ ...OWN, customerPartNumber: 'MINE' }], { newLineIndex: 0, parts: BOND }),
    );

    expect(typed?.customerPartNumber).toBe('MINE');
    expect(typed?.customerDescription).toBeUndefined();
    expect(typed?.feetPerRollOverride).toBe('1480.0000');
  });

  it('lets a length typed with Custom length chosen win over the part', () => {
    const [line] = collect(
      form([{ ...OWN, lengthChoice: 'custom', feetPerRollOverride: '2215' }], {
        newLineIndex: 0,
        parts: BOND,
      }),
    );
    expect(line?.feetPerRollOverride).toBe('2215');
  });

  it('fills nothing when Custom length is chosen with its box blank, as before', () => {
    const [line] = collect(
      form([{ ...OWN, lengthChoice: 'custom' }], { newLineIndex: 0, parts: BOND }),
    );
    expect(Object.hasOwn(line ?? {}, 'feetPerRollOverride')).toBe(false);
  });

  it('never fills a stored line, so one set back to the paper own keeps the paper own', () => {
    const lines = collect(form([OWN, OWN], { newLineIndex: 1, parts: BOND }));
    expect(Object.hasOwn(lines[0] ?? {}, 'feetPerRollOverride')).toBe(false);
    expect(lines[1]?.feetPerRollOverride).toBe('1480.0000');
  });

  it('fills nothing on a row that posts no Length per roll select', () => {
    const closed = Object.fromEntries(
      Object.entries(OWN).filter(([field]) => field !== 'lengthChoice'),
    );
    const [line] = collect(form([closed], { newLineIndex: 0, parts: BOND }));
    expect(Object.hasOwn(line ?? {}, 'feetPerRollOverride')).toBe(false);
  });

  it('fills nothing at a width with no part, from a part with no length, or on another paper', () => {
    for (const row of [
      { ...OWN, rollWidthIn: '12' },
      { ...OWN, rollWidthIn: '9.75' },
      { ...OWN, paper: `${OTHER_GRADE_ID}:long` },
    ]) {
      const [line] = collect(form([row], { newLineIndex: 0, parts: BOND }));
      expect(Object.hasOwn(line ?? {}, 'feetPerRollOverride'), JSON.stringify(row)).toBe(false);
    }
  });

  it('drops a part with a malformed length whole, fills nothing, and still saves', () => {
    for (const feetPerRoll of ['0', '-1480', 'long', 1480]) {
      const data = form([OWN], { newLineIndex: 0 });
      data.set(CUSTOMER_PARTS_FIELD, JSON.stringify([{ ...BOND[0], feetPerRoll }]));
      expect(readCustomerParts(data), String(feetPerRoll)).toEqual([]);
      const [line] = collect(data);
      expect(Object.hasOwn(line ?? {}, 'feetPerRollOverride')).toBe(false);
      expect(line?.customerPartNumber).toBeUndefined();
    }
  });

  it('stores nothing on a refused save, and fills when the same new line is saved again', () => {
    const stored = { ...ROW, quantityRolls: '' };
    expect(collectLines(form([stored, OWN], { newLineIndex: 1, parts: BOND }))).toMatchObject({
      ok: false,
    });

    const lines = collect(form([ROW, OWN], { newLineIndex: 1, parts: BOND }));
    expect(lines[1]?.feetPerRollOverride).toBe('1480.0000');
  });

  it('still drops an untouched new row when the customer has a part with a length', () => {
    const untouched = {
      paper: `${GRADE_ID}:long`,
      rollWidthIn: '',
      quantityRolls: '',
      lengthChoice: 'own',
      feetPerRollOverride: '',
      pricingBasis: 'per_roll',
      freightMode: 'pickup',
      revenueCategory: 'print',
      taxStatus: 'id_tax',
      taxJurisdiction: 'ID',
    };
    expect(collect(form([ROW, untouched], { newLineIndex: 1, parts: BOND }))).toHaveLength(1);
  });
});

describe('an untouched new line the customer seeded', () => {
  const untouched = {
    paper: `${GRADE_ID}:long`,
    rollWidthIn: '',
    quantityRolls: '',
    pricingBasis: 'per_pound',
    freightMode: 'carrier',
    revenueCategory: 'print',
    taxStatus: 'id_tax',
    taxJurisdiction: 'ID',
  };
  const seed = { [SEED_PRICING_BASIS_FIELD]: 'per_pound', [SEED_FREIGHT_MODE_FIELD]: 'carrier' };

  it('is still dropped, because its selects sit on the customer seed', () => {
    expect(collect(form([ROW, untouched], { newLineIndex: 1, seed }))).toHaveLength(1);
  });

  it('counts as started once a select moves off the seed', () => {
    const result = collectLines(
      form([ROW, { ...untouched, freightMode: 'pickup' }], { newLineIndex: 1, seed }),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it('keeps the house defaults for every other row', () => {
    const result = collectLines(form([{ ...untouched }, ROW], { newLineIndex: 1, seed }));
    expect(result).toMatchObject({ ok: false });
  });
});

describe('what a blank row starts on', () => {
  it('takes the customer pricing basis and freight mode', () => {
    const start = coreDefaults(undefined, undefined, {
      pricingBasis: 'per_pound',
      freightMode: 'carrier',
    });
    expect(start.pricingBasis).toBe('per_pound');
    expect(start.freightMode).toBe('carrier');
  });

  it('falls back to Per roll, Auto and pickup when the customer has none', () => {
    const start = coreDefaults(undefined, undefined, lineSeedOf(null, TIERS));
    expect(start.pricingBasis).toBe('per_roll');
    expect(start.tierOverrideCode).toBe('');
    expect(start.freightMode).toBe('pickup');
  });

  it('ignores the seed after a refused save, which shows what was posted', () => {
    const start = coreDefaults(
      undefined,
      { pricingBasis: 'per_roll', freightMode: 'pickup' },
      {
        pricingBasis: 'per_pound',
        freightMode: 'carrier',
      },
    );
    expect(start.pricingBasis).toBe('per_roll');
    expect(start.freightMode).toBe('pickup');
  });

  it('seeds only what the customer set', () => {
    expect(
      lineSeedOf({ customerId: 'c', parts: [], lockVersion: 1, freightMode: 'our_vehicle' }, TIERS),
    ).toEqual({
      freightMode: 'our_vehicle',
    });
  });
});

describe('the customer pricing tier', () => {
  const V2 = { customerId: 'c', parts: [], lockVersion: 1, tierCode: 'list' };
  const seed = { [SEED_TIER_CODE_FIELD]: 'list' };

  it('seeds a tier the list holds, and nothing for a code it does not', () => {
    expect(lineSeedOf(V2, TIERS)).toEqual({ tierCode: 'list' });
    expect(lineSeedOf({ ...V2, tierCode: 'retired_tier' }, TIERS)).toEqual({});
  });

  it('starts a blank row on it, with More options open and its sum naming the tier', () => {
    const start = coreDefaults(undefined, undefined, lineSeedOf(V2, TIERS));
    expect(start.tierOverrideCode).toBe('list');
    const values = { ...start, rateOverride: '', carrierBid: '', freightMargin: '' };
    expect(moreOptionsOpen(values)).toBe(true);
    expect(moreOptionsSum(values, TIERS)).toContain('List tier');
  });

  it('never moves a stored line, nor what a refused save posted', () => {
    const stored = coreDefaults(storedLine(), undefined, { tierCode: 'list' });
    expect(stored.tierOverrideCode).toBe('');
    const refused = coreDefaults(undefined, { tierOverrideCode: '' }, { tierCode: 'list' });
    expect(refused.tierOverrideCode).toBe('');
  });

  it('saves an untouched seeded line on the tier, as a tier picked by hand', () => {
    const [line] = collect(form([{ ...ROW, tierOverrideCode: 'list' }], { newLineIndex: 0, seed }));
    expect(line?.tierOverrideCode).toBe('list');
    expect(line?.marginOverridePct).toBeUndefined();
  });

  it('saves Auto, or another tier, when the rep picks it before saving', () => {
    const [auto] = collect(form([{ ...ROW, tierOverrideCode: '' }], { newLineIndex: 0, seed }));
    expect(auto?.tierOverrideCode).toBeUndefined();
    const [v3] = collect(
      form([{ ...ROW, tierOverrideCode: 'volume_3' }], { newLineIndex: 0, seed }),
    );
    expect(v3?.tierOverrideCode).toBe('volume_3');
  });

  describe('on an untouched new row', () => {
    const untouched = {
      paper: `${GRADE_ID}:long`,
      rollWidthIn: '',
      quantityRolls: '',
      tierOverrideCode: 'list',
      pricingBasis: 'per_roll',
      freightMode: 'pickup',
      revenueCategory: 'print',
      taxStatus: 'id_tax',
      taxJurisdiction: 'ID',
    };

    it('is not data, so the row is still dropped', () => {
      expect(collect(form([ROW, untouched], { newLineIndex: 1, seed }))).toHaveLength(1);
    });

    it('counts as started once the select moves off it, Auto included', () => {
      for (const tierOverrideCode of ['', 'volume_3']) {
        const result = collectLines(
          form([ROW, { ...untouched, tierOverrideCode }], { newLineIndex: 1, seed }),
        );
        expect(result, tierOverrideCode).toMatchObject({ ok: false });
      }
    });

    it('is data on every other row, as any tier was before', () => {
      const result = collectLines(form([untouched, ROW], { newLineIndex: 1, seed }));
      expect(result).toMatchObject({ ok: false });
    });
  });
});
