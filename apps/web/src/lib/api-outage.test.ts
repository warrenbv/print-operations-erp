// Tests which routes survive an API outage, what the outage page says, and where its retry link may point.
import { describe, expect, it } from 'vitest';

import { outageNotice, safeReturnPath, survivesOutage, type OutageOutcome } from './api-outage';

const BASE = 'http://erp.example.test:3001';

describe('which routes survive an outage', () => {
  it('exempts /login, because an outage must not hide the way back in', () => {
    expect(survivesOutage('/login')).toBe(true);
  });

  it('exempts the outage route itself, which would otherwise redirect to itself', () => {
    expect(survivesOutage('/api-unavailable')).toBe(true);
  });

  it.each(['/', '/orders', '/admin/users', '/quoting/quotes', '/crm/customers'])(
    'sends %s to the outage route',
    (pathname) => {
      expect(survivesOutage(pathname)).toBe(false);
    },
  );

  it('matches exactly, so a later route underneath is not exempted by accident', () => {
    expect(survivesOutage('/login/reset')).toBe(false);
    expect(survivesOutage('/api-unavailable/detail')).toBe(false);
  });
});

describe('what the reader is told', () => {
  it('calls a stopped API unavailable and names the address tried', () => {
    const { heading, detail } = outageNotice({ kind: 'no-answer', cause: undefined }, BASE);
    expect(heading).toBe('The API is unavailable');
    expect(detail).toContain(BASE);
    expect(detail).toContain('Nothing answered');
  });

  it('does not call a running API unavailable, and quotes the status it sent', () => {
    const { heading, detail } = outageNotice({ kind: 'error-status', status: 503 }, BASE);
    expect(heading).toBe('The API is not serving requests');
    expect(detail).toContain('answered 503');
    expect(detail).toContain('running');
    expect(heading).not.toContain('unavailable');
  });

  it.each<[OutageOutcome, string]>([
    [{ kind: 'no-answer', cause: undefined }, 'no-answer'],
    [{ kind: 'error-status', status: 500 }, 'error-status'],
  ])('tells %#-th case how to recover', (outcome) => {
    expect(outageNotice(outcome, BASE).detail).toContain('Try again');
  });
});

describe('where the retry link may point', () => {
  it('keeps a local path', () => {
    expect(safeReturnPath('/orders')).toBe('/orders');
    expect(safeReturnPath('/crm/customers?q=acme')).toBe('/crm/customers?q=acme');
  });

  it('falls back to Your work when there is nothing to go back to', () => {
    expect(safeReturnPath(undefined)).toBe('/');
    expect(safeReturnPath('')).toBe('/');
  });

  it('refuses to send the reader off this site', () => {
    expect(safeReturnPath('https://elsewhere.example/pay')).toBe('/');
    expect(safeReturnPath('//elsewhere.example/pay')).toBe('/');

    expect(safeReturnPath('/\\elsewhere.example/pay')).toBe('/');
    expect(safeReturnPath('javascript:alert(1)')).toBe('/');
  });
});
