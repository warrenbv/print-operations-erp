// Tests the order work row for every status and desk.
import { ORDER_STATUSES, type ErpRole, type OrderStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { orderNextStep } from '../order-next-step';
import { orderRow, orderWork } from './order-work';
import { ALL_GATES, type Work } from './work';

const NOW = new Date('2026-10-07T18:00:00.000Z');
const CHANGED = '2026-10-07T15:00:00.000Z';

function work(status: OrderStatus, roles: readonly ErpRole[]): Work {
  return orderWork({
    order: { id: 'o-1', status, updatedAt: CHANGED },
    roles,
    now: NOW,
  });
}

describe('orderWork, the acceptance cases', () => {
  it('a converted order is with the Production Manager', () => {
    expect(work('converted', ['Sales'])).toEqual({
      group: 'another-desk',
      next: 'Confirm the order',
      with: 'The Production Manager',
      desk: 'The Production Manager',
      ageFrom: CHANGED,
      href: '/orders/o-1',
    });
  });

  it("and is the Production Manager's own act, at the confirmation section", () => {
    expect(work('converted', ['ProductionManager'])).toEqual({
      group: 'yours',
      next: 'Confirm the order',
      with: 'You',

      desk: 'The Production Manager',
      ageFrom: CHANGED,
      href: '/orders/o-1#confirmation',
    });
  });
});

describe('orderWork, every status', () => {
  it('a confirmed order is done, for every reader', () => {
    for (const roles of [['Production'], ['Admin'], ['Sales']] as const) {
      expect(work('confirmed', roles)).toEqual({
        group: 'done',
        next: null,
        with: null,
        desk: null,
        ageFrom: CHANGED,
        href: '/orders/o-1',
      });
    }
  });

  it('gives every state the Next line can be in a row', () => {
    let rows = 0;
    for (const status of ORDER_STATUSES) {
      const line = orderNextStep({ status, roles: ALL_GATES });
      if (line === null) continue;
      expect(() => orderRow(line)).not.toThrow();
      rows += 1;
    }
    expect(rows).toBeGreaterThan(0);
  });
});

describe('orderWork, whose desk', () => {
  it("Admin beside Sales works the Sales desk: confirming is the Production Manager's", () => {
    expect(work('converted', ['Admin', 'Sales'])).toMatchObject({
      group: 'another-desk',
      with: 'The Production Manager',
    });
  });
});
