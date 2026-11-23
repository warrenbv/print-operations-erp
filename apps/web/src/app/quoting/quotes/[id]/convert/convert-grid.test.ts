// Tests the convert grid: the quantities ordered so far, the starting boxes and the field names.
import { describe, expect, it } from 'vitest';

import {
  DELIVERIES_FIELD,
  boxesFor,
  convertField,
  convertPageUrl,
  deliveryCount,
  gridLines,
  isConvertField,
  maxDeliveries,
  orderedSoFar,
  overNotice,
  overWords,
  quotedPriceWords,
  startingBoxes,
  withoutDelivery,
  type GridLine,
} from './convert-grid';

const LINE_1 = '019b3c70-0e40-7000-8000-000000000001';
const LINE_2 = '019b3c70-0e40-7000-8000-000000000002';

const perRoll = (soFar?: { rolls: number; pounds: string }): GridLine => ({
  quoteLineId: LINE_1,
  lineNumber: 1,
  perPound: false,
  quotedRolls: 10,
  quotedPounds: undefined,
  soFar,
});

const perPound = (soFar?: { rolls: number; pounds: string }): GridLine => ({
  quoteLineId: LINE_2,
  lineNumber: 2,
  perPound: true,
  quotedRolls: 20,
  quotedPounds: '1000.0000',
  soFar,
});

describe('orderedSoFar', () => {
  it('sums the lines of the quote s orders by quote line, rolls and pounds', () => {
    const sums = orderedSoFar(
      [{ id: 'a' }, { id: 'b' }],
      new Map([
        ['a', [{ quoteLineId: LINE_1, quantityRolls: 5 }]],
        [
          'b',
          [
            { quoteLineId: LINE_1, quantityRolls: 2 },
            { quoteLineId: LINE_2, quantityRolls: 6, orderedWeightLb: '300.0000' },
          ],
        ],
      ]),
    );
    expect(sums.get(LINE_1)).toEqual({ rolls: 7, pounds: '0.0000' });
    expect(sums.get(LINE_2)).toEqual({ rolls: 6, pounds: '300.0000' });
  });
});

describe('gridLines', () => {
  it('draws one row per quote line in line order, with its pounds on a per-pound line', () => {
    const rows = gridLines(
      [
        {
          id: LINE_2,
          lineNumber: 2,
          pricingBasis: 'per_pound',
          quantityRolls: 20,
          orderedWeightLb: '1000.0000',
        },
        { id: LINE_1, lineNumber: 1, pricingBasis: 'per_roll', quantityRolls: 10 },
      ],
      new Map([[LINE_1, { rolls: 4, pounds: '0.0000' }]]),
    );
    expect(rows).toEqual([perRoll({ rolls: 4, pounds: '0.0000' }), perPound()]);
  });
});

describe('quotedPriceWords', () => {
  it('names a per-roll line by its price per roll, as the page always has', () => {
    expect(quotedPriceWords({ pricingBasis: 'per_roll', pricePerRoll: '15.4800' })).toBe(
      '$15.48/roll',
    );
  });

  it('names a per-pound line by its Price per Pound at four places, never per roll', () => {
    const words = quotedPriceWords({
      pricingBasis: 'per_pound',
      pricePerRoll: '27.4150',
      productPricePerLb: '0.5842',
    });
    expect(words).toBe('$0.5842 / lb');

    expect(words).not.toContain('/roll');
    expect(words).not.toContain('27.4');

    expect(
      quotedPriceWords({
        pricingBasis: 'per_pound',
        pricePerRoll: '33.0000',
        productPricePerLb: '0.4700',
      }),
    ).toBe('$0.4700 / lb');
  });
});

