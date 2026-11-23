// Tests the desk roles, in-page link and fold link helpers.
import { describe, expect, it } from 'vitest';

import { absolute, deskRoles, orderFoldPage } from './work';

describe('deskRoles', () => {
  it('drops Admin beside a desk role', () => {
    expect(deskRoles(['Admin', 'Sales'])).toEqual(['Sales']);
  });

  it('keeps Admin when it is the only role', () => {
    expect(deskRoles(['Admin'])).toEqual(['Admin']);
  });

  it('leaves other roles and no roles as they are', () => {
    expect(deskRoles(['Billing', 'Sales'])).toEqual(['Billing', 'Sales']);
    expect(deskRoles([])).toEqual([]);
  });
});

describe('absolute', () => {
  it('puts an anchor on the record page', () => {
    expect(absolute('#lines', '/quoting/quotes/q-1')).toBe('/quoting/quotes/q-1#lines');
  });

  it('leaves an absolute href alone', () => {
    expect(absolute('/approvals', '/quoting/quotes/q-1')).toBe('/approvals');
  });
});

describe('orderFoldPage', () => {
  it('lands on the Documents fold, open, where the PO is attached', () => {
    expect(orderFoldPage('o-1', 'documents')).toBe('/orders/o-1?field=documents#documents');
  });
});
