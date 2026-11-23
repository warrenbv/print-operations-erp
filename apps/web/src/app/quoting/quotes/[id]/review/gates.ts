// The Review and send checklist: each condition, the desk that clears it, and the one primary act:
// docs/product/requirements.md (R8). The checklist only shows the gates. The API checks each one again
// when the quote is sent: modules/quoting/src/services/quote-service.ts.
import {
  contactLabel,
  formatMoney,
  recipientAddressesFor,
  type Contact,
  type QuoteStatus,
} from '@erp/types';
import type { ChipTone } from '@erp/ui';

import { formatAge, formatDay, formatTimestamp } from '../../../../../lib/dates';
import { nobodyTagged } from '../../../../../lib/helptext';
import { countWord } from '../../../../home/lede';
import type { CreditExceptionState } from '../../../credit-exception';
import { QUOTE_STATUS_LABELS } from '../../../format';
import type { SendAction } from '../action-rail';
import { leadTimeLabel } from '../derive';

export interface GateInput {
  readonly status: QuoteStatus;

  readonly lineCount: number;

  readonly send: SendAction;

  readonly manualCount: number;

  readonly agreedLines?: readonly number[];

  readonly approvalLive: boolean;
  readonly leadTime: {
    readonly days: number | undefined;

    readonly enteredBy?: string | undefined;

    readonly enteredAt?: string | undefined;
  };

  readonly leadTimeWaitingLine?: string | undefined;

  readonly approvalRequestedAt?: string | undefined;

  readonly floorRequestedAt?: string | undefined;

  readonly floorOverride?:
    | {
        readonly by: string;
        readonly at: string;
        readonly reason?: string | undefined;
      }
    | undefined;

  readonly recipients: {
    readonly names: readonly string[];
    readonly addresses: readonly string[];
  };
  readonly customerName: string;
  readonly credit: CreditExceptionState;

  readonly canWrite: boolean;

  readonly revision: boolean;
  readonly now: Date;
}

type GateKey = 'lines' | 'floor' | 'approval' | 'lead-time' | 'recipient' | 'credit';

interface Gate {
  readonly key: GateKey;

  readonly clear: boolean;
  readonly text: string;

  readonly link?: { readonly href: string; readonly label: string };

  readonly customerLink?: boolean;
}

export type Primary =
  | { readonly kind: 'send'; readonly addresses: readonly string[]; readonly revision: boolean }
  | {
      readonly kind: 'request-approval';
      readonly label: 'Request price approval' | 'Request approval';
      readonly reason: string;
    }
  | { readonly kind: 'override-floor' }
  | { readonly kind: 'disabled'; readonly label: 'Send quote'; readonly reason: string }
  | { readonly kind: 'none' };

export interface QuoteGates {
  readonly gates: readonly Gate[];

  readonly openCount: number;

  readonly ready: boolean;

  readonly title: string;

  readonly who: string;
  readonly chip: { readonly label: string; readonly tone: ChipTone };
  readonly primary: Primary;

  readonly createOrderWithoutSending: boolean;
}

const DISABLED_REASON: Readonly<Record<Exclude<GateKey, 'credit'>, string>> = {
  lines: 'Send is offered once a line is priced.',
  floor:
    'Send is offered once every line is above its floor, or an Admin has overridden the floor.',
  approval: 'Send is offered once the Billing Manager approves the price.',
  'lead-time': 'Send is offered once the lead time is in.',
  recipient: 'Send is offered once someone is tagged for quotes.',
};

export function quoteGates(input: GateInput): QuoteGates {
  const gates: Gate[] = [
    ...floorGates(input),
    approvalGate(input),
    leadTimeGate(input),
    recipientGate(input),
    ...creditLine(input.credit, input.customerName),
  ];
  const open = gates.filter((gate) => !gate.clear);
  const ready = open.length === 0;

  return {
    gates,
    openCount: open.length,
    ready,
    title: titleFor(input.recipients.names),
    who: ready ? readyWho(input.leadTime.enteredAt, input.now) : notYet(open.length),
    chip: ready
      ? { label: 'Ready to send', tone: 'now' }
      : { label: QUOTE_STATUS_LABELS[input.status], tone: 'neutral' },
    primary: primaryFor(input, open),
    createOrderWithoutSending: offersOrderWithoutSending(input, open),
  };
}

