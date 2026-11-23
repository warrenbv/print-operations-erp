// Tests reading the quote defaults form and rebuilding it from echoed input.
import { putCustomerDefaultsRequestSchema } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { collectDefaults, defaultsFormStart, partField } from './collect-defaults';

const KRAFT = '01988a00-0583-7000-8000-000000000001';
const BUTCHER = '01988a00-0583-7000-8000-000000000002';

function formOf(top: Record<string, string>, parts: Record<string, string>[] = []): FormData {
  const form = new FormData();
  form.set('customerId', 'c-1');
  form.set('lockVersion', '0');
  form.set('pricingBasis', '');
  form.set('tierCode', '');
  form.set('freightMode', '');
  form.set('leadTimeDays', '');
  for (const [name, value] of Object.entries(top)) {
    form.set(name, value);
  }

  [...parts, {}].forEach((row, i) => {
    form.set(partField(i, 'gradeId'), row['gradeId'] ?? '');
    form.set(partField(i, 'rollWidthIn'), row['rollWidthIn'] ?? '');
    form.set(partField(i, 'partNumber'), row['partNumber'] ?? '');
    form.set(partField(i, 'description'), row['description'] ?? '');
    form.set(partField(i, 'feetPerRoll'), row['feetPerRoll'] ?? '');
    if (row['remove'] !== undefined) {
      form.set(partField(i, 'remove'), 'on');
    }
  });
  return form;
}

function collectOrThrow(form: FormData) {
  const result = collectDefaults(form);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.request;
}