describe('startingBoxes', () => {
  it('starts at the quoted quantity when nothing is ordered yet', () => {
    expect(startingBoxes(perRoll())).toEqual({ rolls: '10', pounds: '' });
    expect(startingBoxes(perPound())).toEqual({ rolls: '20', pounds: '1000' });
  });

  it('starts at what is left once orders hold some of the line', () => {
    expect(startingBoxes(perRoll({ rolls: 4, pounds: '0.0000' }))).toEqual({
      rolls: '6',
      pounds: '',
    });
    expect(startingBoxes(perPound({ rolls: 5, pounds: '316.5000' }))).toEqual({
      rolls: '15',
      pounds: '683.5',
    });
  });

  it('is empty when nothing is left, never below zero', () => {
    expect(startingBoxes(perRoll({ rolls: 10, pounds: '0.0000' }))).toEqual({
      rolls: '',
      pounds: '',
    });
    expect(startingBoxes(perPound({ rolls: 25, pounds: '1365.0000' }))).toEqual({
      rolls: '',
      pounds: '',
    });
  });
});

describe('boxesFor', () => {
  it('reads the record on an ordinary load', () => {
    expect(boxesFor(perRoll(), {}, false)).toEqual({ rolls: '10', pounds: '' });
  });

  it('reads the echo after a refused press, and a box missing from it stays empty', () => {
    expect(boxesFor(perRoll(), { [`rolls.${LINE_2}`]: '3' }, true)).toEqual({
      rolls: '',
      pounds: '',
    });
    expect(boxesFor(perPound(), { [`rolls.${LINE_2}`]: '3' }, true)).toEqual({
      rolls: '3',
      pounds: '',
    });
  });
});

describe('isConvertField', () => {
  it('echoes the boxes, the PO number, the date and the quote id, and nothing else', () => {
    for (const name of [
      'quoteId',
      'poNumber',
      'requestedDate',
      `rolls.${LINE_1}`,
      `pounds.${LINE_2}`,
    ]) {
      expect(isConvertField(name), name).toBe(true);
    }
    expect(isConvertField('submissionToken')).toBe(false);
  });
});

describe('overWords', () => {
  it('says nothing at or under the quoted quantity', () => {
    expect(overWords(perRoll(), [{ rolls: '10', pounds: '' }])).toBeUndefined();
    expect(
      overWords(perRoll({ rolls: 4, pounds: '0.0000' }), [{ rolls: '6', pounds: '' }]),
    ).toBeUndefined();
  });

  it('counts what is ordered so far with the box, in rolls', () => {
    expect(overWords(perRoll({ rolls: 10, pounds: '0.0000' }), [{ rolls: '5', pounds: '' }])).toBe(
      '5 rolls over the quoted quantity',
    );
    expect(overWords(perRoll(), [{ rolls: '11', pounds: '' }])).toBe(
      '1 roll over the quoted quantity',
    );
  });

  it('says it on the first load when the line is already over, with its box empty', () => {
    expect(overWords(perRoll({ rolls: 12, pounds: '0.0000' }), [{ rolls: '', pounds: '' }])).toBe(
      '2 rolls over the quoted quantity',
    );
  });

  it('says the pounds on a per-pound line, alone or with the rolls', () => {
    expect(overWords(perPound(), [{ rolls: '20', pounds: '1064' }])).toBe(
      '64 lb over the quoted quantity',
    );
    expect(overWords(perPound(), [{ rolls: '25', pounds: '1064.5' }])).toBe(
      '5 rolls and 64.5 lb over the quoted quantity',
    );
  });

  it('says nothing of a box that does not hold a figure', () => {
    expect(overWords(perRoll(), [{ rolls: 'lots', pounds: '' }])).toBeUndefined();
  });
});