/** The contacts tagged for quotes that have an email address: docs/product/requirements.md (R1). */
export function quoteRecipientsOf(contacts: readonly Contact[]): GateInput['recipients'] {
  return {
    names: contacts
      .filter(
        (contact) =>
          contact.email !== undefined && contact.roles.some((held) => held.role === 'quote'),
      )
      .map(contactLabel),
    addresses: recipientAddressesFor(contacts, 'quote'),
  };
}

function floorGates(input: GateInput): Gate[] {
  const { send } = input;
  if (input.lineCount === 0) {
    return [{ key: 'lines', clear: false, text: 'No line is priced yet.' }];
  }
  if (send.kind === 'needs-floor-override' || send.kind === 'override-floor') {
    const remedy =
      input.status !== 'override_requested'
        ? 'An Admin can override the floor.'
        : input.floorRequestedAt === undefined
          ? 'Waiting for an Admin to override the floor.'
          : `Waiting for an Admin to override the floor, since ${formatDay(input.floorRequestedAt)}.`;
    return send.belowFloor.map((line) => ({
      key: 'floor',
      clear: false,
      text:
        `Line ${String(line.lineNumber)} is below the floor, minimum ` +
        `${formatMoney(line.minimumPricePerRoll)}. ${remedy}`,
    }));
  }
  if (input.floorOverride !== undefined) {
    const { by, at, reason } = input.floorOverride;
    const why = reason === undefined || clause(reason) === '' ? '' : `: ${clause(reason)}`;
    return [
      { key: 'floor', clear: true, text: `Floor overridden by ${by} on ${formatDay(at)}${why}.` },
    ];
  }
  return [{ key: 'floor', clear: true, text: 'Every line is priced and above the margin floor.' }];
}

function clause(reason: string): string {
  return reason.trim().replace(/[.\s]+$/, '');
}

function approvalGate(input: GateInput): Gate {
  if (input.manualCount === 0) {
    const agreed = (input.agreedLines ?? []).map(String);
    return {
      key: 'approval',
      clear: true,
      text:
        agreed.length === 0
          ? 'No hand-set price, so the Billing Manager has nothing to approve.'
          : `${agreed.length === 1 ? 'Line' : 'Lines'} ${joinNames(agreed)} ${
              agreed.length === 1 ? 'is' : 'are'
            } at the customer’s agreed price, so the Billing Manager has nothing to approve.`,
    };
  }
  if (input.approvalLive) {
    return {
      key: 'approval',
      clear: true,
      text: 'The Billing Manager approved the hand-set price.',
    };
  }
  if (input.status === 'override_requested') {
    return {
      key: 'approval',
      clear: false,
      text:
        input.approvalRequestedAt === undefined
          ? 'Approval of the hand-set price requested.'
          : `Approval of the hand-set price requested, waiting since ${formatDay(input.approvalRequestedAt)}.`,
    };
  }
  return {
    key: 'approval',
    clear: false,
    text: 'Approval of the hand-set price is not requested yet.',
  };
}

function leadTimeGate(input: GateInput): Gate {
  const { days, enteredBy, enteredAt } = input.leadTime;
  if (days === undefined) {
    return {
      key: 'lead-time',
      clear: false,
      text:
        input.leadTimeWaitingLine === undefined
          ? 'Production enters the lead time.'
          : `Production enters the lead time. ${input.leadTimeWaitingLine}`,
      link: { href: '/production/lead-times', label: 'Who does this' },
    };
  }
  const who = [enteredBy, enteredAt === undefined ? undefined : formatTimestamp(enteredAt)].filter(
    (part): part is string => part !== undefined,
  );
  return {
    key: 'lead-time',
    clear: true,
    text:
      `Production entered the lead time: ${leadTimeLabel(days).toLowerCase()}` +
      `${who.length === 0 ? '' : ` (${who.join(', ')})`}.`,
  };
}

