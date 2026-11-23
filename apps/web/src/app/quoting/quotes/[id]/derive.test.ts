// Tests the role and status questions the quote pages ask.
import { describe, expect, it } from 'vitest';

import {
  ERP_ROLES,
  type ErpRole,
  type QuoteOverrideDecision,
  type QuoteSendAttempt,
  type QuoteStatus,
} from '@erp/types';

import { decisionLabel } from '../../format';
import {
  agreedLineNumbers,
  approvalLive,
  canWrite,
  couldHaveOrder,
  editable,
  floorOverrideLive,
  floorRejectionSentence,
  freshRejection,
  lastDecision,
  lastDecisionOf,
  latestVersion,
  leadTimeEditable,
  leadTimeDoneLine,
  leadTimeWaitingLine,
  leadTimeLabel,
  leadTimePanel,
  manualPriceCount,
  pendingFreightCount,
  perPoundCount,
  showsLinesStep,
} from './derive';

describe('the Lines step and its lead-time panel', () => {
  it('opens a quote still being entered on the Lines step, and nothing else', () => {
    expect(showsLinesStep('draft')).toBe(true);
    expect(showsLinesStep('override_requested')).toBe(true);
    for (const status of ['quoted', 'superseded', 'closed_lost'] as const) {
      expect(showsLinesStep(status)).toBe(false);
    }
  });

  it('asks Production to enter a missing lead time, and tells Sales it waits on them', () => {
    expect(leadTimePanel(['ProductionManager'], 'draft', undefined)).toBe('enter');
    expect(leadTimePanel(['Production'], 'override_requested', undefined)).toBe('enter');
    expect(leadTimePanel(['Admin'], 'draft', undefined)).toBe('enter');
    expect(leadTimePanel(['Sales'], 'draft', undefined)).toBe('waiting');
    expect(leadTimePanel(['Billing'], 'draft', undefined)).toBe('waiting');
  });

  it('reads done for everyone once one is in, zero days included', () => {
    expect(leadTimePanel(['Sales'], 'draft', 10)).toBe('done');
    expect(leadTimePanel(['ProductionManager'], 'draft', 0)).toBe('done');
  });

  it('says the done line with who and when, by name', () => {
    const quote = {
      leadTimeDays: 10,
      leadTimeSetBy: 'dev-production',

      leadTimeSetAt: '2026-10-07T17:00:00.000Z',
    };
    expect(leadTimeDoneLine(quote, 'Drew Demo')).toBe(
      'Lead time 10 days, entered by Drew Demo on 2026-10-07.',
    );

    expect(leadTimeDoneLine(quote, undefined)).toBe(
      'Lead time 10 days, entered by dev-production on 2026-10-07.',
    );
    expect(leadTimeDoneLine({ ...quote, leadTimeDays: 0 }, 'Drew Demo')).toBe(
      'Lead time same day, entered by Drew Demo on 2026-10-07.',
    );
  });

  it('leaves the who and when off a lead time entered before they were stored', () => {
    expect(leadTimeDoneLine({ leadTimeDays: 1 }, undefined)).toBe('Lead time 1 day.');
  });

  it('shows no panel once the quote can no longer take a lead time', () => {
    expect(leadTimePanel(['ProductionManager'], 'quoted', undefined)).toBe('none');
    expect(leadTimePanel(['Sales'], 'closed_lost', 10)).toBe('none');
  });
});

const decision = (
  kind: QuoteOverrideDecision['decision'],
  control: QuoteOverrideDecision['kind'] = 'price',
  at = '2026-08-01T00:00:00.000Z',
): QuoteOverrideDecision => ({
  id: `d-${kind}-${control}-${at}`,
  quoteId: 'q1',
  decision: kind,
  kind: control,
  actor: 'billing',
  at,
});

describe('the waiting line: when Production was told', () => {
  const quote = { updatedAt: '2026-10-01T17:00:00.000Z' };
  const now = new Date('2026-10-03T17:00:00.000Z');
  const send = (over: Partial<QuoteSendAttempt> = {}): QuoteSendAttempt => ({
    messageId: '<fixture-13@example.test>',
    recipients: ['fixture-34@example.test'],
    audience: 'internal',
    actor: 'dev-sales',
    submittedAt: '2026-10-02T17:00:00.000Z',
    outcome: 'accepted',
    unreachableHolders: [],
    kind: 'lead-time-request',
    ...over,
  });

  it('names the day Production was told, and how long ago', () => {
    expect(leadTimeWaitingLine(quote, [send()], now)).toMatch(
      /^Production was told 2026-10-0[12] · 1 day$/,
    );
  });

  it('ignores the other sends about the quote', () => {
    expect(leadTimeWaitingLine(quote, [send({ kind: undefined })], now)).toMatch(/^Asked /);
  });

  it('says when nobody holds the role', () => {
    expect(
      leadTimeWaitingLine(
        quote,
        [send({ outcome: 'failed', failureReason: 'no-holders', recipients: [] })],
        now,
      ),
    ).toBe('Production has not been told: nobody holds the Production Manager role.');
  });

  it('says when no holder has an address', () => {
    expect(
      leadTimeWaitingLine(
        quote,
        [send({ outcome: 'failed', failureReason: 'no-addresses', recipients: [] })],
        now,
      ),
    ).toBe('Production has not been told: no Production Manager has an email address.');
  });

  it('says when the mail server refused it', () => {
    expect(leadTimeWaitingLine(quote, [send({ outcome: 'failed' })], now)).toBe(
      'Production has not been told: the mail server refused the alert.',
    );
  });

  it('falls back to the last change of the quote when no request is on the log', () => {
    expect(leadTimeWaitingLine(quote, [], now)).toMatch(/^Asked 2026-10-0[01] · 2 days$/);
  });
});

