// Tests the custom width and length defaults and the CSS that reveals their boxes.
import type { Grade, QuoteLine } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { CUSTOM_WIDTH_REVEAL_CSS, customLengthChosen, customWidthDefaults } from './custom-width';

const GRADE = {
  id: 'grade-1',
  widths: [
    { rollWidthIn: 12, rollsPerPallet: 75 },
    { rollWidthIn: 24, rollsPerPallet: 50 },
  ],
} as unknown as Grade;

const storedLine = (over: Partial<QuoteLine>): QuoteLine =>
  ({ gradeId: 'grade-1', rollWidthIn: 24, ...over }) as unknown as QuoteLine;

describe('customWidthDefaults', () => {
  it('starts a blank row unticked', () => {
    expect(customWidthDefaults(undefined, undefined, GRADE)).toEqual({
      customWidth: false,
      customWidthIn: '',
    });
  });

  it('leaves a stored stock width unticked', () => {
    expect(customWidthDefaults(storedLine({}), undefined, GRADE)).toEqual({
      customWidth: false,
      customWidthIn: '',
    });
  });

  it('ticks a line saved as a custom width, with its width in the box', () => {
    expect(
      customWidthDefaults(storedLine({ rollWidthIn: 17, customWidth: true }), undefined, GRADE),
    ).toEqual({ customWidth: true, customWidthIn: '17' });
  });

  it('ticks a stored width its paper no longer stocks, so a re-save is not refused', () => {
    expect(customWidthDefaults(storedLine({ rollWidthIn: 30 }), undefined, GRADE)).toEqual({
      customWidth: true,
      customWidthIn: '30',
    });
  });

  it('shows what a refused save posted, over the stored line', () => {
    expect(
      customWidthDefaults(
        storedLine({ rollWidthIn: 17, customWidth: true }),
        { customWidthIn: '19' },
        GRADE,
      ),
    ).toEqual({ customWidth: false, customWidthIn: '19' });
  });

  it('leaves a stored stock width in sixteenths unticked', () => {
    const grade = {
      id: 'grade-1',
      widths: [{ rollWidthIn: 11.3125, rollsPerPallet: null }],
    } as unknown as Grade;
    expect(customWidthDefaults(storedLine({ rollWidthIn: 11.3125 }), undefined, grade)).toEqual({
      customWidth: false,
      customWidthIn: '',
    });
  });

  it('reads "Custom width" chosen in a refused save’s width select as custom', () => {
    expect(
      customWidthDefaults(storedLine({}), { rollWidthIn: 'custom', customWidthIn: '' }, GRADE),
    ).toEqual({ customWidth: true, customWidthIn: '' });
  });
});

describe('customLengthChosen', () => {
  it('starts on Custom length when the line holds an override, and on the paper’s own otherwise', () => {
    expect(customLengthChosen(undefined, '900')).toBe(true);
    expect(customLengthChosen(undefined, '')).toBe(false);
  });

  it('shows what a refused save posted, over the stored override', () => {
    expect(customLengthChosen({ lengthChoice: 'own' }, '900')).toBe(false);
    expect(customLengthChosen({ lengthChoice: 'custom' }, '')).toBe(true);
  });
});

describe('CUSTOM_WIDTH_REVEAL_CSS', () => {
  it('hides each box only while its option is not chosen, so it fails visible', () => {
    expect(CUSTOM_WIDTH_REVEAL_CSS).toContain(
      '.line-width:not(:has(option[value="custom"]:checked)) .custom-width-box',
    );
    expect(CUSTOM_WIDTH_REVEAL_CSS).toContain(
      '.line-length:not(:has(option[value="custom"]:checked)) .custom-length-box',
    );
    expect(CUSTOM_WIDTH_REVEAL_CSS).toContain('display: none;');
  });
});
