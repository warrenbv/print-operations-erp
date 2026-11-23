// Tests the Our figures fold's summary, tier wording and pallet wording.
import { describe, expect, it } from 'vitest';

import type { QuoteLine } from '@erp/types';

import { marginShare, ourFiguresSum, palletWords, tierWords } from './our-figures';

type Line = Pick<QuoteLine, 'lineNumber' | 'tier' | 'pallets'>;
const line = (lineNumber: number, name: string, pallets: number | null = 1): Line =>
  ({ lineNumber, tier: { name }, pallets }) as Line;

describe('ourFiguresSum', () => {
  it('reads cost, margin with its share, and the estimated pounds', () => {
    expect(
      ourFiguresSum({
        extendedPrice: '1312.60',
        extendedCost: '1000.00',
        extendedMargin: '312.60',
        estimatedWeightLb: '815',
      }),
    ).toBe('cost $1,000.00 · margin $312.60 (23.8%) · 815.00 lb');
  });

  it('leaves the share out of a quote with no price yet', () => {
    expect(marginShare({ extendedPrice: '0.00', extendedMargin: '0.00' })).toBe('');
  });
});

describe('tierWords', () => {
  it('says the tier once when every line shares it', () => {
    expect(tierWords([line(1, 'Wholesale')])).toBe('Wholesale tier');
    expect(tierWords([line(1, 'Wholesale'), line(2, 'Wholesale')])).toBe(
      'Wholesale tier on both lines',
    );
    expect(tierWords([line(1, 'V5'), line(2, 'V5'), line(3, 'V5')])).toBe('V5 tier on all lines');
  });

  it('names each line when they differ', () => {
    expect(tierWords([line(1, 'V5'), line(2, 'Retail')])).toBe('line 1 V5, line 2 Retail');
  });

  it('says a margin entered manually in the tier’s place', () => {
    const entered = (lineNumber: number, ratio: string) => ({
      ...line(lineNumber, 'Trade'),
      marginOverridePct: ratio,
    });
    expect(tierWords([entered(1, '0.420000')])).toBe('margin entered manually, 42%');
    expect(tierWords([entered(1, '0.420000'), entered(2, '0.420000')])).toBe(
      'margin entered manually, 42% on both lines',
    );
    expect(tierWords([line(1, 'Trade'), entered(2, '0.420000')])).toBe(
      'line 1 Trade, line 2 margin entered manually, 42%',
    );
  });
});

describe('palletWords', () => {
  it('adds every line', () => {
    expect(palletWords([line(1, 'V5', 2), line(2, 'V5', 3)])).toBe('5 pallets');
    expect(palletWords([line(1, 'V5', 1)])).toBe('1 pallet');
    expect(palletWords([])).toBe('0 pallets');
  });

  it('names the lines with no count beside the counted total', () => {
    expect(palletWords([line(1, 'V5', 2), line(2, 'Trade', null)])).toBe(
      '2 pallets, 1 line not counted',
    );
    expect(palletWords([line(1, 'V5', 3), line(2, 'Trade', null), line(3, 'Trade', null)])).toBe(
      '3 pallets, 2 lines not counted',
    );
  });

  it('says pallets not counted when no line has a count', () => {
    expect(palletWords([line(1, 'Trade', null)])).toBe('pallets not counted');
    expect(palletWords([line(1, 'Trade', null), line(2, 'Trade', null)])).toBe(
      'pallets not counted',
    );
  });
});