describe('overNotice', () => {
  it('names each line on the order that went past the quoted quantity, one sentence each', () => {
    const lines = [perRoll({ rolls: 10, pounds: '0.0000' }), perPound()];
    expect(
      overNotice(lines, [
        { quoteLineId: LINE_1, quantityRolls: 5 },
        { quoteLineId: LINE_2, quantityRolls: 25, orderedWeightLb: '1000' },
      ]),
    ).toBe(
      'Line 1 is 5 rolls over the quoted quantity. Line 2 is 5 rolls over the quoted quantity.',
    );
  });

  it('is nothing when no line on the order went over, and ignores a line left off', () => {
    const lines = [perRoll({ rolls: 12, pounds: '0.0000' }), perPound()];
    expect(
      overNotice(lines, [{ quoteLineId: LINE_2, quantityRolls: 20, orderedWeightLb: '900' }]),
    ).toBeUndefined();
  });

  it('counts a line on several deliveries once, summed', () => {
    expect(
      overNotice(
        [perRoll(), perPound()],
        [
          { quoteLineId: LINE_1, quantityRolls: 6 },
          { quoteLineId: LINE_2, quantityRolls: 10, orderedWeightLb: '600' },
          { quoteLineId: LINE_1, quantityRolls: 6 },
          { quoteLineId: LINE_2, quantityRolls: 10, orderedWeightLb: '400' },
        ],
      ),
    ).toBe('Line 1 is 2 rolls over the quoted quantity.');
  });
});

describe('convertField and isConvertField, per delivery', () => {
  it('keeps the plain names for delivery 1 and adds the number for the rest', () => {
    expect(convertField.date()).toBe('requestedDate');
    expect(convertField.date(1)).toBe('requestedDate');
    expect(convertField.date(3)).toBe('requestedDate.3');
    expect(convertField.rolls(LINE_1)).toBe(`rolls.${LINE_1}`);
    expect(convertField.rolls(LINE_1, 2)).toBe(`rolls.${LINE_1}.2`);
    expect(convertField.pounds(LINE_2, 2)).toBe(`pounds.${LINE_2}.2`);
  });

  it('echoes every delivery s boxes and date, but not the column count', () => {
    for (const name of ['requestedDate.2', `rolls.${LINE_1}.2`, `pounds.${LINE_2}.3`]) {
      expect(isConvertField(name), name).toBe(true);
    }
    expect(isConvertField(DELIVERIES_FIELD)).toBe(false);
  });
});

describe('boxesFor, per delivery', () => {
  it('starts delivery 1 at what is left and an added delivery empty', () => {
    expect(boxesFor(perPound(), {}, false, 1)).toEqual({ rolls: '20', pounds: '1000' });
    expect(boxesFor(perPound(), {}, false, 2)).toEqual({ rolls: '', pounds: '' });
  });

  it('reads each delivery s own boxes from the echo', () => {
    const echo = {
      [`rolls.${LINE_2}`]: '5',
      [`rolls.${LINE_2}.2`]: '7',
      [`pounds.${LINE_2}.2`]: '415',
    };
    expect(boxesFor(perPound(), echo, true, 1)).toEqual({ rolls: '5', pounds: '' });
    expect(boxesFor(perPound(), echo, true, 2)).toEqual({ rolls: '7', pounds: '415' });
    expect(boxesFor(perPound(), echo, true, 3)).toEqual({ rolls: '', pounds: '' });
  });
});

describe('overWords across deliveries', () => {
  it('sums every column with what is ordered so far', () => {
    expect(
      overWords(perRoll({ rolls: 4, pounds: '0.0000' }), [
        { rolls: '4', pounds: '' },
        { rolls: '4', pounds: '' },
      ]),
    ).toBe('2 rolls over the quoted quantity');
    expect(
      overWords(perPound(), [
        { rolls: '10', pounds: '600' },
        { rolls: '10', pounds: '471.5' },
      ]),
    ).toBe('71.5 lb over the quoted quantity');
  });

  it('says nothing at the quoted quantity spread over columns, or when a box is not a figure', () => {
    expect(
      overWords(perRoll(), [
        { rolls: '5', pounds: '' },
        { rolls: '5', pounds: '' },
      ]),
    ).toBeUndefined();
    expect(
      overWords(perRoll(), [
        { rolls: '9', pounds: '' },
        { rolls: 'x', pounds: '' },
      ]),
    ).toBeUndefined();
  });
});

