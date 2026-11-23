// Tests the opening sentences of Your work.
import { describe, expect, it } from 'vitest';

import {
  anotherDeskSentence,
  countWord,
  ledeFor,
  listName,
  needYouSentence,
  refusedSentence,
  stamp,
} from './lede';

const NOW = new Date('2026-10-07T21:10:00.000Z');

describe('stamp', () => {
  it('is the day and time in the business zone', () => {
    expect(stamp(NOW)).toBe('Wednesday 7 October, 2:10 PM.');
  });

  it('is the Pacific day, not the UTC one, late in the evening', () => {
    expect(stamp(new Date('2026-10-08T01:30:00.000Z'))).toBe('Wednesday 7 October, 6:30 PM.');
  });
});

describe('countWord', () => {
  it('words one to nine, digits from 10', () => {
    expect([1, 2, 9, 10, 23].map(countWord)).toEqual(['one', 'two', 'nine', '10', '23']);
  });
});

describe('needYouSentence', () => {
  it.each([
    [{ quotes: 2, orders: 0 }, 'Two quotes need you.'],
    [{ quotes: 0, orders: 1 }, 'One order needs you.'],
    [{ quotes: 2, orders: 1 }, 'Two quotes and one order need you.'],
    [{ quotes: 12, orders: 0 }, '12 quotes need you.'],
    [{ quotes: 0, orders: 0 }, 'Nothing is waiting on you.'],

    [{ quotes: 0, orders: 0, exceptions: 1 }, 'One exception needs you.'],
    [{ quotes: 1, orders: 2, exceptions: 1 }, 'One quote, two orders and one exception need you.'],
    [{ quotes: 0, orders: 0, exceptions: 0 }, 'Nothing is waiting on you.'],
  ])('%o: %s', (needYou, sentence) => {
    expect(needYouSentence(needYou)).toBe(sentence);
  });
});

describe('anotherDeskSentence', () => {
  it('reads as one sentence with one late row', () => {
    expect(anotherDeskSentence({ count: 3, late: ['19 days'] })).toBe(
      'Three wait on another desk, and one of those has waited 19 days.',
    );
  });

  it('names the oldest of several late rows', () => {
    expect(anotherDeskSentence({ count: 3, late: ['30 days', '9 days'] })).toBe(
      'Three wait on another desk, and the oldest has waited 30 days.',
    );
  });

  it('ends at the count when nothing is late', () => {
    expect(anotherDeskSentence({ count: 1, late: [] })).toBe('One waits on another desk.');
  });

  it('says "it" when the one waiting is late', () => {
    expect(anotherDeskSentence({ count: 1, late: ['8 days'] })).toBe(
      'One waits on another desk, and it has waited 8 days.',
    );
  });

  it('says nothing when nothing waits on another desk', () => {
    expect(anotherDeskSentence({ count: 0, late: [] })).toBeNull();
  });
});

describe('ledeFor', () => {
  it('is the lede for the Sales desk', () => {
    expect(
      ledeFor({
        now: NOW,
        needYou: { quotes: 2, orders: 0 },
        another: { count: 3, late: ['19 days'] },
      }),
    ).toBe(
      'Wednesday 7 October, 2:10 PM. Two quotes need you. Three wait on another desk, and one of those has waited 19 days.',
    );
  });

  it('has no another-desk sentence without the Sales desk', () => {
    expect(ledeFor({ now: NOW, needYou: { quotes: 0, orders: 0 }, another: null })).toBe(
      'Wednesday 7 October, 2:10 PM. Nothing is waiting on you.',
    );
  });
});

describe('refusedSentence', () => {
  it('says nothing when every list was read', () => {
    expect(refusedSentence([])).toBeNull();
  });

  it('names a refused list in plain words', () => {
    expect(refusedSentence(['/orders'])).toBe(
      'Some queues could not be read just now: orders. Every page is still here below.',
    );
  });

  it('names several once each, a query and an unknown path included', () => {
    expect(
      refusedSentence([
        '/approvals/pending',
        '/crm/customers?creditHold=true&limit=100',
        '/crm/customers?creditHold=true',
        '/shipping/thing',
      ]),
    ).toBe(
      'Some queues could not be read just now: approvals, credit holds, thing. Every page is still here below.',
    );
    expect(listName('/approvals/pending')).toBe('approvals');
  });
});
