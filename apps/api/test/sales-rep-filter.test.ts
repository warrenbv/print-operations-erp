// Tests `parseSalesRepFilter` in apps/api/src/sales-rep-filter.ts.
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { parseSalesRepFilter } from '../src/sales-rep-filter';

function reasonOf(call: () => unknown): string {
  try {
    call();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    const response = (err as BadRequestException).getResponse();
    return (response as { reason: string }).reason;
  }
  throw new Error('expected a refusal');
}

describe('parseSalesRepFilter', () => {
  it('passes a name through', () => {
    expect(parseSalesRepFilter('jsmith')).toBe('jsmith');
  });

  it('means every rep when the param is absent', () => {
    expect(parseSalesRepFilter(undefined)).toBeUndefined();
  });

  it('refuses an empty filter rather than reading it as everybody', () => {
    expect(reasonOf(() => parseSalesRepFilter(''))).toBe('empty-sales-rep');
    expect(reasonOf(() => parseSalesRepFilter('   '))).toBe('empty-sales-rep');
  });

  it('refuses a repeated param, which Express hands over as an array', () => {
    expect(reasonOf(() => parseSalesRepFilter(['jsmith', 'rlee']))).toBe('invalid-sales-rep');
    expect(reasonOf(() => parseSalesRepFilter(7))).toBe('invalid-sales-rep');
  });

  it('trims, so a padded link matches the stored value', () => {
    expect(parseSalesRepFilter(' jsmith ')).toBe('jsmith');
  });

  it('keeps a value no user holds, because a quote stores its rep as free text', () => {
    expect(parseSalesRepFilter('Smith, Jane')).toBe('Smith, Jane');
  });
});
