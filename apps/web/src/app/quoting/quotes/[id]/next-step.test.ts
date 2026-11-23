// Tests the Next line a quote shows each role, through its re-export here.
import type { QuoteStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { quoteNextStep, type QuoteNextStepInput } from './next-step';

function input(overrides: Partial<QuoteNextStepInput>): QuoteNextStepInput {
  return {
    quoteId: 'q-1',
    status: 'draft',
    lineCount: 1,
    leadTimeDays: 10,
    send: { kind: 'sendable' },
    orderIds: [],
    roles: ['Sales'],
    ...overrides,
  };
}

describe('quoteNextStep', () => {
  it('asks Sales for lines on an empty draft', () => {
    expect(quoteNextStep(input({ lineCount: 0 }))).toEqual({
      sentence: 'add the lines and price them.',
      action: { href: '#lines', label: 'Add a line' },
    });
  });

  describe('a line below the floor comes before anything else', () => {
    const draft = input({
      send: { kind: 'needs-floor-override', belowFloor: [], requested: false, manualCount: 0 },
    });
    const requested = input({
      status: 'override_requested',
      send: { kind: 'needs-floor-override', belowFloor: [], requested: true, manualCount: 0 },
    });

    it('sends Sales to the request on step 4', () => {
      expect(quoteNextStep(draft)).toEqual({
        sentence: 'request approval for the line below the floor.',
        action: { href: '/quoting/quotes/q-1/review', label: 'Go to the request' },
      });
      expect(quoteNextStep({ ...draft, roles: ['Billing'] })).toEqual({
        sentence: 'Sales requests approval for the line below the floor.',
      });
    });

    it('names an Admin once requested, and links Approvals only for an Admin', () => {
      expect(quoteNextStep(requested)).toEqual({
        sentence: 'an Admin decides the line below the floor.',
      });
      expect(quoteNextStep({ ...requested, roles: ['Billing'] })).toEqual({
        sentence: 'an Admin decides the line below the floor.',
      });
      expect(quoteNextStep({ ...requested, roles: ['Admin'] })).toEqual({
        sentence: 'decide the line below the floor.',
        action: { href: '/approvals', label: 'Open Approvals' },
      });
    });

    it('reads the Admin form state by status, as the request path', () => {
      const override = { kind: 'override-floor' as const, belowFloor: [], manualCount: 0 };
      expect(quoteNextStep(input({ send: override, roles: ['Admin'] }))?.action?.label).toBe(
        'Go to the request',
      );
      expect(
        quoteNextStep(input({ status: 'override_requested', send: override, roles: ['Admin'] }))
          ?.action?.label,
      ).toBe('Open Approvals');
    });
  });

  it('asks for the approval a hand-set price needs', () => {
    expect(quoteNextStep(input({ send: { kind: 'needs-approval', manualCount: 1 } }))).toEqual({
      sentence: 'request approval of the hand-set price.',
      action: { href: '/quoting/quotes/q-1/review', label: 'Go to the request' },
    });
  });

  it('names the Billing Manager while the approval is pending, and links only for them', () => {
    const waiting = input({
      status: 'override_requested',
      send: { kind: 'awaiting-approval', manualCount: 1 },
    });
    expect(quoteNextStep(waiting)).toEqual({
      sentence: 'the Billing Manager decides the hand-set price.',
    });
    expect(quoteNextStep({ ...waiting, roles: ['Billing'] })).toEqual({
      sentence: 'decide the hand-set price.',
      action: { href: '/approvals', label: 'Open Approvals' },
    });
  });

  it('asks production for the lead time the send needs', () => {
    expect(quoteNextStep(input({ leadTimeDays: undefined }))).toEqual({
      sentence: 'Production enters the lead time.',
    });
    expect(quoteNextStep(input({ leadTimeDays: undefined, roles: ['ProductionManager'] }))).toEqual(
      {
        sentence: 'enter the lead time.',
        action: { href: '#lead-time', label: 'Go to the lead time' },
      },
    );
  });

  it('asks Sales to send once every gate is clear', () => {
    expect(quoteNextStep(input({}))).toEqual({
      sentence: 'send the quote.',
      action: { href: '/quoting/quotes/q-1/review', label: 'Go to Send quote' },
    });
    expect(quoteNextStep(input({ roles: ['Billing'] }))).toEqual({
      sentence: 'Sales sends the quote.',
    });
  });

  it('asks for the conversion once sent, then for another order on the next PO', () => {
    expect(quoteNextStep(input({ status: 'quoted' }))).toEqual({
      sentence: 'convert it to an order when the customer accepts.',
      action: { href: '/quoting/quotes/q-1/convert', label: 'Convert this quote' },
    });
    expect(quoteNextStep(input({ status: 'quoted', orderIds: ['o-1', 'o-2'] }))).toEqual({
      sentence: 'create another order when the customer sends the next PO.',
      action: { href: '/quoting/quotes/q-1/convert', label: 'Create another order' },
    });
  });

  it('asks every role for the conversion, since anyone signed in may convert', () => {
    for (const role of ['Production', 'ProductionManager', 'Billing'] as const) {
      expect(quoteNextStep(input({ status: 'quoted', roles: [role] }))).toEqual({
        sentence: 'convert it to an order when the customer accepts.',
        action: { href: '/quoting/quotes/q-1/convert', label: 'Convert this quote' },
      });
    }

    expect(quoteNextStep(input({ status: 'quoted', roles: [] }))?.action?.label).toBe(
      'Convert this quote',
    );
  });

  it('says nothing for a superseded or lost quote', () => {
    const ends: QuoteStatus[] = ['superseded', 'closed_lost'];
    for (const status of ends) {
      expect(quoteNextStep(input({ status }))).toBeNull();
    }
  });
});
