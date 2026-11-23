// Tests for customer parts, agreed prices and saving a customer's defaults.
import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_PARTS_MAX,
  customerDefaultsSchema,
  customerPartSchema,
  emptyCustomerDefaults,
  partFor,
  putCustomerDefaultsRequestSchema,
  setAgreedPriceRequestSchema,
} from '../src/customer-defaults';
import { ROLL_WIDTH_REFUSAL } from '../src/roll-width';

const GRADE = '01890a5d-ac96-774b-bcce-b302099a8057';
const OTHER_GRADE = '01890a5d-ac96-774b-bcce-b302099a8058';

describe('a customer part', () => {
  it('takes a part number, a description or both', () => {
    expect(
      customerPartSchema.safeParse({ gradeId: GRADE, rollWidthIn: 36, partNumber: 'A' }).success,
    ).toBe(true);
    expect(
      customerPartSchema.safeParse({ gradeId: GRADE, rollWidthIn: 36, description: 'KRAFT' })
        .success,
    ).toBe(true);
  });

  it('refuses a part with neither name, which would fill nothing', () => {
    expect(customerPartSchema.safeParse({ gradeId: GRADE, rollWidthIn: 36 }).success).toBe(false);
  });

  it('refuses a width a quote line does not take', () => {
    for (const rollWidthIn of [0, -1, 13.3, 1001]) {
      expect(
        customerPartSchema.safeParse({ gradeId: GRADE, rollWidthIn, partNumber: 'A' }).success,
        String(rollWidthIn),
      ).toBe(false);
    }
  });

  it('takes a width in sixteenths, and refuses 13.3 with the line sentence', () => {
    for (const rollWidthIn of [9.75, 11.3125, 4.625, 12]) {
      expect(
        customerPartSchema.safeParse({ gradeId: GRADE, rollWidthIn, partNumber: 'MW-20463' })
          .success,
        String(rollWidthIn),
      ).toBe(true);
    }
    const refused = customerPartSchema.safeParse({
      gradeId: GRADE,
      rollWidthIn: 13.3,
      partNumber: 'A',
    });
    expect(refused.error?.issues[0]?.message).toBe(ROLL_WIDTH_REFUSAL);
  });

  it('refuses a grade id that is not a UUID, which the uuid column would 500 on', () => {
    expect(
      customerPartSchema.safeParse({ gradeId: 'kraft', rollWidthIn: 36, partNumber: 'A' }).success,
    ).toBe(false);
  });

  it('takes a roll length in feet, and leaves it absent when none is given', () => {
    const part = { gradeId: GRADE, rollWidthIn: 11.3125, partNumber: 'MW-1175-A' };
    expect(customerPartSchema.parse({ ...part, feetPerRoll: '1480' }).feetPerRoll).toBe('1480');
    expect(customerPartSchema.parse({ ...part, feetPerRoll: '1480.0000' }).feetPerRoll).toBe(
      '1480.0000',
    );
    expect(customerPartSchema.parse(part).feetPerRoll).toBeUndefined();
  });

  it('refuses a roll length that is not more than 0, or past the column', () => {
    const part = { gradeId: GRADE, rollWidthIn: 36, partNumber: 'A' };
    for (const feetPerRoll of ['0', '0.0000', '-1480', 'abc', '', '1480.12345', '100000000']) {
      expect(
        customerPartSchema.safeParse({ ...part, feetPerRoll }).success,
        JSON.stringify(feetPerRoll),
      ).toBe(false);
    }

    expect(
      customerPartSchema.safeParse({ gradeId: GRADE, rollWidthIn: 36, feetPerRoll: '1480' })
        .success,
    ).toBe(false);
  });
});

