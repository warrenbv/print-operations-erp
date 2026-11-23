// Tests which desks each role sees and the queues each desk lists.
import { ERP_ROLES } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { DESKS, desksFor, queueId } from './desks';

const ids = (roles: Parameters<typeof desksFor>[0]) => desksFor(roles).map((desk) => desk.id);

describe('desksFor', () => {
  it.each([
    ['Sales', ['sales']],
    ['ProductionManager', ['production-manager']],
    ['Production', ['floor']],
    ['Billing', ['billing']],
  ] as const)('%s sees %o', (role, expected) => {
    expect(ids([role])).toEqual(expected);
  });

  it('a reader with several roles gets each desk, in table order', () => {
    expect(ids(['Billing', 'Sales'])).toEqual(['sales', 'billing']);
  });

  it('Admin alone sees every desk', () => {
    expect(ids(['Admin'])).toEqual(DESKS.map((desk) => desk.id));
  });

  it('Admin beside a desk role sees that desk only', () => {
    expect(ids(['Admin', 'Sales'])).toEqual(['sales']);
  });

  it('no roles, no desks', () => {
    expect(ids([])).toEqual([]);
  });

  it('every role but Admin has a desk', () => {
    const owned = new Set(DESKS.map((desk) => desk.role));
    expect(ERP_ROLES.filter((role) => !owned.has(role))).toEqual(['Admin']);
  });
});

describe('the queues', () => {
  it('are listed per desk, in order', () => {
    expect(
      Object.fromEntries(DESKS.map((desk) => [desk.title, desk.queues.map((q) => q.title)])),
    ).toEqual({
      Sales: [
        'Waiting on you',
        'Waiting on another desk',
        'Quoted, with the customer',
        "Your customers' confirmed orders",
        'Customers on credit hold',
      ],
      'Production Manager': ['Orders to confirm', 'Quotes needing a lead time'],
      'The floor': ['Quotes needing a lead time'],
      'Billing Manager': ['Price approvals', 'Exceptions'],
    });
  });

  it('are keyed by the title in kebab-case', () => {
    expect(queueId("Your customers' confirmed orders")).toBe('your-customers-confirmed-orders');
    expect(queueId('Quotes needing a lead time')).toBe('quotes-needing-a-lead-time');
    expect(DESKS.find((desk) => desk.id === 'sales')?.queues[0]).toEqual({
      id: 'waiting-on-you',
      title: 'Waiting on you',
    });
  });

  it('are unique within a desk', () => {
    for (const desk of DESKS) {
      expect(new Set(desk.queues.map((q) => q.id)).size).toBe(desk.queues.length);
    }
  });
});
