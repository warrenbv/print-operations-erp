// Tests the Review and send checklist and its primary act for each gate open or clear.
import { describe, expect, it } from 'vitest';

import type { Contact, QuoteApproval } from '@erp/types';

import { nobodyTagged } from '../../../../../lib/helptext';
import { quoteGates, quoteRecipientsOf, type GateInput } from './gates';

const NOW = new Date('2026-10-08T17:00:00.000Z');
const TODAY = '2026-10-08T16:12:00.000Z';

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    status: 'draft',
    lineCount: 2,
    send: { kind: 'sendable' },
    manualCount: 0,
    approvalLive: false,
    leadTime: { days: 10, enteredBy: 'Drew Demo', enteredAt: TODAY },
    recipients: { names: ['Dylan Demo'], addresses: ['fixture-21@example.test'] },
    customerName: 'Northstar Demo Packaging',
    credit: { kind: 'not-held' },
    canWrite: true,
    revision: false,
    now: NOW,
    ...overrides,
  };
}

const textOf = (gates: ReturnType<typeof quoteGates>, key: string) =>
  gates.gates.filter((gate) => gate.key === key).map((gate) => [gate.clear, gate.text]);

describe('quoteGates, every gate clear', () => {
  const gates = quoteGates(input());

  it('lists the gates in the order the API checks them', () => {
    expect(gates.gates.map((gate) => gate.key)).toEqual([
      'floor',
      'approval',
      'lead-time',
      'recipient',
    ]);
    expect(gates.gates.every((gate) => gate.clear)).toBe(true);
  });

  it('says each one in plain words', () => {
    expect(gates.gates.map((gate) => gate.text)).toEqual([
      'Every line is priced and above the margin floor.',
      'No hand-set price, so the Billing Manager has nothing to approve.',
      'Production entered the lead time: 10 days (Drew Demo, 2026-10-08 09:12 PDT).',
      'Dylan Demo is the contact for quotes at Northstar Demo Packaging.',
    ]);
  });

  it('is ready to send, with Send the primary act', () => {
    expect(gates.ready).toBe(true);
    expect(gates.openCount).toBe(0);
    expect(gates.chip).toEqual({ label: 'Ready to send', tone: 'now' });
    expect(gates.title).toBe('Send the quote to Dylan Demo');
    expect(gates.who).toBe('Yours to do · lead time came in today');
    expect(gates.primary).toEqual({
      kind: 'send',
      addresses: ['fixture-21@example.test'],
      revision: false,
    });
  });

  it('says the day the lead time came in when it was not today', () => {
    const earlier = quoteGates(
      input({ leadTime: { days: 10, enteredAt: '2026-10-05T16:00:00.000Z' } }),
    );
    expect(earlier.who).toBe('Yours to do · lead time came in 2026-10-05');
    expect(quoteGates(input({ leadTime: { days: 10 } })).who).toBe('Yours to do');
  });

  it('leaves the parenthesis out when who and when are unknown', () => {
    expect(textOf(quoteGates(input({ leadTime: { days: 1 } })), 'lead-time')).toEqual([
      [true, 'Production entered the lead time: 1 day.'],
    ]);
  });

  it('sends a revision as a revision', () => {
    expect(quoteGates(input({ revision: true })).primary).toMatchObject({ revision: true });
  });

  it('names two or three contacts in a sentence', () => {
    const two = quoteGates(
      input({
        recipients: {
          names: ['Dana', 'Lee'],
          addresses: ['fixture-03@example.test', 'fixture-17@example.test'],
        },
      }),
    );
    expect(two.title).toBe('Send the quote to Dana and Lee');
    expect(textOf(two, 'recipient')).toEqual([
      [true, 'Dana and Lee are the contacts for quotes at Northstar Demo Packaging.'],
    ]);
    const three = quoteGates(
      input({ recipients: { names: ['A', 'B', 'C'], addresses: ['fixture-03@example.test'] } }),
    );
    expect(three.title).toBe('Send the quote to A, B and C');
  });
});