describe('saving the defaults', () => {
  it('reads an absent field as no default and an absent part list as none', () => {
    const parsed = putCustomerDefaultsRequestSchema.parse({ lockVersion: 0 });
    expect(parsed.parts).toEqual([]);
    expect(parsed.pricingBasis).toBeUndefined();
    expect(parsed.tierCode).toBeUndefined();
    expect(parsed.freightMode).toBeUndefined();
    expect(parsed.leadTimeDays).toBeUndefined();
  });

  it('takes a tier by its code, and reads it back off the defaults', () => {
    expect(
      putCustomerDefaultsRequestSchema.parse({ tierCode: 'list', lockVersion: 0 }).tierCode,
    ).toBe('list');
    expect(
      customerDefaultsSchema.parse({
        customerId: 'c-1',
        tierCode: 'list',
        parts: [],
        lockVersion: 1,
      }).tierCode,
    ).toBe('list');
  });

  it('refuses a tier named any other way than by its code', () => {
    for (const tierCode of ['', 'V2', 'v2 list', '2v', 'entered-margin', 'v'.repeat(33)]) {
      expect(
        putCustomerDefaultsRequestSchema.safeParse({ tierCode, lockVersion: 0 }).success,
        JSON.stringify(tierCode),
      ).toBe(false);
    }
  });

  it('takes every freight mode and both pricing bases', () => {
    for (const freightMode of ['pickup', 'our_vehicle', 'pass_through', 'carrier']) {
      expect(
        putCustomerDefaultsRequestSchema.safeParse({ freightMode, lockVersion: 0 }).success,
      ).toBe(true);
    }
    for (const pricingBasis of ['per_roll', 'per_pound']) {
      expect(
        putCustomerDefaultsRequestSchema.safeParse({ pricingBasis, lockVersion: 0 }).success,
      ).toBe(true);
    }
  });

  it('takes a same-day lead time and refuses more than a decade', () => {
    expect(
      putCustomerDefaultsRequestSchema.safeParse({ leadTimeDays: 0, lockVersion: 0 }).success,
    ).toBe(true);
    expect(
      putCustomerDefaultsRequestSchema.safeParse({ leadTimeDays: 3651, lockVersion: 0 }).success,
    ).toBe(false);
  });

  it('requires the generation, so a forgotten token fails rather than wins', () => {
    expect(putCustomerDefaultsRequestSchema.safeParse({}).success).toBe(false);
  });

  it('refuses the same paper and width twice, naming the second row', () => {
    const result = putCustomerDefaultsRequestSchema.safeParse({
      lockVersion: 1,
      parts: [
        { gradeId: GRADE, rollWidthIn: 36, partNumber: 'A' },
        { gradeId: GRADE.toUpperCase(), rollWidthIn: 36, partNumber: 'B' },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['parts', 1, 'rollWidthIn']);
  });

  it('takes one paper at two widths, and two papers at one width', () => {
    expect(
      putCustomerDefaultsRequestSchema.safeParse({
        lockVersion: 1,
        parts: [
          { gradeId: GRADE, rollWidthIn: 36, partNumber: 'A' },
          { gradeId: GRADE, rollWidthIn: 48, partNumber: 'B' },
          { gradeId: OTHER_GRADE, rollWidthIn: 36, partNumber: 'C' },
        ],
      }).success,
    ).toBe(true);
  });

  it('caps the list', () => {
    const parts = Array.from({ length: CUSTOMER_PARTS_MAX + 1 }, (_, i) => ({
      gradeId: GRADE,
      rollWidthIn: i + 1,
      partNumber: 'A',
    }));
    expect(putCustomerDefaultsRequestSchema.safeParse({ lockVersion: 0, parts }).success).toBe(
      false,
    );
  });
});

describe('an agreed price on a part', () => {
  const part = { gradeId: GRADE, rollWidthIn: 12, partNumber: 'TEST-12' };
  const agreed = {
    basis: 'per_pound',
    price: '0.6900',
    setBy: 'dev-billing',
    setAt: '2026-11-16T17:00:00.000Z',
  };

  it('reads off a stored part, and is absent on a part with none', () => {
    const read = customerDefaultsSchema.parse({
      customerId: 'c-1',
      parts: [
        { ...part, agreedPrice: agreed },
        { ...part, rollWidthIn: 24 },
      ],
      lockVersion: 2,
    });
    expect(read.parts[0]?.agreedPrice).toEqual(agreed);
    expect(read.parts[1]?.agreedPrice).toBeUndefined();
  });

  it('cannot ride on a Quote defaults save: the PUT part schema strips it', () => {
    const parsed = putCustomerDefaultsRequestSchema.parse({
      lockVersion: 1,
      parts: [{ ...part, agreedPrice: agreed }],
    });
    expect(parsed.parts[0]).toEqual(part);
    expect('agreedPrice' in (parsed.parts[0] ?? {})).toBe(false);
  });

  it('is set by paper, width, basis, a figure above 0 and the generation', () => {
    const request = {
      gradeId: GRADE,
      rollWidthIn: 12,
      agreedPrice: { basis: 'per_roll', price: '31.60' },
      lockVersion: 3,
    };
    expect(setAgreedPriceRequestSchema.parse(request)).toEqual(request);

    expect(setAgreedPriceRequestSchema.safeParse({ ...request, agreedPrice: null }).success).toBe(
      true,
    );
  });

  it('refuses a figure of 0, a negative, five places, a basis that is not one, no token', () => {
    const base = { gradeId: GRADE, rollWidthIn: 12, lockVersion: 3 };
    for (const price of ['0', '0.0000', '-1.00', '0.69001', 'abc', '']) {
      expect(
        setAgreedPriceRequestSchema.safeParse({
          ...base,
          agreedPrice: { basis: 'per_pound', price },
        }).success,
        JSON.stringify(price),
      ).toBe(false);
    }
    expect(
      setAgreedPriceRequestSchema.safeParse({
        ...base,
        agreedPrice: { basis: 'per_ton', price: '1.00' },
      }).success,
    ).toBe(false);
    expect(
      setAgreedPriceRequestSchema.safeParse({
        gradeId: GRADE,
        rollWidthIn: 12,
        agreedPrice: null,
      }).success,
    ).toBe(false);
  });

  it('is found by partFor with the rest of the part', () => {
    const parts = [{ ...part, agreedPrice: agreed }];
    expect(partFor(parts, GRADE.toUpperCase(), 12)?.agreedPrice).toEqual(agreed);
    expect(partFor(parts, GRADE, 12.8125)).toBeUndefined();
  });
});

describe('an account with no defaults', () => {
  it('reads as nothing set, no parts, generation 0', () => {
    const empty = emptyCustomerDefaults('c-1');
    expect(customerDefaultsSchema.parse(empty)).toEqual({
      customerId: 'c-1',
      parts: [],
      lockVersion: 0,
    });
  });
});

describe('partFor', () => {
  const parts = [
    { gradeId: GRADE, rollWidthIn: 36, partNumber: 'LN-34', description: 'CEDAR CORE' },
    { gradeId: GRADE, rollWidthIn: 48, partNumber: 'LN-45' },
  ];

  it('matches on the paper and the width together', () => {
    expect(partFor(parts, GRADE, 36)).toMatchObject({ partNumber: 'LN-34' });
    expect(partFor(parts, GRADE, 48)).toMatchObject({ partNumber: 'LN-45' });
  });

  it('matches whatever case the grade id arrives in', () => {
    expect(partFor(parts, GRADE.toUpperCase(), 36)).toMatchObject({ partNumber: 'LN-34' });
  });

  it('finds nothing at another width or on another paper', () => {
    expect(partFor(parts, GRADE, 40)).toBeUndefined();
    expect(partFor(parts, OTHER_GRADE, 36)).toBeUndefined();
  });

  it('matches a width in sixteenths as the number it is', () => {
    const wrap = [
      {
        gradeId: GRADE,
        rollWidthIn: 9.75,
        partNumber: 'MW-20463',
        description: 'CEDAR CORE SHEET',
      },
      { gradeId: GRADE, rollWidthIn: 11.3125, partNumber: 'MW-1175-A' },
    ];
    expect(partFor(wrap, GRADE, 9.75)).toMatchObject({
      partNumber: 'MW-20463',
      description: 'CEDAR CORE SHEET',
    });
    expect(partFor(wrap, GRADE, 11.3125)).toMatchObject({ partNumber: 'MW-1175-A' });
    expect(partFor(wrap, GRADE, 9)).toBeUndefined();
    expect(partFor(wrap, GRADE, 11)).toBeUndefined();
  });

  it('returns the part with its roll length, or without one when it has none', () => {
    const bond = [
      { gradeId: GRADE, rollWidthIn: 11.3125, partNumber: 'MW-1175-A', feetPerRoll: '1480.0000' },
      { gradeId: GRADE, rollWidthIn: 9.75, partNumber: 'MW-20463' },
    ];
    expect(partFor(bond, GRADE, 11.3125)).toMatchObject({ feetPerRoll: '1480.0000' });
    expect(partFor(bond, GRADE, 9.75)?.feetPerRoll).toBeUndefined();
  });
});