function recipientGate(input: GateInput): Gate {
  const { names, addresses } = input.recipients;
  if (addresses.length === 0) {
    return {
      key: 'recipient',
      clear: false,
      text: nobodyTagged('quotes', 'Quote'),
      customerLink: true,
    };
  }
  const one = names.length === 1;
  return {
    key: 'recipient',
    clear: true,
    text:
      `${joinNames(names)} ${one ? 'is the contact' : 'are the contacts'} for quotes at ` +
      `${input.customerName}.`,
  };
}

// A credit hold stops a new quote or a revision, not a send: docs/product/requirements.md (R2).
// It is listed so the reader sees it, and always as clear.
function creditLine(credit: CreditExceptionState, customerName: string): Gate[] {
  if (credit.kind === 'not-held') {
    return [];
  }
  const state: Record<Exclude<CreditExceptionState['kind'], 'not-held'>, string> = {
    'may-ask': 'It stops a new quote or a revision, not this send.',
    pending: 'An exception is waiting on the Billing Manager. The hold does not stop this send.',
    approved: 'An exception is approved for one new quote. The hold does not stop this send.',
    rejected: 'The last exception was refused. The hold does not stop this send.',
  };
  return [
    {
      key: 'credit',
      clear: true,
      text: `${customerName} is on credit hold. ${state[credit.kind]}`,
    },
  ];
}

function primaryFor(input: GateInput, open: readonly Gate[]): Primary {
  const { send } = input;

  if (send.kind === 'override-floor') {
    return { kind: 'override-floor' };
  }
  if (!input.canWrite) {
    return { kind: 'none' };
  }

  if (send.kind === 'needs-floor-override') {
    return send.requested
      ? { kind: 'disabled', label: 'Send quote', reason: FLOOR_WAITING }
      : {
          kind: 'request-approval',
          label: 'Request approval',
          reason: floorRequestReason(send.belowFloor, send.manualCount),
        };
  }
  if (send.kind === 'needs-approval') {
    return {
      kind: 'request-approval',
      label: 'Request price approval',
      reason: `${handSetWords(send.manualCount)} on this quote ${send.manualCount === 1 ? 'needs' : 'need'} the Billing Manager’s approval before it can be sent.`,
    };
  }
  // Send stays disabled, with the reason of the first open gate.
  const first = open[0];
  if (first !== undefined && first.key !== 'credit') {
    return { kind: 'disabled', label: 'Send quote', reason: DISABLED_REASON[first.key] };
  }
  return { kind: 'send', addresses: input.recipients.addresses, revision: input.revision };
}

// With nobody tagged for quotes the quote cannot be emailed. When the recipients gate is the only one
// open, Sales may still mark the quote Quoted and create the order without sending it.
function offersOrderWithoutSending(input: GateInput, open: readonly Gate[]): boolean {
  return input.canWrite && open.every((gate) => gate.key === 'recipient');
}

const FLOOR_WAITING = 'Waiting for an Admin to override the floor.';

function floorRequestReason(
  belowFloor: Extract<SendAction, { kind: 'needs-floor-override' }>['belowFloor'],
  manualCount: number,
): string {
  const numbers = belowFloor.map((line) => String(line.lineNumber));
  const lines =
    numbers.length === 1
      ? `Line ${joinNames(numbers)} is below the floor.`
      : `Lines ${joinNames(numbers)} are below the floor.`;
  const price =
    manualCount === 0
      ? ''
      : ` ${handSetWords(manualCount)} ${manualCount === 1 ? 'needs' : 'need'} the Billing Manager’s approval.`;
  return `${lines} An Admin decides whether it goes out.${price}`;
}

function handSetWords(count: number): string {
  return `${String(count)} hand-set price${count === 1 ? '' : 's'}`;
}

function titleFor(names: readonly string[]): string {
  return names.length === 0 ? 'Send the quote' : `Send the quote to ${joinNames(names)}`;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

function readyWho(enteredAt: string | undefined, now: Date): string {
  if (enteredAt === undefined) {
    return 'Yours to do';
  }
  const when = formatAge(enteredAt, now) === 'today' ? 'today' : formatDay(enteredAt);
  return `Yours to do · lead time came in ${when}`;
}

function notYet(open: number): string {
  return `Not yet: ${countWord(open)} gate${open === 1 ? '' : 's'} open`;
}