describe('quoteGates, a line at the customer agreed price', () => {
  it('names the agreed line when nothing else is owed, and Send stays the primary', () => {
    const gates = quoteGates(input({ agreedLines: [1] }));
    expect(textOf(gates, 'approval')).toEqual([
      [
        true,
        'Line 1 is at the customer’s agreed price, so the Billing Manager has nothing to approve.',
      ],
    ]);
    expect(gates.primary).toMatchObject({ kind: 'send' });
  });

  it('names two agreed lines in a sentence', () => {
    expect(textOf(quoteGates(input({ agreedLines: [1, 3] })), 'approval')).toEqual([
      [
        true,
        'Lines 1 and 3 are at the customer’s agreed price, so the Billing Manager has nothing to approve.',
      ],
    ]);
  });

  it('still asks for price approval when another line is hand-set', () => {
    const gates = quoteGates(
      input({
        agreedLines: [1],
        manualCount: 1,
        send: { kind: 'needs-approval', manualCount: 1 },
      }),
    );
    expect(textOf(gates, 'approval')).toEqual([
      [false, 'Approval of the hand-set price is not requested yet.'],
    ]);
    expect(gates.primary).toMatchObject({
      kind: 'request-approval',
      label: 'Request price approval',
    });
  });
});

describe('quoteGates, the lead time', () => {
  it('is open without one, with the way to the desk that enters it', () => {
    const gates = quoteGates(input({ leadTime: { days: undefined } }));
    expect(gates.gates.find((gate) => gate.key === 'lead-time')).toEqual({
      key: 'lead-time',
      clear: false,
      text: 'Production enters the lead time.',
      link: { href: '/production/lead-times', label: 'Who does this' },
    });
    expect(gates.ready).toBe(false);
    expect(gates.chip).toEqual({ label: 'Draft', tone: 'neutral' });
    expect(gates.who).toBe('Not yet: one gate open');
    expect(gates.primary).toEqual({
      kind: 'disabled',
      label: 'Send quote',
      reason: 'Send is offered once the lead time is in.',
    });
  });

  it('treats zero days as a lead time, never a missing one', () => {
    const gates = quoteGates(input({ leadTime: { days: 0 } }));
    expect(textOf(gates, 'lead-time')).toEqual([
      [true, 'Production entered the lead time: same day.'],
    ]);
    expect(gates.ready).toBe(true);
  });

  it('adds the waiting line when there is one', () => {
    const gates = quoteGates(
      input({
        leadTime: { days: undefined },
        leadTimeWaitingLine: 'Production was told 2026-10-07.',
      }),
    );
    expect(textOf(gates, 'lead-time')).toEqual([
      [false, 'Production enters the lead time. Production was told 2026-10-07.'],
    ]);
  });
});

describe('quoteGates, a quote with no line yet', () => {
  it('has one gate for the lines, and nothing to send', () => {
    const gates = quoteGates(input({ lineCount: 0 }));
    expect(textOf(gates, 'lines')).toEqual([[false, 'No line is priced yet.']]);
    expect(textOf(gates, 'floor')).toEqual([]);
    expect(gates.primary).toEqual({
      kind: 'disabled',
      label: 'Send quote',
      reason: 'Send is offered once a line is priced.',
    });
  });
});

