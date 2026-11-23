// Tests which quotes may produce a document, and each gate that blocks one.
import { describe, expect, it } from 'vitest';

import { PRINTABLE_QUOTE_STATUSES, type QuoteSendability, type QuoteStatus } from '@erp/types';

import { offersDocument, quoteDocumentState } from './printability';

const sendable: QuoteSendability = { sendable: true };
const belowFloor: QuoteSendability = {
  sendable: false,
  belowFloor: [{ lineNumber: 2, minimumPricePerRoll: '387.2500' }],
};

const state = (over: Partial<Parameters<typeof quoteDocumentState>[0]> = {}) =>
  quoteDocumentState({
    status: 'quoted',
    sendability: sendable,
    manualCount: 0,
    approvalLive: false,
    leadTimeDays: 14,
    ...over,
  });

describe('the statuses that may produce a document', () => {
  it('offers the document on a quoted quote', () => {
    expect(state().kind).toBe('ready');
    expect(offersDocument(state())).toBe(true);
  });

  it('offers it on a superseded one', () => {
    expect(state({ status: 'superseded' }).kind).toBe('ready');
  });

  it.each<QuoteStatus>(['draft', 'override_requested', 'closed_lost'])(
    'refuses a %s quote, because a draft is indistinguishable from a sent document',
    (status) => {
      const result = state({ status });
      expect(result.kind).toBe('not-printable');
      expect(offersDocument(result)).toBe(false);
    },
  );

  it('reads its status list from the API rather than restating it', () => {
    for (const status of PRINTABLE_QUOTE_STATUSES) {
      expect(state({ status }).kind).toBe('ready');
    }
  });
});

describe('the floor, here too for Admin', () => {
  it('blocks the document below the floor', () => {
    const result = state({ sendability: belowFloor });
    expect(result.kind).toBe('blocked-below-floor');
    expect(offersDocument(result)).toBe(false);
  });

  it("follows the API's sendability, which reads sendable while an Admin's override stands", () => {
    expect(state({ sendability: sendable }).kind).toBe('ready');
    expect(state({ sendability: sendable, manualCount: 1 }).kind).toBe(
      'blocked-unapproved-override',
    );
  });

  it('STILL blocks it when a price approval is live', () => {
    const result = state({ sendability: belowFloor, approvalLive: true, manualCount: 3 });
    expect(result.kind).toBe('blocked-below-floor');
  });

  it('reports the offending lines, so the page can name the remedy', () => {
    const result = state({ sendability: belowFloor });
    expect(result.kind === 'blocked-below-floor' ? result.belowFloor : []).toEqual(
      belowFloor.sendable === false ? belowFloor.belowFloor : [],
    );
  });
});

describe('a hand-set price still waiting on Billing', () => {
  it('blocks the document', () => {
    const result = state({ manualCount: 2 });
    expect(result.kind).toBe('blocked-unapproved-override');
    expect(offersDocument(result)).toBe(false);
  });

  it('releases it once the approval is live — unlike the floor', () => {
    expect(state({ manualCount: 2, approvalLive: true }).kind).toBe('ready');
  });
});

describe('the lead time', () => {
  it('blocks the document when nobody has entered one', () => {
    const result = state({ leadTimeDays: undefined });
    expect(result.kind).toBe('blocked-no-lead-time');
    expect(offersDocument(result)).toBe(false);
  });

  it('treats zero as a lead time, not as absent', () => {
    expect(state({ leadTimeDays: 0 }).kind).toBe('ready');
  });

  it('is reported LAST, after the money rules', () => {
    expect(state({ sendability: belowFloor, leadTimeDays: undefined }).kind).toBe(
      'blocked-below-floor',
    );
    expect(state({ manualCount: 1, leadTimeDays: undefined }).kind).toBe(
      'blocked-unapproved-override',
    );
    expect(state({ status: 'draft', leadTimeDays: undefined }).kind).toBe('not-printable');
  });
});
