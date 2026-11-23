// Tests the exact-name match that jumps straight to a customer.
import type { CustomerName } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { exactlyOneNamed } from './customer-suggestions';

const ACME: CustomerName = {
  id: '01a00000-0000-7000-8000-000000000001',
  name: 'Example Demo Industries',
  legacyAccountNumber: 'LA-3847',
};
const BEACON: CustomerName = {
  id: '01a00000-0000-7000-8000-000000000002',
  name: 'Example Demo Press',
};

const ACME_TWIN: CustomerName = {
  id: '01a00000-0000-7000-8000-000000000003',
  name: 'Example Demo Industries',
  legacyAccountNumber: 'LA-3852',
};

const SUGGESTIONS = [ACME, BEACON];

describe('exactlyOneNamed', () => {
  it('finds the account whose name is exactly the text', () => {
    expect(exactlyOneNamed(SUGGESTIONS, 'Example Demo Industries')).toBe(ACME);
  });

  it('ignores case and surrounding space, because the text may be typed', () => {
    expect(exactlyOneNamed(SUGGESTIONS, '  example demo industries ')).toBe(ACME);
  });

  it('answers nothing for a partial name, which is a search', () => {
    expect(exactlyOneNamed(SUGGESTIONS, 'Example Customer')).toBeUndefined();
    expect(exactlyOneNamed(SUGGESTIONS, 'Inc')).toBeUndefined();
  });

  it('answers nothing when two accounts share the name', () => {
    expect(exactlyOneNamed([ACME, ACME_TWIN, BEACON], 'Example Demo Industries')).toBeUndefined();
  });

  it('answers nothing for an empty or blank box', () => {
    expect(exactlyOneNamed(SUGGESTIONS, '')).toBeUndefined();
    expect(exactlyOneNamed(SUGGESTIONS, '   ')).toBeUndefined();
  });

  it('answers nothing when the text names no account at all', () => {
    expect(exactlyOneNamed(SUGGESTIONS, 'Nobody Ltd')).toBeUndefined();
  });

  it('does not match an account number, which is the search box job', () => {
    expect(exactlyOneNamed(SUGGESTIONS, 'LA-3847')).toBeUndefined();
  });
});