describe('collectDefaults', () => {
  it('builds what the endpoint accepts', () => {
    const request = collectOrThrow(
      formOf(
        { pricingBasis: 'per_pound', freightMode: 'carrier', leadTimeDays: '10', lockVersion: '3' },
        [{ gradeId: KRAFT, rollWidthIn: '36', partNumber: 'LN-34', description: 'CEDAR CORE' }],
      ),
    );
    expect(putCustomerDefaultsRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toEqual({
      pricingBasis: 'per_pound',
      freightMode: 'carrier',
      leadTimeDays: 10,
      parts: [{ gradeId: KRAFT, rollWidthIn: 36, partNumber: 'LN-34', description: 'CEDAR CORE' }],
      lockVersion: 3,
    });
  });

  it('reads every empty box as no default, and the blank part row as nothing', () => {
    expect(collectOrThrow(formOf({}))).toEqual({ parts: [], lockVersion: 0 });
  });

  it('reads the Pricing tier select as the tier code, and refuses one that is not a code', () => {
    expect(collectOrThrow(formOf({ tierCode: 'list' })).tierCode).toBe('list');
    expect(collectOrThrow(formOf({ tierCode: '' })).tierCode).toBeUndefined();

    expect(collectDefaults(formOf({ tierCode: 'V2 List' }))).toMatchObject({
      ok: false,
      message: expect.stringContaining('Could not read the form: tierCode'),
    });
  });

  it('keeps a same-day lead time, which is not a blank one', () => {
    expect(collectOrThrow(formOf({ leadTimeDays: '0' })).leadTimeDays).toBe(0);
  });

  it('refuses a lead time that is not a whole number of days', () => {
    for (const leadTimeDays of ['7.5', '-1', '1e3', '3651']) {
      expect(collectDefaults(formOf({ leadTimeDays })), leadTimeDays).toMatchObject({
        ok: false,
        message: 'A lead time is a whole number of days, 0 to 3650.',
      });
    }
  });

  it('leaves out a part ticked Remove, which is how a part is deleted', () => {
    const request = collectOrThrow(
      formOf({}, [
        { gradeId: KRAFT, rollWidthIn: '36', partNumber: 'A', remove: 'on' },
        { gradeId: BUTCHER, rollWidthIn: '18', partNumber: 'B' },
      ]),
    );
    expect(request.parts).toEqual([{ gradeId: BUTCHER, rollWidthIn: 18, partNumber: 'B' }]);
  });

  it('names the row and the box for a part it cannot take', () => {
    expect(collectDefaults(formOf({}, [{ rollWidthIn: '36', partNumber: 'A' }]))).toMatchObject({
      ok: false,
      message: 'Part 1: pick a paper.',
    });

    expect(
      collectDefaults(formOf({}, [{ gradeId: KRAFT, rollWidthIn: '52.7', partNumber: 'A' }])),
    ).toMatchObject({
      ok: false,
      message:
        'Part 1: 52.7 is not a width. A width is whole inches or sixteenths of an inch from 1 to 1000, typed as a decimal: 11.3125 for 11 5/16.',
    });
    for (const typed of ['0', '1001', '1e3', 'wide']) {
      expect(
        collectDefaults(formOf({}, [{ gradeId: KRAFT, rollWidthIn: typed, partNumber: 'A' }])),
        typed,
      ).toMatchObject({
        ok: false,
        message: expect.stringContaining(`Part 1: ${typed} is not a width.`),
      });
    }
    expect(collectDefaults(formOf({}, [{ gradeId: KRAFT, partNumber: 'A' }]))).toMatchObject({
      ok: false,
      message: 'Part 1: enter the width, in inches.',
    });
    expect(collectDefaults(formOf({}, [{ gradeId: KRAFT, rollWidthIn: '36' }]))).toMatchObject({
      ok: false,
      message: 'Part 1: enter a part number, a description or both.',
    });
  });

  it('reads a width in sixteenths as its number', () => {
    const result = collectDefaults(
      formOf({}, [
        {
          gradeId: KRAFT,
          rollWidthIn: '9.75',
          partNumber: 'MW-20463',
          description: 'CEDAR CORE SHEET',
        },
        { gradeId: KRAFT, rollWidthIn: '11.3125', partNumber: 'MW-1175-A' },
        { gradeId: KRAFT, rollWidthIn: '4.625', partNumber: 'TQ-7-318' },
      ]),
    );
    expect(result.ok && result.request.parts.map((part) => part.rollWidthIn)).toEqual([
      9.75, 11.3125, 4.625,
    ]);
  });

  it('reads the Roll length box as feet on the part, and a blank one as none', () => {
    const request = collectOrThrow(
      formOf({}, [
        { gradeId: KRAFT, rollWidthIn: '11.3125', partNumber: 'MW-1175-A', feetPerRoll: '1480' },
        { gradeId: KRAFT, rollWidthIn: '9.75', partNumber: 'MW-20463', feetPerRoll: ' 1260.5 ' },
        { gradeId: KRAFT, rollWidthIn: '4.625', partNumber: 'TQ-7-318', feetPerRoll: '' },
      ]),
    );
    expect(putCustomerDefaultsRequestSchema.safeParse(request).success).toBe(true);
    expect(request.parts.map((part) => part.feetPerRoll)).toEqual(['1480', '1260.5', undefined]);
    expect(Object.hasOwn(request.parts[2] ?? {}, 'feetPerRoll')).toBe(false);
  });

  it('refuses a roll length that is not feet above 0, naming the part row', () => {
    for (const typed of ['0', '0.0000', '-1480', '1,480', '1480 ft', '1480.12345', '418302957']) {
      expect(
        collectDefaults(
          formOf({}, [
            { gradeId: KRAFT, rollWidthIn: '36', partNumber: 'A' },
            { gradeId: KRAFT, rollWidthIn: '48', partNumber: 'B', feetPerRoll: typed },
          ]),
        ),
        typed,
      ).toMatchObject({
        ok: false,
        message: `Part 2: Roll length must be a number of feet greater than 0, such as 1480. You entered "${typed}".`,
      });
    }
  });

  it('counts a row holding only a length as a part, and a length as no name', () => {
    expect(collectDefaults(formOf({}, [{ feetPerRoll: '1480' }]))).toMatchObject({
      ok: false,
      message: 'Part 1: pick a paper.',
    });

    expect(
      collectDefaults(formOf({}, [{ gradeId: KRAFT, rollWidthIn: '36', feetPerRoll: '1480' }])),
    ).toMatchObject({
      ok: false,
      message: 'Part 1: enter a part number, a description or both.',
    });
  });

  it('counts 9.750 and 9.75 as one width', () => {
    expect(
      collectDefaults(
        formOf({}, [
          { gradeId: KRAFT, rollWidthIn: '9.75', partNumber: 'A' },
          { gradeId: KRAFT, rollWidthIn: '9.750', partNumber: 'B' },
        ]),
      ),
    ).toMatchObject({ ok: false, message: 'Part 2: part 1 already has that paper and width.' });
  });

  it('refuses the same paper and width twice, naming both rows', () => {
    expect(
      collectDefaults(
        formOf({}, [
          { gradeId: KRAFT, rollWidthIn: '36', partNumber: 'A' },
          { gradeId: KRAFT, rollWidthIn: '36', partNumber: 'B' },
        ]),
      ),
    ).toMatchObject({ ok: false, message: 'Part 2: part 1 already has that paper and width.' });
  });

  it('refuses a form with no generation, which only a hand-made post can be', () => {
    const form = formOf({});
    form.delete('lockVersion');
    expect(collectDefaults(form)).toMatchObject({ ok: false });
  });
});

describe('defaultsFormStart', () => {
  it('starts from what is stored, then one blank row', () => {
    const start = defaultsFormStart(
      {
        pricingBasis: 'per_pound',
        tierCode: 'list',
        leadTimeDays: 0,
        parts: [
          { gradeId: KRAFT, rollWidthIn: 36, partNumber: 'A' },

          { gradeId: KRAFT, rollWidthIn: 48, partNumber: 'B', feetPerRoll: '1480.0000' },
        ],
      },
      {},
    );
    expect(start).toEqual({
      pricingBasis: 'per_pound',
      tierCode: 'list',
      freightMode: '',
      leadTimeDays: '0',
      parts: [
        {
          gradeId: KRAFT,
          rollWidthIn: '36',
          partNumber: 'A',
          description: '',
          feetPerRoll: '',
          remove: false,
        },
        {
          gradeId: KRAFT,
          rollWidthIn: '48',
          partNumber: 'B',
          description: '',
          feetPerRoll: '1480.0000',
          remove: false,
        },
        {
          gradeId: '',
          rollWidthIn: '',
          partNumber: '',
          description: '',
          feetPerRoll: '',
          remove: false,
        },
      ],
    });
  });

  it('shows what was posted after a refusal, never the stored values under it', () => {
    const start = defaultsFormStart(
      {
        pricingBasis: 'per_pound',
        tierCode: 'volume_3',
        leadTimeDays: 5,
        parts: [{ gradeId: KRAFT, rollWidthIn: 36, partNumber: 'A', feetPerRoll: '1480.0000' }],
      },
      {
        freightMode: 'carrier',
        tierCode: 'list',
        [partField(0, 'gradeId')]: KRAFT,
        [partField(0, 'rollWidthIn')]: '36',
        [partField(0, 'remove')]: 'on',
        [partField(1, 'gradeId')]: BUTCHER,
        [partField(1, 'rollWidthIn')]: '18',

        [partField(1, 'feetPerRoll')]: '0',
      },
    );

    expect(start.pricingBasis).toBe('');
    expect(start.leadTimeDays).toBe('');
    expect(start.freightMode).toBe('carrier');
    expect(start.tierCode).toBe('list');
    expect(start.parts).toEqual([
      {
        gradeId: KRAFT,
        rollWidthIn: '36',
        partNumber: '',
        description: '',
        feetPerRoll: '',
        remove: true,
      },
      {
        gradeId: BUTCHER,
        rollWidthIn: '18',
        partNumber: '',
        description: '',
        feetPerRoll: '0',
        remove: false,
      },
      {
        gradeId: '',
        rollWidthIn: '',
        partNumber: '',
        description: '',
        feetPerRoll: '',
        remove: false,
      },
    ]);
  });
});
