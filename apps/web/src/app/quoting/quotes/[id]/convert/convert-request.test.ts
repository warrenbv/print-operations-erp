// Tests turning the convert grid into order requests, and each refusal it can give.
import { describe, expect, it } from 'vitest';

import type { Boxes, GridLine } from './convert-grid';
import {
  sameDateRefusal,
  toConvertPress,
  toConvertRequest,
  type ConvertFormValues,
  type ConvertPressValues,
} from './convert-request';

const QUOTE_ID = '01988a00-0100-7000-8000-000000000001';
const LINE_1 = '01988a00-0300-7000-8000-000000000001';
const LINE_2 = '01988a00-0300-7000-8000-000000000002';
const LINE_3 = '01988a00-0300-7000-8000-000000000003';

const row = (quoteLineId: string, lineNumber: number, perPound = false): GridLine => ({
  quoteLineId,
  lineNumber,
  perPound,
  quotedRolls: 10,
  quotedPounds: perPound ? '1000.0000' : undefined,
  soFar: undefined,
});

const LINES = [row(LINE_1, 1), row(LINE_2, 2, true), row(LINE_3, 3)];

function form(
  boxes: Readonly<Record<string, Partial<Boxes>>>,
  extra: Partial<ConvertFormValues> = {},
): ConvertFormValues {
  return {
    quoteId: QUOTE_ID,
    lines: LINES,
    boxes: (line) => ({
      rolls: boxes[line.quoteLineId]?.rolls ?? '',
      pounds: boxes[line.quoteLineId]?.pounds ?? '',
    }),
    ...extra,
  };
}

describe('toConvertRequest', () => {
  it('sends each line with a quantity, its pounds on a per-pound line, in line order', () => {
    expect(
      toConvertRequest(
        form({
          [LINE_3]: { rolls: '8' },
          [LINE_1]: { rolls: '5' },
          [LINE_2]: { rolls: '10', pounds: '1000' },
        }),
      ),
    ).toEqual({
      ok: true,
      request: {
        quoteId: QUOTE_ID,
        lines: [
          { quoteLineId: LINE_1, quantityRolls: 5 },
          { quoteLineId: LINE_2, quantityRolls: 10, orderedWeightLb: '1000' },
          { quoteLineId: LINE_3, quantityRolls: 8 },
        ],
      },
    });
  });

  it('leaves off a line whose Rolls box is empty or 0, its pounds box ignored', () => {
    const outcome = toConvertRequest(
      form({
        [LINE_1]: { rolls: '' },
        [LINE_2]: { rolls: '0', pounds: '500' },
        [LINE_3]: { rolls: ' 4 ' },
      }),
    );
    expect(outcome.ok && outcome.request.lines).toEqual([
      { quoteLineId: LINE_3, quantityRolls: 4 },
    ]);
  });

  it('refuses a press with no line on the order', () => {
    expect(toConvertRequest(form({ [LINE_1]: { rolls: '0' } }))).toEqual({
      ok: false,
      message: 'Put at least one line on the order.',
    });
  });

  it('refuses a chosen per-pound line without pounds above 0, naming the line', () => {
    for (const pounds of ['', '0', 'lots', '-5']) {
      expect(toConvertRequest(form({ [LINE_2]: { rolls: '5', pounds } }))).toEqual({
        ok: false,
        message: 'Line 2 is sold by the pound: enter the pounds ordered, more than 0.',
      });
    }
  });

  it('refuses rolls that are not a whole number, naming the line', () => {
    for (const rolls of ['6.5', '-1', 'ten']) {
      expect(toConvertRequest(form({ [LINE_3]: { rolls } }))).toEqual({
        ok: false,
        message: 'Line 3: enter the rolls as a whole number, or leave the box empty.',
      });
    }
  });

  it('takes more than the quoted quantity: the quote is not a limit', () => {
    const outcome = toConvertRequest(form({ [LINE_1]: { rolls: '25' } }));
    expect(outcome.ok && outcome.request.lines).toEqual([
      { quoteLineId: LINE_1, quantityRolls: 25 },
    ]);
  });

  it('sends the PO number and the delivery date as typed', () => {
    const outcome = toConvertRequest(
      form({ [LINE_1]: { rolls: '10' } }, { poNumber: '7716402', requestedDate: '2027-06-10' }),
    );
    expect(outcome).toEqual({
      ok: true,
      request: {
        quoteId: QUOTE_ID,
        poNumber: '7716402',
        requestedDate: '2027-06-10',
        lines: [{ quoteLineId: LINE_1, quantityRolls: 10 }],
      },
    });
  });

  it('refuses a delivery date that is not a calendar date, in the words of the box', () => {
    expect(
      toConvertRequest(form({ [LINE_1]: { rolls: '10' } }, { requestedDate: '10/06/2027' })),
    ).toEqual({
      ok: false,
      message: 'Enter the delivery date as a calendar date, like 2026-09-14.',
    });
  });

  it('still refuses an over-long PO number as it did before the grid', () => {
    expect(
      toConvertRequest(form({ [LINE_1]: { rolls: '10' } }, { poNumber: 'x'.repeat(65) })),
    ).toEqual({
      ok: false,
      message: 'The PO number can be at most 64 characters.',
    });
  });
});

