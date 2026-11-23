// Tests reading the Confirm the order form.
import { describe, expect, it } from 'vitest';

import { toConfirmRequest } from './confirm-request';

const LOCK = '3';

describe('toConfirmRequest', () => {
  it('carries the lead time and the lockVersion the page rendered from', () => {
    const outcome = toConfirmRequest({ confirmedLeadTimeDays: '7', lockVersion: LOCK });

    expect(outcome).toEqual({ ok: true, request: { confirmedLeadTimeDays: 7, lockVersion: 3 } });
  });

  it('accepts zero days, because same-day work is a real commitment', () => {
    const outcome = toConfirmRequest({ confirmedLeadTimeDays: '0', lockVersion: LOCK });

    expect(outcome).toEqual({ ok: true, request: { confirmedLeadTimeDays: 0, lockVersion: 3 } });
  });

  it('refuses a blank box rather than reading it as same-day', () => {
    const outcome = toConfirmRequest({ confirmedLeadTimeDays: '', lockVersion: LOCK });

    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ field: 'confirmedLeadTimeDays' });
  });

  it('refuses whitespace for the same reason', () => {
    expect(toConfirmRequest({ confirmedLeadTimeDays: '   ', lockVersion: LOCK }).ok).toBe(false);
  });

  it('refuses text that starts with a number', () => {
    const outcome = toConfirmRequest({ confirmedLeadTimeDays: '7 days', lockVersion: LOCK });

    expect(outcome).toMatchObject({ ok: false, field: 'confirmedLeadTimeDays' });
  });

  it('refuses a fraction of a day', () => {
    expect(toConfirmRequest({ confirmedLeadTimeDays: '4.5', lockVersion: LOCK }).ok).toBe(false);
  });

  it('refuses a negative lead time', () => {
    expect(toConfirmRequest({ confirmedLeadTimeDays: '-1', lockVersion: LOCK }).ok).toBe(false);
  });

  it('refuses beyond the schema ceiling', () => {
    expect(toConfirmRequest({ confirmedLeadTimeDays: '3650', lockVersion: LOCK }).ok).toBe(true);
    expect(toConfirmRequest({ confirmedLeadTimeDays: '3651', lockVersion: LOCK }).ok).toBe(false);
  });

  it('says the page is stale when the lockVersion is missing, not that the lead time is wrong', () => {
    const outcome = toConfirmRequest({ confirmedLeadTimeDays: '7', lockVersion: '' });

    expect(outcome.ok).toBe(false);
    expect(outcome).not.toHaveProperty('field');
    expect(outcome).toMatchObject({ message: expect.stringContaining('out of date') });
  });
});
