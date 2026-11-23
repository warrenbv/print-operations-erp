// Tests the step strip gate notes and the order checklist.
import type { OrderStatus, OrderTransition } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { WorkDesk } from '../work/work';
import { deskInSentence, gateList, gateNote, type GateFacts } from './gates';

const ORIGIN: OrderTransition = {
  id: 't-1',
  orderId: 'o-1',
  from: null,
  to: 'converted',
  actor: 'pat',
  at: '2026-09-18T17:00:00.000Z',
};

function order(
  status: OrderStatus,
  overrides: Partial<Omit<Extract<GateFacts, { kind: 'order' }>, 'kind' | 'status'>> = {},
): GateFacts {
  return { kind: 'order', status, ...overrides };
}

describe('deskInSentence', () => {
  it.each<[WorkDesk, string]>([
    ['Sales', 'Sales'],
    ['Production', 'Production'],
    ['The Production Manager', 'the Production Manager'],
    ['The floor', 'the floor'],
    ['The Billing Manager', 'the Billing Manager'],
    ['An Admin', 'an Admin'],
  ])('%s reads "%s" mid-sentence', (desk, words) => {
    expect(deskInSentence(desk)).toBe(words);
  });
});

describe('gateNote', () => {
  it.each([
    ['Add a line', 'Needs a priced line'],
    ['Go to the request', 'Needs price approval'],
    ['Open Approvals', 'Needs price approval'],
    ['Go to the lead time', 'Needs a lead time'],
  ])('a draft quote whose act is "%s" gates the order: %s', (act, note) => {
    expect(gateNote({ kind: 'quote', act })).toBe(note);
  });

  it.each(['Go to the request', 'Open Approvals'])(
    'a quote owing the floor names the floor on "%s"',
    (act) => {
      expect(gateNote({ kind: 'quote', act, floorOwed: true })).toBe('A line is below the floor');
    },
  );

  it('a quote ready to send has no gate', () => {
    expect(gateNote({ kind: 'quote', act: 'Go to Send quote' })).toBeNull();
    expect(gateNote({ kind: 'quote', act: undefined })).toBeNull();
  });

  it.each<OrderStatus>(['converted', 'confirmed'])('%s has no gate', (status) => {
    expect(gateNote(order(status))).toBeNull();
  });
});

describe('gateList', () => {
  it('a converted order: who converted it, and the PO is not needed', () => {
    expect(gateList(order('converted', { origin: ORIGIN, poNumber: 'PO-1' }))).toEqual([
      { text: 'Converted from a quoted quote by pat on 2026-09-18.', clear: true },
      { text: 'Customer PO PO-1 is recorded. It is not needed to confirm.', clear: true },
    ]);
    expect(gateList(order('converted'))).toEqual([
      { text: 'No PO recorded. It is not needed to confirm.', clear: true },
    ]);
    expect(gateList(order('converted', { poNumber: 'PO-1', poFiled: true }))).toEqual([
      {
        text: 'Customer PO PO-1 is recorded, with the file. Neither is needed to confirm.',
        clear: true,
      },
    ]);
  });

  it('a quote and a confirmed order have no list of their own', () => {
    expect(gateList({ kind: 'quote', act: 'Go to Send quote' })).toEqual([]);
    expect(gateList(order('confirmed'))).toEqual([]);
  });
});
