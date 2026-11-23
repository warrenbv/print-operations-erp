// Derives a record page's step strip and its Act now panel: the one act for this reader, or the desk it is waiting on.
// Every quote and order page opens with this: docs/product/requirements.md (R12), docs/product/ux-direction.md.
// It composes the work rows in apps/web/src/lib/work/ with the steps, gates and queues beside it. Rendered by packages/ui/src/record.tsx.
import {
  SALES_WRITE_ROLES,
  type ErpRole,
  type Order,
  type OrderStatus,
  type OrderTransition,
} from '@erp/types';

import { quoteWithOrdersWords } from '../../app/quoting/format';
import { formatAge, formatDay } from '../dates';
import { orderNextStep } from '../order-next-step';
import { orderWork } from '../work/order-work';
import { floorOwed, quoteNextLine, quoteWork, type QuoteWorkItem } from '../work/quote-work';
import { ALL_GATES, absolute, deskRoles, orderPage, type Work, type WorkDesk } from '../work/work';
import { deskInSentence, gateList, gateNote, type GateFacts, type RecordGate } from './gates';
import { queueFor } from './queues';
import { STEPS, stepHref, stepIndex, stepOf, type StepLabel, type StepRecords } from './steps';

export type { RecordGate } from './gates';

type StepState = 'done' | 'current' | 'gated' | 'todo' | 'na';

export interface RecordStep {
  readonly label: StepLabel;
  readonly state: StepState;

  readonly note?: string;

  readonly href?: string | undefined;
}

type StripItem = Omit<RecordStep, 'href'>;

interface Stage {
  readonly steps: readonly StripItem[];
  readonly act: RecordAct;
}

type ActTone = 'act' | 'waiting' | 'done';

export interface RecordAct {
  readonly tone: ActTone;
  readonly title: string;

  readonly who: string;

  readonly link?: { readonly href: string; readonly label: string };

  readonly gates?: readonly RecordGate[];

  readonly desk: WorkDesk | null;
}

export interface Lifecycle {
  readonly steps: readonly RecordStep[];
  readonly act: RecordAct;
}

interface QuoteRef {
  readonly id: string | null;

  readonly number: string;

  readonly sentAt: string | null;
}

interface Common {
  readonly roles: readonly ErpRole[];
  readonly now: Date;

  readonly pageGates?: readonly RecordGate[];
}

export interface QuoteLifecycleInput extends Common {
  readonly kind: 'quote';
  readonly record: QuoteWorkItem;

  readonly orders: readonly { readonly id: string }[];

  readonly sentAt: string | null;

  readonly productionToldAt: string | null;
}

export interface OrderLifecycleInput extends Common {
  readonly kind: 'order';

  readonly record: Pick<Order, 'id' | 'status' | 'updatedAt' | 'poNumber' | 'jobNumber'>;

  readonly transitions: readonly OrderTransition[];
  readonly quote: QuoteRef;

  readonly poFiled?: boolean;
}

export type LifecycleInput = QuoteLifecycleInput | OrderLifecycleInput;

export function lifecycle(input: LifecycleInput): Lifecycle {
  const { steps, act } = stage(input);
  const records = recordsOf(input);
  return {
    steps: steps.map((step) => ({
      ...step,
      href: stepHref(step.label, step.state === 'done' || step.state === 'current', records),
    })),
    act,
  };
}

function stage(input: LifecycleInput): Stage {
  switch (input.kind) {
    case 'quote':
      return quoteLifecycle(input);
    case 'order':
      return orderLifecycle(input);
  }
}

function recordsOf(input: LifecycleInput): StepRecords {
  switch (input.kind) {
    case 'quote':
      return { quoteId: input.record.id, orderId: null };
    case 'order':
      return { quoteId: input.quote.id, orderId: input.record.id };
  }
}

type DoneNote = (label: StepLabel) => string | undefined;

function item(label: StepLabel, state: StepState, note?: string): StripItem {
  return note === undefined ? { label, state } : { label, state, note };
}

