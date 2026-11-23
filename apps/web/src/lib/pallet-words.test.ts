// Tests the pallet and footage wording.
import { describe, expect, it } from 'vitest';

import { palletsText } from '@erp/types';

import { footageUsed, palletSentence } from './pallet-words';

describe('the pallet count, where a count of pallets prints', () => {
  it('reads the count with its plural', () => {
    expect(palletsText(1)).toBe('1 pallet');
    expect(palletsText(3)).toBe('3 pallets');
    expect(palletsText(0)).toBe('0 pallets');
  });

  it('says pallets not counted for a line with no count', () => {
    expect(palletsText(null)).toBe('pallets not counted');
  });
});

describe('palletSentence (the Lines step summary)', () => {
  it('is its own sentence', () => {
    expect(palletSentence(1)).toBe('1 pallet.');
    expect(palletSentence(28)).toBe('28 pallets.');
    expect(palletSentence(null)).toBe('Pallets not counted.');
  });
});

describe('footageUsed (the approvals card)', () => {
  it('reads the footage and the rolls per pallet', () => {
    expect(footageUsed('1650.0000', 50)).toBe('1,650 ft · 50 / pallet');
    expect(footageUsed('1650.0000', null)).toBe('1,650 ft · rolls per pallet not counted');
  });
});