function press(
  dates: readonly (string | undefined)[],
  cells: readonly Readonly<Record<string, Partial<Boxes>>>[],
  extra: Partial<ConvertPressValues> = {},
): ConvertPressValues {
  return {
    quoteId: QUOTE_ID,
    columns: dates.length,
    date: (column) => dates[column - 1],
    lines: LINES,
    boxes: (line, column) => ({
      rolls: cells[column - 1]?.[line.quoteLineId]?.rolls ?? '',
      pounds: cells[column - 1]?.[line.quoteLineId]?.pounds ?? '',
    }),
    ...extra,
  };
}

describe('toConvertPress', () => {
  it('sends one delivery to POST /orders exactly as before, words and all', () => {
    expect(toConvertPress(press(['2027-06-10'], [{ [LINE_1]: { rolls: '10' } }]))).toEqual({
      ok: true,
      kind: 'one',
      request: {
        quoteId: QUOTE_ID,
        requestedDate: '2027-06-10',
        lines: [{ quoteLineId: LINE_1, quantityRolls: 10 }],
      },
    });

    expect(toConvertPress(press([undefined], [{ [LINE_1]: { rolls: '0' } }]))).toEqual({
      ok: false,
      message: 'Put at least one line on the order.',
    });
  });

  it('sends several deliveries, each its date and lines, with the one PO number', () => {
    const outcome = toConvertPress(
      press(
        ['2027-06-10', '2027-07-15'],
        [{ [LINE_1]: { rolls: '10' } }, { [LINE_2]: { rolls: '10', pounds: '1000' } }],
        { poNumber: '7716402' },
      ),
    );
    expect(outcome).toEqual({
      ok: true,
      kind: 'several',
      request: {
        quoteId: QUOTE_ID,
        poNumber: '7716402',
        deliveries: [
          { requestedDate: '2027-06-10', lines: [{ quoteLineId: LINE_1, quantityRolls: 10 }] },
          {
            requestedDate: '2027-07-15',
            lines: [{ quoteLineId: LINE_2, quantityRolls: 10, orderedWeightLb: '1000' }],
          },
        ],
      },
    });
  });

  it('names the delivery and the line of a box it cannot take', () => {
    expect(
      toConvertPress(
        press(
          ['2027-06-10', '2027-07-15'],
          [{ [LINE_1]: { rolls: '10' } }, { [LINE_2]: { rolls: '5' } }],
        ),
      ),
    ).toEqual({ ok: false, message: 'Delivery 2, line 2: enter the pounds ordered, more than 0.' });
    expect(
      toConvertPress(
        press(
          ['2027-06-10', '2027-07-15'],
          [{ [LINE_3]: { rolls: '10.5' } }, { [LINE_1]: { rolls: '1' } }],
        ),
      ),
    ).toEqual({
      ok: false,
      message: 'Delivery 1, line 3: enter the rolls as a whole number, or leave the box empty.',
    });
  });

  it('refuses a delivery with no line on it, or with no date', () => {
    expect(
      toConvertPress(press(['2027-06-10', '2027-07-15'], [{ [LINE_1]: { rolls: '10' } }, {}])),
    ).toEqual({
      ok: false,
      message: 'Delivery 2 has no lines. Put at least one line on it, or remove it.',
    });
    expect(
      toConvertPress(
        press(
          ['2027-06-10', undefined],
          [{ [LINE_1]: { rolls: '10' } }, { [LINE_3]: { rolls: '2' } }],
        ),
      ),
    ).toEqual({ ok: false, message: 'Delivery 2 needs a delivery date.' });
    expect(
      toConvertPress(
        press(
          ['10/06/2027', '2027-07-15'],
          [{ [LINE_1]: { rolls: '10' } }, { [LINE_3]: { rolls: '2' } }],
        ),
      ),
    ).toEqual({
      ok: false,
      message: 'Delivery 1: enter the delivery date as a calendar date, like 2026-09-14.',
    });
  });

  it('refuses deliveries that share a date, naming them', () => {
    expect(
      toConvertPress(
        press(
          ['2027-06-10', '2027-07-15', '2027-07-15'],
          [
            { [LINE_1]: { rolls: '1' } },
            { [LINE_1]: { rolls: '2' } },
            { [LINE_3]: { rolls: '3' } },
          ],
        ),
      ),
    ).toEqual({
      ok: false,
      message: 'Deliveries 2 and 3 have the same date. Put both on one delivery.',
    });
    expect(sameDateRefusal([1, 2, 4])).toBe(
      'Deliveries 1, 2 and 4 have the same date. Put them on one delivery.',
    );
  });

  it('still refuses an over-long PO number on a press of several', () => {
    expect(
      toConvertPress(
        press(
          ['2027-06-10', '2027-07-15'],
          [{ [LINE_1]: { rolls: '1' } }, { [LINE_3]: { rolls: '1' } }],
          {
            poNumber: 'x'.repeat(65),
          },
        ),
      ),
    ).toEqual({ ok: false, message: 'The PO number can be at most 64 characters.' });
  });
});
