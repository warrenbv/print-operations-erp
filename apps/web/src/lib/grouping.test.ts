// Tests the group-by choice read from the query string.
import { describe, expect, it } from 'vitest';

import { resolveGrouping } from './grouping';

const CONSUMPTION_GROUPINGS = ['job', 'grade'] as const;
const MARGIN_GROUPINGS = ['order', 'customer'] as const;

describe('resolveGrouping', () => {
  it('takes the report default when nothing is asked for', () => {
    const resolved = resolveGrouping(undefined, CONSUMPTION_GROUPINGS, 'job');
    expect(resolved.groupBy).toBe('job');
    expect(resolved.rejected).toBeUndefined();
  });

  it('honours a grouping the report offers', () => {
    expect(resolveGrouping('grade', CONSUMPTION_GROUPINGS, 'job').groupBy).toBe('grade');
    expect(resolveGrouping('customer', MARGIN_GROUPINGS, 'order').groupBy).toBe('customer');
  });

  it('quotes back a grouping the report does not have', () => {
    const resolved = resolveGrouping('operator', CONSUMPTION_GROUPINGS, 'job');
    expect(resolved.groupBy).toBe('job');
    expect(resolved.rejected).toBe('operator');
  });

  it('rejects a grouping another report offers but this one does not', () => {
    expect(resolveGrouping('customer', CONSUMPTION_GROUPINGS, 'job').rejected).toBe('customer');
  });

  it('rejects an empty string rather than treating it as absent', () => {
    expect(resolveGrouping('', CONSUMPTION_GROUPINGS, 'job').rejected).toBe('');
  });
});