describe('who may write', () => {
  it('admits Sales and Admin and nobody else', () => {
    for (const role of ERP_ROLES) {
      expect(canWrite([role])).toBe(role === 'Sales' || role === 'Admin');
    }
  });

  it('is false for a reader with no roles', () => {
    expect(canWrite([])).toBe(false);
  });
});

describe('whether the line editor is live', () => {
  const sales: ErpRole[] = ['Sales'];

  it('is open on a draft and while approval is pending', () => {
    expect(editable(sales, 'draft')).toBe(true);
    expect(editable(sales, 'override_requested')).toBe(true);
  });

  it('closes once the quote has been sent, because that is a commitment', () => {
    expect(editable(sales, 'quoted')).toBe(false);
    expect(editable(sales, 'superseded')).toBe(false);
  });

  it('needs BOTH the role and the state, not either', () => {
    expect(editable(['Production'], 'draft')).toBe(false);
    expect(editable(sales, 'quoted')).toBe(false);
  });
});

describe('whether an order could exist', () => {
  it('is true only where conversion can have happened', () => {
    expect(couldHaveOrder('quoted')).toBe(true);
    expect(couldHaveOrder('superseded')).toBe(true);
  });

  it('spares the request everywhere else', () => {
    for (const status of ['draft', 'override_requested', 'closed_lost'] as QuoteStatus[]) {
      expect(couldHaveOrder(status)).toBe(false);
    }
  });
});

describe('counting the lines that need saying something about', () => {
  const line = (over: Record<string, unknown>) =>
    ({
      freightResult: { pending: false },

      priceSource: 'tier',
      overridePricePerRoll: undefined,
      ...over,
    }) as never;

  it('counts lines still waiting on a carrier bid', () => {
    expect(pendingFreightCount([line({ freightResult: { pending: true } }), line({})])).toBe(1);
  });

  it('counts hand-set prices', () => {
    expect(
      manualPriceCount([
        line({ priceSource: 'manual', overridePricePerRoll: '500.0000' }),
        line({}),
      ]),
    ).toBe(1);
  });

  it('counts a price hand-set per POUND as a hand-set price', () => {
    expect(
      manualPriceCount([
        line({ pricingBasis: 'per_pound', priceSource: 'manual', overridePricePerLb: '0.8350' }),
        line({}),
      ]),
    ).toBe(1);

    expect(
      manualPriceCount([
        line({ pricingBasis: 'per_pound', priceSource: 'manual', overridePricePerLb: '0.8350' }),
        line({ priceSource: 'manual', overridePricePerRoll: '500.0000' }),
        line({ pricingBasis: 'per_pound' }),
      ]),
    ).toBe(2);
  });

  it('does not count a margin entered manually, which needs no approval', () => {
    expect(
      manualPriceCount([line({ priceSource: 'margin', marginOverridePct: '0.270000' }), line({})]),
    ).toBe(0);
  });

  it('does not count a line at the customer agreed price, and names it instead', () => {
    const lines = [
      line({ lineNumber: 3, priceSource: 'agreed', overridePricePerRoll: '21.7500' }),
      line({ lineNumber: 2, priceSource: 'manual', overridePricePerRoll: '23.0000' }),
      line({
        lineNumber: 1,
        pricingBasis: 'per_pound',
        priceSource: 'agreed',
        overridePricePerLb: '0.6900',
      }),
    ];
    expect(manualPriceCount(lines)).toBe(1);
    expect(agreedLineNumbers(lines)).toEqual([1, 3]);
  });

  it('counts lines priced per pound', () => {
    expect(perPoundCount([line({ pricingBasis: 'per_pound' }), line({})])).toBe(1);
    expect(
      perPoundCount([line({ pricingBasis: 'per_pound' }), line({ pricingBasis: 'per_pound' })]),
    ).toBe(2);
    expect(perPoundCount([line({ pricingBasis: 'per_roll' })])).toBe(0);
  });

  it('counts nothing on an empty quote', () => {
    expect(pendingFreightCount([])).toBe(0);
    expect(manualPriceCount([])).toBe(0);
    expect(perPoundCount([])).toBe(0);
  });
});