function strip(
  current: StepLabel,
  currentNote: string | undefined,
  gate: string | null,
  doneNote: DoneNote,
): readonly StripItem[] {
  const at = stepIndex(current);
  return STEPS.map((label, index) => {
    if (index < at) return item(label, 'done', doneNote(label));
    if (index === at) return item(label, 'current', currentNote);
    if (index === at + 1 && gate !== null) return item(label, 'gated', gate);
    return item(label, 'todo');
  });
}

function reached(
  transitions: readonly OrderTransition[],
  label: StepLabel,
): OrderTransition | undefined {
  return transitions.find((transition) => stepOf('order', transition.to) === label);
}

function enteredAt(
  transitions: readonly OrderTransition[],
  status: OrderStatus,
  fallback: string,
): string {
  return transitions.filter((transition) => transition.to === status).at(-1)?.at ?? fallback;
}

function orderDoneNote(
  quoteNote: string | undefined,
  transitions: readonly OrderTransition[],
): DoneNote {
  return (label) => {
    if (label === 'Quote') return quoteNote;
    const transition = reached(transitions, label);
    return transition === undefined ? undefined : formatDay(transition.at);
  };
}

function quoteRefNote(quote: QuoteRef): string {
  return quote.sentAt === null ? quote.number : `Sent ${formatDay(quote.sentAt)}`;
}

function withWords(work: Work, since: string, now: Date): string | undefined {
  const age = formatAge(since, now);
  if (work.with === 'You') return `With you, ${age}`;
  return work.desk === null ? undefined : `With ${deskInSentence(work.desk)}, ${age}`;
}

type Link = NonNullable<RecordAct['link']>;

function lowerFirst(words: string): string {
  return words.charAt(0).toLowerCase() + words.slice(1);
}

function sinceWords(since: string, now: Date): string {
  return `Since ${formatDay(since)} · ${formatAge(since, now)}`;
}

function actPanel(
  work: Work,
  since: string,
  now: Date,
  own: Link | undefined,
  gates: readonly RecordGate[],
  waitingWho?: string,
): RecordAct {
  const next = work.next ?? '';
  if (work.with === 'You') {
    const age = formatAge(since, now);
    return {
      tone: 'act',
      title: next,
      who: age === 'today' ? 'Yours to do · today' : `Yours to do · waiting ${age}`,
      ...(own === undefined ? {} : { link: own }),

      ...(gates.length === 0 ? {} : { gates }),
      desk: work.desk,
    };
  }
  const link = queueFor(work);
  return {
    tone: 'waiting',
    title:
      work.desk === null ? next : `Waiting on ${deskInSentence(work.desk)} to ${lowerFirst(next)}`,
    who: waitingWho ?? sinceWords(since, now),
    ...(link === undefined ? {} : { link }),
    desk: work.desk,
  };
}

const OUTSIDE_THIS_EDITION = 'Production, shipping and invoicing are outside this edition.';

function confirmedEnd(doneNote: DoneNote): Stage {
  return {
    steps: STEPS.map((label) => item(label, 'done', doneNote(label))),
    act: {
      tone: 'done',
      title: 'Confirmed',
      who: OUTSIDE_THIS_EDITION,
      desk: null,
    },
  };
}

const NOTHING_LEFT = 'Nothing is left to do.';

function quoteLifecycle(input: QuoteLifecycleInput): Stage {
  const { record, orders, sentAt, roles, now } = input;

  if (record.status === 'superseded' || record.status === 'closed_lost') {
    return offLineQuote(record.status, record.updatedAt, orders.length);
  }

  if (record.status === 'quoted') {
    const since = sentAt ?? record.updatedAt;
    const age = formatAge(since, now);

    // Conversion has no role gate, so the link is asked for with every gate held: docs/product/requirements.md (R10).
    const link = quoteNextLine(
      record,
      orders.map((order) => order.id),
      ALL_GATES,
    )?.action;
    return {
      steps: strip(
        'Quote',
        orders.length === 0
          ? `With the customer, ${age}`
          : quoteWithOrdersWords('quoted', orders.length),
        null,
        () => undefined,
      ),
      act: {
        tone: 'waiting',
        title: 'Waiting on the customer',
        who: `${sentAt === null ? 'Since' : 'Sent'} ${formatDay(since)} · ${age}`,
        ...(link === undefined ? {} : { link }),
        desk: null,
      },
    };
  }

  return draftQuote(input, quoteWork({ quote: record, orders: [], roles, now }));
}

