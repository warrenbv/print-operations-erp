// Tests for the state code, postal code and delivery address schemas.
import { describe, expect, it } from 'vitest';

import { deliveryAddressSchema, postalCodeSchema, stateCodeSchema } from '../src/delivery-address';

describe('stateCodeSchema', () => {
  it('normalises case, so WA and wa are one jurisdiction', () => {
    expect(stateCodeSchema.parse('wa')).toBe('WA');
    expect(stateCodeSchema.parse(' id ')).toBe('ID');
  });

  it('refuses anything that is not a two-letter code', () => {
    expect(() => stateCodeSchema.parse('Wash.')).toThrow();
    expect(() => stateCodeSchema.parse('Washington')).toThrow();
    expect(() => stateCodeSchema.parse('W')).toThrow();
    expect(() => stateCodeSchema.parse('')).toThrow();
  });

  it('accepts a state outside WA and ID', () => {
    expect(stateCodeSchema.parse('OR')).toBe('OR');
  });
});

describe('postalCodeSchema', () => {
  it('accepts ZIP and ZIP+4', () => {
    expect(postalCodeSchema.parse('98000')).toBe('98000');
    expect(postalCodeSchema.parse('98000-4071')).toBe('98000-4071');
  });

  it('keeps a leading zero, because it is text and not a number', () => {
    expect(postalCodeSchema.parse('04719')).toBe('04719');
  });

  it('refuses malformed codes', () => {
    expect(() => postalCodeSchema.parse('9800')).toThrow();
    expect(() => postalCodeSchema.parse('980004071')).toThrow();
    expect(() => postalCodeSchema.parse('98000-12')).toThrow();
    expect(() => postalCodeSchema.parse('ABCDE')).toThrow();
  });
});

describe('deliveryAddressSchema', () => {
  const FULL = {
    name: 'Harbor Receiving',
    line1: '200 Example Way',
    line2: 'Dock 3',
    city: 'Sample Harbor',
    state: 'WA',
    postalCode: '98000-4071',
  };

  it('round-trips a full address', () => {
    expect(deliveryAddressSchema.parse(FULL)).toEqual(FULL);
  });

  it('accepts one with neither name nor second line', () => {
    const parsed = deliveryAddressSchema.parse({
      line1: '200 Example Way',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000',
    });
    expect(parsed).not.toHaveProperty('name');
    expect(parsed).not.toHaveProperty('line2');
  });

  it('refuses an address missing any part tax needs', () => {
    for (const missing of ['line1', 'city', 'state', 'postalCode'] as const) {
      const partial: Record<string, unknown> = { ...FULL };
      delete partial[missing];
      expect(() => deliveryAddressSchema.parse(partial), `missing ${missing}`).toThrow();
    }
  });

  it('refuses whitespace masquerading as a value', () => {
    expect(() => deliveryAddressSchema.parse({ ...FULL, line1: '   ' })).toThrow();
    expect(() => deliveryAddressSchema.parse({ ...FULL, city: '' })).toThrow();
  });
});