describe('quoteGates, the floor and the hand-set price', () => {
  const lines = [{ lineNumber: 2, minimumPricePerRoll: '36.80' }];
  const needsFloor = (requested = false, manualCount = 0) => ({
    kind: 'needs-floor-override' as const,
    belowFloor: lines,
    requested,
    manualCount,
  });

  it('opens one gate per line below the floor, ahead of everything, naming the remedy', () => {
    const gates = quoteGates(input({ send: needsFloor(), leadTime: { days: undefined } }));
    expect(gates.gates[0]).toEqual({
      key: 'floor',
      clear: false,
      text: 'Line 2 is below the floor, minimum $36.80. An Admin can override the floor.',
    });
    expect(gates.who).toBe('Not yet: two gates open');
  });

  it('makes Request approval the primary for Sales, naming the line and who decides', () => {
    const gates = quoteGates(input({ send: needsFloor() }));
    expect(gates.primary).toEqual({
      kind: 'request-approval',
      label: 'Request approval',
      reason: 'Line 2 is below the floor. An Admin decides whether it goes out.',
    });
  });

  it('names every line, and the hand-set price the same request asks about', () => {
    const two = {
      ...needsFloor(false, 1),
      belowFloor: [
        { lineNumber: 1, minimumPricePerRoll: '13.84' },
        { lineNumber: 2, minimumPricePerRoll: '36.80' },
      ],
    };
    expect(quoteGates(input({ send: two, manualCount: 1 })).primary).toEqual({
      kind: 'request-approval',
      label: 'Request approval',
      reason:
        'Lines 1 and 2 are below the floor. An Admin decides whether it goes out. ' +
        '1 hand-set price needs the Billing Manager’s approval.',
    });
    expect(quoteGates(input({ send: needsFloor(false, 2), manualCount: 2 })).primary).toMatchObject(
      {
        reason:
          'Line 2 is below the floor. An Admin decides whether it goes out. ' +
          '2 hand-set prices need the Billing Manager’s approval.',
      },
    );
  });

  it('waits on an Admin once requested, and says since when (the request is logged)', () => {
    const gates = quoteGates(
      input({
        status: 'override_requested',
        send: needsFloor(true),
        floorRequestedAt: '2026-10-06T18:00:00.000Z',
      }),
    );
    expect(textOf(gates, 'floor')).toEqual([
      [
        false,
        'Line 2 is below the floor, minimum $36.80. Waiting for an Admin to override the floor, since 2026-10-06.',
      ],
    ]);
    expect(gates.primary).toEqual({
      kind: 'disabled',
      label: 'Send quote',
      reason: 'Waiting for an Admin to override the floor.',
    });
  });

  it('leaves the since clause out when no request row is logged', () => {
    const gates = quoteGates(input({ status: 'override_requested', send: needsFloor(true) }));
    expect(textOf(gates, 'floor')).toEqual([
      [
        false,
        'Line 2 is below the floor, minimum $36.80. Waiting for an Admin to override the floor.',
      ],
    ]);
  });

  it('offers an Admin the override form, whatever the status', () => {
    const override = { kind: 'override-floor' as const, belowFloor: lines, manualCount: 0 };
    expect(quoteGates(input({ send: override })).primary).toEqual({ kind: 'override-floor' });
    expect(quoteGates(input({ status: 'override_requested', send: override })).primary).toEqual({
      kind: 'override-floor',
    });

    expect(quoteGates(input({ send: override, canWrite: false })).primary).toEqual({
      kind: 'override-floor',
    });
  });

  it('reads clear while an override is in force, with who, when and why', () => {
    const gates = quoteGates(
      input({
        floorOverride: {
          by: 'Drew Demo',
          at: '2026-10-07T18:00:00.000Z',
          reason: 'Matching a competitor on a trial order.',
        },
      }),
    );
    expect(textOf(gates, 'floor')).toEqual([
      [
        true,
        'Floor overridden by Drew Demo on 2026-10-07: Matching a competitor on a trial order.',
      ],
    ]);
    expect(gates.ready).toBe(true);
    expect(
      textOf(
        quoteGates(input({ floorOverride: { by: 'dev-admin', at: '2026-10-07T18:00:00.000Z' } })),
        'floor',
      ),
    ).toEqual([[true, 'Floor overridden by dev-admin on 2026-10-07.']]);
  });

  it('offers a reader who is not Sales no act on a floor gate', () => {
    expect(quoteGates(input({ send: needsFloor(), canWrite: false })).primary).toEqual({
      kind: 'none',
    });
  });

  it('keeps the floor open even with a live price approval', () => {
    const gates = quoteGates(input({ send: needsFloor(), manualCount: 1, approvalLive: true }));
    expect(gates.ready).toBe(false);
    expect(textOf(gates, 'approval')).toEqual([
      [true, 'The Billing Manager approved the hand-set price.'],
    ]);
  });

  it('makes Request price approval the primary while it is still to ask', () => {
    const gates = quoteGates(
      input({ send: { kind: 'needs-approval', manualCount: 2 }, manualCount: 2 }),
    );
    expect(textOf(gates, 'approval')).toEqual([
      [false, 'Approval of the hand-set price is not requested yet.'],
    ]);
    expect(gates.primary).toEqual({
      kind: 'request-approval',
      label: 'Request price approval',
      reason:
        '2 hand-set prices on this quote need the Billing Manager’s approval before it can be sent.',
    });
    expect(
      quoteGates(input({ send: { kind: 'needs-approval', manualCount: 1 }, manualCount: 1 }))
        .primary,
    ).toMatchObject({
      reason:
        '1 hand-set price on this quote needs the Billing Manager’s approval before it can be sent.',
    });
  });

  it('disables Send while the approval waits, and says since when', () => {
    const gates = quoteGates(
      input({
        status: 'override_requested',
        send: { kind: 'awaiting-approval', manualCount: 1 },
        manualCount: 1,
        approvalRequestedAt: '2026-10-06T18:00:00.000Z',
      }),
    );
    expect(textOf(gates, 'approval')).toEqual([
      [false, 'Approval of the hand-set price requested, waiting since 2026-10-06.'],
    ]);
    expect(gates.chip.label).toBe('Approval requested');
    expect(gates.primary).toEqual({
      kind: 'disabled',
      label: 'Send quote',
      reason: 'Send is offered once the Billing Manager approves the price.',
    });
  });
});

