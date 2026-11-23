// Tests for the queue count responses.
import { describe, expect, it } from 'vitest';

import {
  orderCountResponseSchema,
  quoteCountResponseSchema,
  type OrderCountResponse,
  type QuoteCountResponse,
} from '../src/queue-count';

const AT = '2026-10-07T16:00:00.000Z';
const ID = '01988a00-0100-7000-8000-000000000001';
const OTHER = '01988a00-0100-7000-8000-000000000002';

describe('queue count responses', () => {
  it('reads an empty queue as a zero count and no oldest', () => {
    const empty = { count: 0, oldest: null };
    expect(quoteCountResponseSchema.parse(empty)).toEqual(empty);
    expect(orderCountResponseSchema.parse(empty)).toEqual(empty);
  });

  it('carries a quote by its identifying fields only', () => {
    const answer: QuoteCountResponse = {
      count: 3,
      oldest: {
        id: ID,
        quoteNumber: 7,
        versionNumber: 2,
        customerId: OTHER,
        status: 'quoted',
        updatedAt: AT,
      },
    };
    expect(quoteCountResponseSchema.parse(answer)).toEqual(answer);

    const parsed = quoteCountResponseSchema.parse({
      ...answer,
      oldest: { ...answer.oldest, lineCount: 4 },
    });
    expect(parsed.oldest).not.toHaveProperty('lineCount');
  });

  it('carries an order by its identifying fields, the job number optional', () => {
    const answer: OrderCountResponse = {
      count: 1,
      oldest: { id: ID, quoteId: OTHER, customerId: OTHER, status: 'converted', updatedAt: AT },
    };
    expect(orderCountResponseSchema.parse(answer)).toEqual(answer);
    expect(
      orderCountResponseSchema.parse({
        ...answer,
        oldest: { ...answer.oldest, jobNumber: 'J-4826' },
      }).oldest?.jobNumber,
    ).toBe('J-4826');
  });

  it('refuses a negative or fractional count', () => {
    expect(quoteCountResponseSchema.safeParse({ count: -1, oldest: null }).success).toBe(false);
    expect(orderCountResponseSchema.safeParse({ count: 6.5, oldest: null }).success).toBe(false);
  });
});
