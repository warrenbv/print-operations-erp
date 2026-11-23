// Tests that a logged path drops its query.
import { describe, expect, it } from 'vitest';

import { pathForLog } from './path-for-log';

describe('pathForLog', () => {
  it('keeps a path with no query as it is', () => {
    expect(pathForLog('/orders/0190a7c2-0000-7000-8000-000000000001')).toBe(
      '/orders/0190a7c2-0000-7000-8000-000000000001',
    );
  });

  it('drops the query, typed term and all', () => {
    expect(pathForLog('/crm/customers?q=ZZ%20TEST%20Paper&limit=20&offset=0')).toBe(
      '/crm/customers',
    );
  });

  it('drops a bare question mark', () => {
    expect(pathForLog('/admin/users?')).toBe('/admin/users');
  });
});
