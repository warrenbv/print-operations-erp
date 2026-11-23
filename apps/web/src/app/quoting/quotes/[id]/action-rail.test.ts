// Tests which send act a quote offers for the floor, for hand-set prices and on the ordinary path.
import { describe, expect, it } from 'vitest';

import type { QuoteSendability, QuoteStatus } from '@erp/types';

import { offersSend, sendAction } from './action-rail';
import { manualPriceCount } from './derive';

const sendable: QuoteSendability = { sendable: true };
const belowFloor: QuoteSendability = {
  sendable: false,
  belowFloor: [{ lineNumber: 2, minimumPricePerRoll: '387.2500' }],
};
const lines = [{ lineNumber: 2, minimumPricePerRoll: '387.2500' }];

const rail = (over: Partial<Parameters<typeof sendAction>[0]> = {}) =>
  sendAction({
    status: 'draft',
    sendability: sendable,
    manualCount: 0,
    approvalLive: false,
    floorOverrider: false,
    ...over,
  });

describe('the floor, for every role but Admin', () => {
  it('blocks send below the floor, and Sales may ask for the override', () => {
    const action = rail({ sendability: belowFloor });
    expect(action).toEqual({
      kind: 'needs-floor-override',
      belowFloor: lines,
      requested: false,
      manualCount: 0,
    });
    expect(offersSend(action)).toBe(false);
  });

  it('says the request has gone in once the quote waits on it', () => {
    const action = rail({ status: 'override_requested', sendability: belowFloor });
    expect(action).toMatchObject({ kind: 'needs-floor-override', requested: true });
    expect(offersSend(action)).toBe(false);
  });

  it('STILL blocks send when a price approval is live', () => {
    const action = rail({ sendability: belowFloor, approvalLive: true, manualCount: 3 });
    expect(action.kind).toBe('needs-floor-override');
    expect(offersSend(action)).toBe(false);
  });

  it('counts the hand-set prices still owed an approval, so the request names both', () => {
    expect(rail({ sendability: belowFloor, manualCount: 2 })).toMatchObject({ manualCount: 2 });
    expect(rail({ sendability: belowFloor, manualCount: 2, approvalLive: true })).toMatchObject({
      manualCount: 0,
    });
  });

  it('blocks send below the floor whatever the status and whoever reads', () => {
    for (const status of ['draft', 'override_requested', 'quoted'] as QuoteStatus[]) {
      for (const floorOverrider of [false, true]) {
        expect(offersSend(rail({ status, sendability: belowFloor, floorOverrider }))).toBe(false);
      }
    }
  });

  it('carries the offending lines through, so the reader is told which line', () => {
    const action = rail({ sendability: belowFloor });
    expect(action.kind === 'needs-floor-override' && action.belowFloor).toHaveLength(1);
  });
});

describe('an Admin reading a below-floor quote', () => {
  it('is offered the override, on a draft or a requested quote', () => {
    for (const status of ['draft', 'override_requested'] as QuoteStatus[]) {
      expect(rail({ status, sendability: belowFloor, floorOverrider: true })).toEqual({
        kind: 'override-floor',
        belowFloor: lines,
        manualCount: 0,
      });
    }
  });

  it('reads the hand-set gate once the override is in force, as the API does', () => {
    expect(rail({ manualCount: 1, floorOverrider: true })).toEqual({
      kind: 'needs-approval',
      manualCount: 1,
    });
    expect(rail({ floorOverrider: true })).toEqual({ kind: 'sendable' });
  });
});

describe('hand-set prices need Billing', () => {
  it('offers Send, not the request, on a margin entered manually', () => {
    const lines = [{ priceSource: 'margin', marginOverridePct: '0.270000' }] as never[];
    const action = rail({ manualCount: manualPriceCount(lines) });
    expect(action).toEqual({ kind: 'sendable' });
    expect(offersSend(action)).toBe(true);
  });

  it('offers the request on a draft', () => {
    const action = rail({ manualCount: 2 });
    expect(action).toEqual({ kind: 'needs-approval', manualCount: 2 });
    expect(offersSend(action)).toBe(false);
  });

  it('offers the request on a price hand-set per POUND', () => {
    const perPoundHandSet = {
      pricingBasis: 'per_pound',
      priceSource: 'manual',
      overridePricePerLb: '0.8350',
      freightResult: { pending: false },
    } as never;

    const action = rail({ manualCount: manualPriceCount([perPoundHandSet]) });
    expect(action).toEqual({ kind: 'needs-approval', manualCount: 1 });
    expect(offersSend(action)).toBe(false);
  });

  it('waits once the request has been made', () => {
    const action = rail({ status: 'override_requested', manualCount: 2 });
    expect(action).toEqual({ kind: 'awaiting-approval', manualCount: 2 });
    expect(offersSend(action)).toBe(false);
  });

  it('releases send once the approval is live', () => {
    expect(rail({ manualCount: 2, approvalLive: true }).kind).toBe('sendable');
  });

  it('does not ask for approval when no price was hand-set', () => {
    expect(rail({ manualCount: 0, approvalLive: false }).kind).toBe('sendable');
  });
});

describe('the ordinary path', () => {
  it('sends a priced quote with nothing outstanding', () => {
    const action = rail();
    expect(action).toEqual({ kind: 'sendable' });
    expect(offersSend(action)).toBe(true);
  });

  it('offers a send affordance in exactly one state', () => {
    const states = [
      rail({ sendability: belowFloor }),
      rail({ sendability: belowFloor, floorOverrider: true }),
      rail({ status: 'override_requested', sendability: belowFloor }),
      rail({ manualCount: 1 }),
      rail({ status: 'override_requested', manualCount: 1 }),
      rail(),
    ];
    expect(states.filter(offersSend)).toHaveLength(1);
  });
});