describe('quoteGates, the recipients', () => {
  it('is open with nobody tagged, in the shared sentence with the customer link', () => {
    const gates = quoteGates(input({ recipients: { names: [], addresses: [] } }));
    expect(gates.gates.find((gate) => gate.key === 'recipient')).toEqual({
      key: 'recipient',
      clear: false,
      text: nobodyTagged('quotes', 'Quote'),
      customerLink: true,
    });
    expect(gates.title).toBe('Send the quote');
    expect(gates.primary).toEqual({
      kind: 'disabled',
      label: 'Send quote',
      reason: 'Send is offered once someone is tagged for quotes.',
    });
  });
});

describe('quoteGates, the credit hold', () => {
  const approval = { id: 'a-1', requestedAt: TODAY } as unknown as QuoteApproval;

  it.each([
    [{ kind: 'may-ask' as const }, 'It stops a new quote or a revision, not this send.'],
    [
      { kind: 'pending' as const, approval },
      'An exception is waiting on the Billing Manager. The hold does not stop this send.',
    ],
    [
      { kind: 'approved' as const, approval },
      'An exception is approved for one new quote. The hold does not stop this send.',
    ],
    [
      { kind: 'rejected' as const, approval },
      'The last exception was refused. The hold does not stop this send.',
    ],
  ])('says %o and never blocks', (credit, words) => {
    const gates = quoteGates(input({ credit }));
    expect(textOf(gates, 'credit')).toEqual([
      [true, `Northstar Demo Packaging is on credit hold. ${words}`],
    ]);
    expect(gates.ready).toBe(true);
    expect(gates.primary.kind).toBe('send');
  });

  it('says nothing for an account not on hold', () => {
    expect(textOf(quoteGates(input()), 'credit')).toEqual([]);
  });
});