function askQuote(
  record: QuoteWorkItem,
  roles: readonly ErpRole[],
): { readonly href: string; readonly label: string } | undefined {
  return quoteNextLine(record, [], roles)?.action;
}

function draftQuote(input: QuoteLifecycleInput, work: Work): Stage {
  const { record, roles, now, productionToldAt } = input;
  // `due` is the act whoever holds it must take next. `own`, below, is the act this reader may take.
  const due = askQuote(record, ALL_GATES)?.label;
  const desks = deskRoles(roles);

  let note: string;
  if (due === 'Go to Send quote') note = 'Draft, ready to send';
  else if (work.with === 'You' || SALES_WRITE_ROLES.some((role) => desks.includes(role))) {
    note = 'Draft, with you';
  } else note = work.desk === null ? 'Draft' : `Draft, with ${deskInSentence(work.desk)}`;

  // While Production owes the lead time, the wait counts from when Production was told, if it was.
  const leadTimeWait = work.next === 'Enter the lead time' && work.with !== 'You';
  const since = leadTimeWait ? (productionToldAt ?? record.updatedAt) : record.updatedAt;
  const waitingWho =
    leadTimeWait && productionToldAt !== null
      ? `Asked ${formatDay(productionToldAt)} · ${formatAge(productionToldAt, now)}`
      : undefined;

  const own = work.with === 'You' ? askQuote(record, desks) : undefined;
  return {
    steps: strip(
      'Quote',
      note,
      gateNote({ kind: 'quote', act: due, floorOwed: floorOwed(record) }),
      () => undefined,
    ),
    act: actPanel(
      work,
      since,
      now,
      own === undefined ? undefined : { href: work.href, label: own.label },

      input.pageGates ?? [],
      waitingWho,
    ),
  };
}

function offLineQuote(
  status: 'superseded' | 'closed_lost',
  updatedAt: string,
  orderCount: number,
): Stage {
  const day = formatDay(updatedAt);
  const [title, who] =
    status === 'closed_lost'
      ? ['Closed (lost)', `Closed as lost on ${day}. ${NOTHING_LEFT}`]
      : ['Superseded', `Replaced by a newer version on ${day}. ${NOTHING_LEFT}`];
  const note =
    status === 'superseded' && orderCount > 0
      ? quoteWithOrdersWords('superseded', orderCount)
      : title;
  return {
    steps: STEPS.map((label) => item(label, 'na', label === 'Quote' ? note : undefined)),
    act: { tone: 'done', title, who, desk: null },
  };
}

function orderLifecycle(input: OrderLifecycleInput): Stage {
  const { record, transitions, quote, roles, now } = input;
  const work = orderWork({ order: record, roles, now });
  const quoteNote = quoteRefNote(quote);
  const at = stepOf('order', record.status);

  const doneNote = orderDoneNote(quoteNote, transitions);
  if (work.next === null) return confirmedEnd(doneNote);

  const since = enteredAt(transitions, record.status, record.updatedAt);
  const facts: GateFacts = {
    kind: 'order',
    status: record.status,
    poNumber: record.poNumber,
    poFiled: input.poFiled,
    origin: transitions.find((transition) => transition.from === null),
  };

  let own: Link | undefined;
  if (work.with === 'You') {
    const line = orderNextStep({ status: record.status, roles: deskRoles(roles) });
    own =
      line?.action === undefined
        ? { href: work.href, label: work.next }
        : { href: absolute(line.action.href, orderPage(record.id)), label: line.action.label };
  }

  return {
    steps: strip(at, withWords(work, since, now), gateNote(facts), doneNote),
    act: actPanel(work, since, now, own, [...(input.pageGates ?? []), ...gateList(facts)]),
  };
}