describe('maxDeliveries, the echo s budget with every box full', () => {
  const perRollRows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      quoteLineId: `019b3c70-0e40-7000-8000-0000000000${String(index).padStart(2, '0')}`,
      perPound: false,
    }));
  const perPoundRows = (count: number) =>
    perRollRows(count).map((row) => ({ ...row, perPound: true }));

  it('allows these many deliveries, the limits the README lists', () => {
    expect(maxDeliveries(perPoundRows(2))).toBe(13);
    expect(maxDeliveries(perPoundRows(5))).toBe(5);
    expect(maxDeliveries(perPoundRows(10))).toBe(2);
    expect(maxDeliveries(perRollRows(2))).toBe(24);
    expect(maxDeliveries(perRollRows(10))).toBe(5);
    expect(maxDeliveries(perRollRows(20))).toBe(3);
  });

  it('is never below one, so a long quote still makes one order', () => {
    expect(maxDeliveries(perPoundRows(20))).toBe(1);
    expect(maxDeliveries(perPoundRows(40))).toBe(1);
  });

  it('stops at the most one press may make', () => {
    expect(maxDeliveries([])).toBe(100);
  });
});

describe('deliveryCount', () => {
  it('reads a whole number between 1 and the most the page holds, else 1', () => {
    expect(deliveryCount('3', 13)).toBe(3);
    expect(deliveryCount('20', 13)).toBe(13);
    expect(deliveryCount('0', 13)).toBe(1);
    expect(deliveryCount('two', 13)).toBe(1);
    expect(deliveryCount(undefined, 13)).toBe(1);
    expect(deliveryCount(['2', '3'], 13)).toBe(1);
  });
});

describe('withoutDelivery', () => {
  const rows = [{ quoteLineId: LINE_1 }, { quoteLineId: LINE_2 }];
  const posted = {
    quoteId: 'q',
    poNumber: 'PO 7716402',
    requestedDate: '2027-06-10',
    [`rolls.${LINE_1}`]: '10',
    'requestedDate.2': '2027-07-15',
    [`rolls.${LINE_2}.2`]: '6',
    [`pounds.${LINE_2}.2`]: '600',
    'requestedDate.3': '2027-08-20',
    [`rolls.${LINE_1}.3`]: '1',
  };

  it('takes a middle delivery out and numbers the later ones down', () => {
    expect(withoutDelivery(posted, rows, 3, 2)).toEqual({
      quoteId: 'q',
      poNumber: 'PO 7716402',
      requestedDate: '2027-06-10',
      [`rolls.${LINE_1}`]: '10',
      'requestedDate.2': '2027-08-20',
      [`rolls.${LINE_1}.2`]: '1',
    });
  });

  it('takes delivery 1 out, and delivery 2 takes its names', () => {
    expect(withoutDelivery(posted, rows, 3, 1)).toEqual({
      quoteId: 'q',
      poNumber: 'PO 7716402',
      requestedDate: '2027-07-15',
      [`rolls.${LINE_2}`]: '6',
      [`pounds.${LINE_2}`]: '600',
      'requestedDate.2': '2027-08-20',
      [`rolls.${LINE_1}.2`]: '1',
    });
  });

  it('takes the last delivery out and leaves the rest alone', () => {
    const after = withoutDelivery(posted, rows, 3, 3);

    expect(after).not.toHaveProperty(['requestedDate.3']);
    expect(after).not.toHaveProperty([`rolls.${LINE_1}.3`]);
    expect(after[`pounds.${LINE_2}.2`]).toBe('600');
  });
});

describe('convertPageUrl', () => {
  it('draws the page again with the column count beside the echo, at the grid', () => {
    const url = convertPageUrl('q 1', 3, { 'was.poNumber': 'PO 7716402' });
    expect(url).toBe(
      '/quoting/quotes/q%201/convert?deliveries=3&was.poNumber=PO+7716402#deliveries',
    );
  });
});
