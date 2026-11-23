// Tests `assertRecipientConfirmed` in apps/api/src/crm/confirm-recipient.ts: the set comparison and the refusal.
import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { assertRecipientConfirmed } from '../src/crm/confirm-recipient';

const BUYER = 'buyer@example.test';
const CLERK = 'ap@example.test';
const FOREMAN = 'foreman@example.test';

function refusal(confirmed: readonly string[] | undefined, current: readonly string[]) {
  try {
    assertRecipientConfirmed(confirmed, current);
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('assertRecipientConfirmed', () => {
  it('agrees when the sets match', () => {
    expect(refusal([BUYER, CLERK], [BUYER, CLERK])).toBeUndefined();
  });

  it('agrees when the same set arrives in a different order', () => {
    expect(refusal([CLERK, BUYER], [BUYER, CLERK])).toBeUndefined();
  });

  it('agrees when a spelling differs only in case', () => {
    expect(refusal(['Buyer@example.test'], [BUYER])).toBeUndefined();
  });

  it('agrees when the posted list repeats an address', () => {
    expect(refusal([BUYER, BUYER], [BUYER])).toBeUndefined();
  });

  it('refuses a member ADDED since the page rendered', () => {
    expect(refusal([BUYER], [BUYER, CLERK])).toBeInstanceOf(ConflictException);
  });

  it('refuses a member REMOVED since the page rendered', () => {
    expect(refusal([BUYER, CLERK], [BUYER])).toBeInstanceOf(ConflictException);
  });

  it('refuses a member REPLACED with the count unchanged', () => {
    expect(refusal([BUYER, CLERK], [BUYER, FOREMAN])).toBeInstanceOf(ConflictException);
  });

  it('refuses an empty confirmation against an account that has holders', () => {
    expect(refusal([], [BUYER])).toBeInstanceOf(ConflictException);
  });

  it('agrees when both sides are empty', () => {
    expect(refusal([], [])).toBeUndefined();
  });

  it('skips the comparison when the field is ABSENT, which is the wire contract', () => {
    expect(refusal(undefined, [BUYER, CLERK])).toBeUndefined();
  });

  it('names both sets in the refusal, because a person has to decide again', () => {
    const error = refusal([BUYER], [CLERK]);
    expect(error).toBeInstanceOf(ConflictException);
    const body = (error as ConflictException).getResponse() as {
      reason: string;
      value: { confirmed: string[]; designated: string[] };
    };
    expect(body.reason).toBe('recipient-changed');
    expect(body.value.confirmed).toEqual([BUYER]);
    expect(body.value.designated).toEqual([CLERK]);
  });
});
