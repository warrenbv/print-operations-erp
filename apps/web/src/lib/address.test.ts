// Tests the one-line address text and the no-destination wording in apps/web/src/lib/address.ts.
import { addressLines as sharedAddressLines } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { NO_DELIVERY_DESTINATION, addressLines, addressText } from './address';

const WHOLE = {
  name: 'Receiving',
  line1: '500 Sample Road',
  line2: 'Dock 3',
  city: 'Sample Harbor',
  state: 'WA' as const,
  postalCode: '98000-4417',
};

const BARE = {
  line1: '700 Demo Way',
  city: 'Example City',
  state: 'ID' as const,
  postalCode: '83010',
};

describe('addressLines', () => {
  it('is the one in @erp/types, not a second copy', () => {
    expect(addressLines).toBe(sharedAddressLines);
  });

  it('puts city, state and ZIP on one line, the way an envelope is written', () => {
    expect(addressLines(WHOLE)).toEqual([
      'Receiving',
      '500 Sample Road',
      'Dock 3',
      'Sample Harbor, WA 98000-4417',
    ]);
  });

  it('drops the optional parts instead of leaving gaps for them', () => {
    expect(addressLines(BARE)).toEqual(['700 Demo Way', 'Example City, ID 83010']);
  });

  it('never returns an empty line, whatever is absent', () => {
    for (const address of [WHOLE, BARE, { ...WHOLE, name: undefined }]) {
      expect(addressLines(address).filter((line) => line.trim() === '')).toEqual([]);
    }
  });
});

describe('addressText', () => {
  it('joins the same lines into one', () => {
    expect(addressText(WHOLE)).toBe(
      'Receiving, 500 Sample Road, Dock 3, Sample Harbor, WA 98000-4417',
    );
  });

  it('is exactly the lines joined, never a second way of writing them', () => {
    for (const address of [WHOLE, BARE]) {
      expect(addressText(address)).toBe(addressLines(address).join(', '));
    }
  });
});

describe('NO_DELIVERY_DESTINATION', () => {
  it('says a line was quoted for collection rather than leaving a blank', () => {
    expect(NO_DELIVERY_DESTINATION).toBe('no delivery destination, quoted for collection');
  });
});
