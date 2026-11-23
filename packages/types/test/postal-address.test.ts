// Tests for the postal address schema and the lines it prints as.
import { describe, expect, it } from 'vitest';

import { billingAddressSchema } from '../src/customer';
import { deliveryAddressSchema } from '../src/delivery-address';
import {
  addressLines,
  postalAddressSchema,
  streetLines,
  type PostalAddress,
} from '../src/postal-address';

const complete = {
  line1: '2675 Mill Road',
  city: 'Demo Falls',
  state: 'ID',
  postalCode: '83010',
};

describe('postalAddressSchema', () => {
  it('accepts a complete address', () => {
    expect(postalAddressSchema.parse(complete)).toEqual(complete);
  });

  it('accepts the optional name and second line', () => {
    const parsed = postalAddressSchema.parse({
      ...complete,
      name: 'Accounts Payable',
      line2: 'Suite 400',
    });
    expect(parsed.name).toBe('Accounts Payable');
    expect(parsed.line2).toBe('Suite 400');
  });

  it('upper-cases the state, so WA and wa are one jurisdiction', () => {
    expect(postalAddressSchema.parse({ ...complete, state: 'wa' }).state).toBe('WA');
  });

  it('keeps ZIP+4, which the WA DOR rate files are published at', () => {
    expect(postalAddressSchema.parse({ ...complete, postalCode: '98000-4071' }).postalCode).toBe(
      '98000-4071',
    );
  });

  it.each([
    ['no street', { city: 'Demo Falls', state: 'ID', postalCode: '83010' }],
    ['no city', { line1: '2675 Mill Road', state: 'ID', postalCode: '83010' }],
    ['no state', { line1: '2675 Mill Road', city: 'Demo Falls', postalCode: '83010' }],
    ['no postal code', { line1: '2675 Mill Road', city: 'Demo Falls', state: 'ID' }],
  ])('refuses a partial address: %s', (_label, input) => {
    expect(() => postalAddressSchema.parse(input)).toThrow();
  });

  it('accepts a PO Box as line1', () => {
    expect(postalAddressSchema.parse({ ...complete, line1: '310 Demo Avenue' }).line1).toBe(
      '310 Demo Avenue',
    );
  });
});

describe('the delivery and billing names', () => {
  it('are the same schema', () => {
    expect(deliveryAddressSchema).toBe(postalAddressSchema);
    expect(billingAddressSchema).toBe(postalAddressSchema);
  });

  it('both parse the same address to the same value', () => {
    expect(billingAddressSchema.parse(complete)).toEqual(deliveryAddressSchema.parse(complete));
  });
});

const WHOLE = {
  name: 'Receiving',
  line1: '400 Warehouse Way',
  line2: 'Dock 3',
  city: 'Sample Harbor',
  state: 'WA',
  postalCode: '98000-4071',
};

describe('streetLines', () => {
  it('writes the street, the second line, then city, state and ZIP on one line', () => {
    expect(streetLines(WHOLE)).toEqual([
      '400 Warehouse Way',
      'Dock 3',
      'Sample Harbor, WA 98000-4071',
    ]);
  });

  it('leaves out the name, which each document says in its own way', () => {
    expect(streetLines(WHOLE)).not.toContain('Receiving');
  });

  it('drops an absent second line instead of leaving a gap for it', () => {
    expect(streetLines(complete)).toEqual(['2675 Mill Road', 'Demo Falls, ID 83010']);
  });

  it('never returns an empty line, whatever is absent', () => {
    for (const address of [WHOLE, complete, { ...WHOLE, line2: undefined }]) {
      expect(streetLines(address).filter((line) => line.trim() === '')).toEqual([]);
    }
  });
});

describe('addressLines', () => {
  it('puts the name first when there is one, then the street lines', () => {
    expect(addressLines(WHOLE)).toEqual([
      'Receiving',
      '400 Warehouse Way',
      'Dock 3',
      'Sample Harbor, WA 98000-4071',
    ]);
  });

  it('starts at the street when there is no name', () => {
    expect(addressLines(complete)).toEqual(['2675 Mill Road', 'Demo Falls, ID 83010']);
  });

  it('is the street lines with the name in front, never a second way of writing them', () => {
    const addresses: PostalAddress[] = [WHOLE, complete, { ...WHOLE, name: undefined }];
    for (const address of addresses) {
      const name = address.name === undefined ? [] : [address.name];
      expect(addressLines(address)).toEqual([...name, ...streetLines(address)]);
    }
  });
});
