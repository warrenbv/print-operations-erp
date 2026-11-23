// Tests the order's Next line for each status and role.
import type { ErpRole, OrderStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { orderNextStep, type OrderNextStepInput } from './order-next-step';

const FLOOR: ErpRole[] = ['Production'];
const SALES: ErpRole[] = ['Sales'];

function input(overrides: Partial<OrderNextStepInput>): OrderNextStepInput {
  return {
    status: 'converted',
    roles: FLOOR,
    ...overrides,
  };
}

describe('orderNextStep, the production states', () => {
  it('asks Production to confirm a converted order, on this page', () => {
    expect(orderNextStep(input({}))).toEqual({
      sentence: 'confirm the order.',
      action: { href: '#confirmation', label: 'Confirm the order' },
    });
  });

  it('names the Production Manager, with no link, for anyone else', () => {
    expect(orderNextStep(input({ roles: SALES }))).toEqual({
      sentence: 'the Production Manager confirms the order.',
    });
  });
});

describe('orderNextStep, the ends', () => {
  it('says nothing once the order is confirmed', () => {
    for (const roles of [FLOOR, SALES]) {
      expect(orderNextStep(input({ status: 'confirmed', roles }))).toBeNull();
    }
  });

  it('keeps every sentence within the note budget', () => {
    const statuses: OrderStatus[] = ['converted', 'confirmed'];
    for (const status of statuses) {
      for (const roles of [FLOOR, SALES]) {
        const line = orderNextStep(input({ status, roles }));
        expect(line?.sentence.split(/\s+/).length ?? 0).toBeLessThanOrEqual(25);
      }
    }
  });
});
