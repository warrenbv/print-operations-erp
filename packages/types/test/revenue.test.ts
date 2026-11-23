// Tests for revenue categories, a line's tax treatment and the ship-to check.
import { describe, expect, it } from 'vitest';

import {
  FREIGHT_REVENUE_CATEGORY,
  REVENUE_CATEGORIES,
  TAX_STATUSES,
  isTaxable,
  jurisdictionFitsShipTo,
  jurisdictionShipToRefusal,
  lineTaxTreatmentSchema,
} from '../src/revenue';

describe('revenue categories', () => {
  it('lists the categories a line can be booked to', () => {
    expect([...REVENUE_CATEGORIES]).toEqual(['print', 'label', 'freight', 'design']);
  });

  it('books freight revenue to freight, whatever the goods are', () => {
    expect(FREIGHT_REVENUE_CATEGORY).toBe('freight');
  });
});

describe('tax treatment', () => {
  it('has exactly three statuses: Idaho tax, Washington tax and non-taxable', () => {
    expect([...TAX_STATUSES]).toEqual(['id_tax', 'wa_tax', 'non_tax']);
  });

  it('requires a jurisdiction when the revenue is taxable', () => {
    expect(lineTaxTreatmentSchema.safeParse({ taxStatus: 'wa_tax' }).success).toBe(false);
    expect(
      lineTaxTreatmentSchema.safeParse({ taxStatus: 'wa_tax', taxJurisdiction: 'WA-0202' }).success,
    ).toBe(true);
  });

  it('refuses a jurisdiction on non-taxable revenue', () => {
    expect(
      lineTaxTreatmentSchema.safeParse({ taxStatus: 'non_tax', taxJurisdiction: 'ID' }).success,
    ).toBe(false);
    expect(lineTaxTreatmentSchema.safeParse({ taxStatus: 'non_tax' }).success).toBe(true);
  });

  it('takes a Washington location code, not a two-value state list', () => {
    expect(
      lineTaxTreatmentSchema.safeParse({ taxStatus: 'wa_tax', taxJurisdiction: 'WA-9040' }).success,
    ).toBe(true);
  });

  it('knows which statuses are taxable', () => {
    expect(isTaxable('id_tax')).toBe(true);
    expect(isTaxable('wa_tax')).toBe(true);
    expect(isTaxable('non_tax')).toBe(false);
  });
});

describe('jurisdictionFitsShipTo', () => {
  it('accepts a jurisdiction whose state is the ship-to state', () => {
    expect(jurisdictionFitsShipTo('WA-0202', 'WA')).toBe(true);
    expect(jurisdictionFitsShipTo('ID', 'ID')).toBe(true);
  });

  it('refuses a jurisdiction from the other taxing state', () => {
    expect(jurisdictionFitsShipTo('WA-0202', 'ID')).toBe(false);
    expect(jurisdictionFitsShipTo('ID', 'WA')).toBe(false);
  });

  it('refuses any jurisdiction on a delivery to a state Demo Printworks does not tax', () => {
    expect(jurisdictionFitsShipTo('WA-0202', 'OR')).toBe(false);
  });

  it('accepts a line naming no jurisdiction, whatever the destination', () => {
    expect(jurisdictionFitsShipTo(undefined, 'WA')).toBe(true);
    expect(jurisdictionFitsShipTo(undefined, 'OR')).toBe(true);
  });

  it('accepts anything when there is no ship-to to compare against', () => {
    expect(jurisdictionFitsShipTo('WA-0202', undefined)).toBe(true);
  });

  it('normalises the ship-to state rather than comparing raw input', () => {
    expect(jurisdictionFitsShipTo('WA-0202', ' wa ')).toBe(true);
  });
});

describe('jurisdictionShipToRefusal', () => {
  it('names both figures, because one alone sends the reader away to look', () => {
    const message = jurisdictionShipToRefusal('WA-0202', 'OR');
    expect(message).toContain('WA-0202');
    expect(message).toContain('OR');
  });
});