describe('quoteRecipientsOf', () => {
  const tag = (role: 'quote' | 'order_confirmation') => ({ role, setBy: 'sales', setAt: TODAY });
  const contact = (name: string, email: string | undefined, roles: ReturnType<typeof tag>[]) =>
    ({ name, roles, ...(email === undefined ? {} : { email }) }) as unknown as Contact;

  it('names the contacts tagged for quotes and folds their addresses as the API does', () => {
    expect(
      quoteRecipientsOf([
        contact('Dylan Demo', 'fixture-21@example.test', [tag('quote')]),
        contact('Lee Demo', 'fixture-29@example.test', [tag('order_confirmation')]),
        contact('Alex Demo', 'fixture-04@example.test', [tag('quote'), tag('order_confirmation')]),
      ]),
    ).toEqual({
      names: ['Dylan Demo', 'Alex Demo'],
      addresses: ['fixture-04@example.test', 'fixture-21@example.test'],
    });
  });

  it('is empty when nobody is tagged', () => {
    expect(quoteRecipientsOf([contact('Lee Demo', 'fixture-29@example.test', [])])).toEqual({
      names: [],
      addresses: [],
    });
  });

  it('names a contact with no name by its address', () => {
    const mailbox = {
      ...contact('', 'FIXTURE-08@EXAMPLE.TEST', [tag('quote')]),
      name: null,
    } as Contact;
    expect(quoteRecipientsOf([mailbox])).toEqual({
      names: ['FIXTURE-08@EXAMPLE.TEST'],
      addresses: ['fixture-08@example.test'],
    });
  });
});

describe('quoteGates, Create the order without sending', () => {
  const offered = (overrides: Partial<GateInput>) =>
    quoteGates(input(overrides)).createOrderWithoutSending;
  const lines = [{ lineNumber: 2, minimumPricePerRoll: '36.80' }];
  const nobody = { recipients: { names: [], addresses: [] } };

  it('is offered beside Send when every gate is clear', () => {
    const gates = quoteGates(input());
    expect(gates.createOrderWithoutSending).toBe(true);
    expect(gates.primary.kind).toBe('send');
  });

  it('is offered with nobody tagged for quotes, while Send waits on the tag', () => {
    const gates = quoteGates(input(nobody));
    expect(gates.createOrderWithoutSending).toBe(true);
    expect(gates.primary).toEqual({
      kind: 'disabled',
      label: 'Send quote',
      reason: 'Send is offered once someone is tagged for quotes.',
    });
  });

  it('is offered once a hand-set price is approved, or the floor overridden', () => {
    expect(offered({ ...nobody, manualCount: 1, approvalLive: true })).toBe(true);
    expect(offered({ ...nobody, floorOverride: { by: 'dev-admin', at: TODAY } })).toBe(true);
  });

  it('is offered on a held account, since the hold never blocks', () => {
    expect(offered({ ...nobody, credit: { kind: 'may-ask' } })).toBe(true);
  });

  it('is not offered before a line is priced', () => {
    expect(offered({ ...nobody, lineCount: 0 })).toBe(false);
  });

  it('is not offered while a line is below the floor, asked or not, for Sales or an Admin', () => {
    const needs = { kind: 'needs-floor-override' as const, belowFloor: lines, manualCount: 0 };
    expect(offered({ send: { ...needs, requested: false } })).toBe(false);
    expect(offered({ status: 'override_requested', send: { ...needs, requested: true } })).toBe(
      false,
    );
    expect(offered({ send: { kind: 'override-floor', belowFloor: lines, manualCount: 0 } })).toBe(
      false,
    );
  });

  it('is not offered while a hand-set price is not yet approved', () => {
    expect(
      offered({ ...nobody, send: { kind: 'needs-approval', manualCount: 1 }, manualCount: 1 }),
    ).toBe(false);
    expect(
      offered({
        ...nobody,
        status: 'override_requested',
        send: { kind: 'awaiting-approval', manualCount: 1 },
        manualCount: 1,
      }),
    ).toBe(false);
  });

  it('is not offered without a lead time', () => {
    expect(offered({ ...nobody, leadTime: { days: undefined } })).toBe(false);
  });

  it('is not offered to a reader who cannot write', () => {
    expect(offered({ canWrite: false })).toBe(false);
    expect(offered({ ...nobody, canWrite: false })).toBe(false);
  });
});

describe('quoteGates, a reader who is not Sales', () => {
  it('offers no act, and reads the gates the same', () => {
    const gates = quoteGates(input({ canWrite: false, leadTime: { days: undefined } }));
    expect(gates.primary).toEqual({ kind: 'none' });
    expect(gates.who).toBe('Not yet: one gate open');
  });
});