describe('the version chain and the decision trail', () => {
  it('lands the reader on the newest version', () => {
    const versions = [{ id: 'v1' }, { id: 'v2' }] as never[];
    expect(latestVersion(versions)).toEqual({ id: 'v2' });
    expect(latestVersion([])).toBeUndefined();
  });

  it('reads the most recent decision', () => {
    expect(lastDecision([decision('approved'), decision('rejected')])?.decision).toBe('rejected');
    expect(lastDecision([])).toBeUndefined();
  });

  it('holds a live approval flag off the quote itself', () => {
    expect(approvalLive({ overrideApprovedBy: 'billing' })).toBe(true);
    expect(approvalLive({ overrideApprovedBy: undefined })).toBe(false);
  });
});

describe('the rejection banner', () => {
  it('shows a rejection the salesperson has not yet acted on', () => {
    expect(freshRejection('draft', [decision('rejected')])?.decision).toBe('rejected');
  });

  it('stops once the quote has been sent again', () => {
    expect(freshRejection('quoted', [decision('rejected')])).toBeUndefined();
  });

  it('says nothing about an approval', () => {
    expect(freshRejection('draft', [decision('approved')])).toBeUndefined();
  });

  it('says nothing when there is no decision at all', () => {
    expect(freshRejection('draft', [])).toBeUndefined();
  });

  it('words a fresh floor rejection as the floor’s', () => {
    const rejected = { ...decision('rejected', 'floor'), actor: 'dev-admin', reason: 'Too thin' };
    expect(freshRejection('draft', [rejected])?.kind).toBe('floor');
    expect(floorRejectionSentence(rejected)).toBe(
      'Floor override rejected by dev-admin: "Too thin" — re-price the line or request approval again.',
    );
    expect(floorRejectionSentence({ actor: 'dev-admin' })).toBe(
      'Floor override rejected by dev-admin — re-price the line or request approval again.',
    );
  });
});

describe('the floor override and the logged request', () => {
  it('holds a live floor override off the quote itself', () => {
    expect(floorOverrideLive({ floorOverrideBy: 'dev-admin' })).toBe(true);
    expect(floorOverrideLive({ floorOverrideBy: undefined })).toBe(false);
  });

  it('dates each gate from its own control’s last request', () => {
    const trail = [
      decision('requested', 'price', '2026-10-01T18:00:00.000Z'),
      decision('requested', 'floor', '2026-10-01T18:00:00.000Z'),
      decision('rejected', 'floor', '2026-10-02T18:00:00.000Z'),

      decision('requested', 'floor', '2026-10-05T18:00:00.000Z'),
    ];
    expect(lastDecisionOf(trail, 'requested', 'floor')?.at).toBe('2026-10-05T18:00:00.000Z');
    expect(lastDecisionOf(trail, 'requested', 'price')?.at).toBe('2026-10-01T18:00:00.000Z');
    expect(lastDecisionOf(trail, 'approved', 'floor')).toBeUndefined();
  });

  it('labels a floor row by its control in the Price approvals fold, and a price row bare', () => {
    expect(decisionLabel(decision('approved', 'floor'))).toBe('Floor override approved');
    expect(decisionLabel(decision('rejected', 'floor'))).toBe('Floor override rejected');
    expect(decisionLabel(decision('revoked', 'floor'))).toBe('Floor override revoked');
    expect(decisionLabel(decision('requested', 'floor'))).toBe('Floor override requested');
    expect(decisionLabel(decision('approved'))).toBe('Approved');
    expect(decisionLabel(decision('revoked'))).toBe('Revoked');
  });
});

describe('who may enter the lead time', () => {
  it('admits Production, the Production Manager and Admin, and nobody else', () => {
    for (const role of ERP_ROLES) {
      expect(leadTimeEditable([role], 'draft')).toBe(
        role === 'Production' || role === 'ProductionManager' || role === 'Admin',
      );
    }
  });

  it('shuts Sales out, who own every other quote edit', () => {
    expect(canWrite(['Sales'])).toBe(true);
    expect(leadTimeEditable(['Sales'], 'draft')).toBe(false);
  });

  it.each<QuoteStatus>(['draft', 'override_requested'])('is live on a %s quote', (status) => {
    expect(leadTimeEditable(['ProductionManager'], status)).toBe(true);
  });

  it.each<QuoteStatus>(['quoted', 'superseded', 'closed_lost'])(
    'is closed on a %s quote, which setLeadTime refuses',
    (status) => {
      expect(leadTimeEditable(['ProductionManager'], status)).toBe(false);
    },
  );

  it('is false for a reader with no roles', () => {
    expect(leadTimeEditable([], 'draft')).toBe(false);
  });
});

describe('the lead time in words', () => {
  it('says nothing has been entered when nothing has', () => {
    expect(leadTimeLabel(undefined)).toBe('Not set yet');
  });

  it('reads zero as same-day, NOT as absent', () => {
    expect(leadTimeLabel(0)).toBe('Same day');
  });

  it('singularises one day', () => {
    expect(leadTimeLabel(1)).toBe('1 day');
  });

  it('counts the rest in days', () => {
    expect(leadTimeLabel(14)).toBe('14 days');
    expect(leadTimeLabel(2190)).toBe('2190 days');
  });
});
