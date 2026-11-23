// The gate note on the step strip and the checklist in an order's Act now panel.
// A blocked act shows what blocks it before the click: docs/product/ux-direction.md.
// The quote's send checklist is built separately in apps/web/src/app/quoting/quotes/[id]/review/gates.ts.
import type { OrderStatus, OrderTransition } from '@erp/types';

import { formatDay } from '../dates';
import type { WorkDesk } from '../work/work';

export interface RecordGate {
  readonly text: string;
  readonly clear: boolean;

  readonly href?: string;

  readonly link?: { readonly href: string; readonly label: string };
}

export type GateFacts =
  | {
      readonly kind: 'quote';

      readonly act: string | undefined;

      readonly floorOwed?: boolean;
    }
  | {
      readonly kind: 'order';
      readonly status: OrderStatus;
      readonly poNumber?: string | undefined;

      readonly poFiled?: boolean | undefined;

      readonly origin?: OrderTransition | undefined;
    };

export function deskInSentence(desk: WorkDesk): string {
  if (desk.startsWith('The ')) return `the ${desk.slice(4)}`;
  return desk.startsWith('An ') ? `an ${desk.slice(3)}` : desk;
}

// Keyed by the Next line's action label from apps/web/src/lib/work/quote-next-step.ts.
const QUOTE_GATE_NOTE: Readonly<Record<string, string>> = {
  'Add a line': 'Needs a priced line',
  'Go to the request': 'Needs price approval',
  'Open Approvals': 'Needs price approval',
  'Go to the lead time': 'Needs a lead time',
};

// A line below the floor and a hand-set price share these acts, so `floorOwed` decides which note shows.
// The floor is a gate of its own that no price approval releases: docs/product/requirements.md (R6).
const FLOOR_ACTS: readonly string[] = ['Go to the request', 'Open Approvals'];

export function gateNote(facts: GateFacts): string | null {
  switch (facts.kind) {
    case 'quote':
      if (facts.act === undefined) return null;
      if (facts.floorOwed === true && FLOOR_ACTS.includes(facts.act)) {
        return 'A line is below the floor';
      }
      return QUOTE_GATE_NOTE[facts.act] ?? null;
    case 'order':
      return null;
  }
}

export function gateList(facts: GateFacts): readonly RecordGate[] {
  switch (facts.kind) {
    case 'quote':
      return [];
    case 'order':
      return orderGateList(facts);
  }
}

function orderGateList(facts: Extract<GateFacts, { kind: 'order' }>): readonly RecordGate[] {
  const { status, poNumber, poFiled, origin } = facts;
  switch (status) {
    case 'converted': {
      const gates: RecordGate[] = [];
      if (origin !== undefined) {
        gates.push({
          text: `Converted from a quoted quote by ${origin.actor} on ${formatDay(origin.at)}.`,
          clear: true,
        });
      }

      // The order records the PO and, optionally, its file (docs/product/requirements.md (R9)). Neither blocks confirmation.
      let po: string;
      if (poNumber === undefined) po = 'No PO recorded. It is not needed to confirm.';
      else if (poFiled === true) {
        po = `Customer PO ${poNumber} is recorded, with the file. Neither is needed to confirm.`;
      } else po = `Customer PO ${poNumber} is recorded. It is not needed to confirm.`;
      gates.push({ text: po, clear: true });
      return gates;
    }
    default:
      return [];
  }
}
