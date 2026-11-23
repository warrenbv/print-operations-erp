// Tests reading the grade form's width rows and the text each width is listed with.
import { describe, expect, it } from 'vitest';

import { collectWidths, widthListText } from './collect-widths';

function formOf(rows: Record<string, string>[]): FormData {
  const form = new FormData();
  rows.forEach((row, i) => {
    for (const [field, value] of Object.entries(row)) {
      form.set(`widths[${i}].${field}`, value);
    }
  });
  return form;
}

describe('collectWidths', () => {
  it('reads each filled row as a whole-number width and rolls per pallet', () => {
    expect(
      collectWidths(
        formOf([
          { rollWidthIn: '12', rollsPerPallet: '75' },
          { rollWidthIn: '24', rollsPerPallet: '50' },
          { rollWidthIn: '', rollsPerPallet: '' },
        ]),
      ),
    ).toEqual({
      ok: true,
      rows: [
        { rollWidthIn: 12, rollsPerPallet: 75 },
        { rollWidthIn: 24, rollsPerPallet: 50 },
      ],
    });
  });

  it('drops a row whose remove box is ticked', () => {
    expect(
      collectWidths(
        formOf([
          { rollWidthIn: '12', rollsPerPallet: '75', remove: 'on' },
          { rollWidthIn: '24', rollsPerPallet: '50' },
        ]),
      ),
    ).toEqual({ ok: true, rows: [{ rollWidthIn: 24, rollsPerPallet: 50 }] });
  });

  it('reads a width with its count left blank as not counted', () => {
    expect(
      collectWidths(
        formOf([
          { rollWidthIn: '9', rollsPerPallet: '' },
          { rollWidthIn: '24', rollsPerPallet: '50' },
        ]),
      ),
    ).toEqual({
      ok: true,
      rows: [
        { rollWidthIn: 9, rollsPerPallet: null },
        { rollWidthIn: 24, rollsPerPallet: 50 },
      ],
    });
  });

  it('names a row with a count and no width rather than dropping it', () => {
    expect(collectWidths(formOf([{ rollWidthIn: '', rollsPerPallet: '60' }]))).toEqual({
      ok: false,
      message:
        'width row 1 is missing the width — fill the row in, or clear both of its boxes to drop the width.',
    });
  });

  it('refuses an out-of-range figure, or a count that is not whole, naming the row', () => {
    for (const row of [
      { rollWidthIn: '21.6', rollsPerPallet: '60' },
      { rollWidthIn: '0', rollsPerPallet: '60' },
      { rollWidthIn: '17', rollsPerPallet: '10001' },
      { rollWidthIn: '17', rollsPerPallet: '0' },
      { rollWidthIn: '17', rollsPerPallet: '-5' },
      { rollWidthIn: '17', rollsPerPallet: '4.5' },
      { rollWidthIn: '19.4', rollsPerPallet: '' },
    ]) {
      expect(collectWidths(formOf([row]))).toMatchObject({ ok: false });
    }
    expect(collectWidths(formOf([{ rollWidthIn: '17', rollsPerPallet: '0' }]))).toEqual({
      ok: false,
      message:
        'width row 1 — the rolls per pallet is a whole number from 1 to 10000, or blank until counted.',
    });
  });

  it('reads a width in sixteenths, typed as a decimal', () => {
    expect(
      collectWidths(
        formOf([
          { rollWidthIn: '11.3125', rollsPerPallet: '' },
          { rollWidthIn: '9.75', rollsPerPallet: '' },
          { rollWidthIn: '4.625', rollsPerPallet: '' },
        ]),
      ),
    ).toEqual({
      ok: true,
      rows: [
        { rollWidthIn: 11.3125, rollsPerPallet: null },
        { rollWidthIn: 9.75, rollsPerPallet: null },
        { rollWidthIn: 4.625, rollsPerPallet: null },
      ],
    });
  });

  it('refuses a width that is not a sixteenth with the figure named', () => {
    expect(
      collectWidths(
        formOf([
          { rollWidthIn: '24', rollsPerPallet: '50' },
          { rollWidthIn: '19.4', rollsPerPallet: '' },
        ]),
      ),
    ).toEqual({
      ok: false,
      message:
        'width row 2: 19.4 is not a width. A width is whole inches or sixteenths of an inch from 1 to 1000, typed as a decimal: 11.3125 for 11 5/16.',
    });
  });

  it('reads a form with no rows as no widths', () => {
    expect(collectWidths(new FormData())).toEqual({ ok: true, rows: [] });
  });
});

describe('widthListText', () => {
  it('lists a counted width with its count, and an uncounted one as not counted', () => {
    expect(widthListText({ rollWidthIn: 24, rollsPerPallet: 50 })).toBe('24" (50 a pallet)');
    expect(widthListText({ rollWidthIn: 9, rollsPerPallet: null })).toBe('9" (not counted)');
  });

  it('lists a width in sixteenths as its fraction', () => {
    expect(widthListText({ rollWidthIn: 4.625, rollsPerPallet: null })).toBe(
      '4 5/8" (not counted)',
    );
    expect(widthListText({ rollWidthIn: 11.3125, rollsPerPallet: 40 })).toBe(
      '11 5/16" (40 a pallet)',
    );
  });
});
