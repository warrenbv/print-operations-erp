// Tests the warnings for roles nobody holds.
import { ERP_ROLES, NOTIFYING_ROLES, type ErpRole, type RoleHolders } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { roleGapNote, unfilledDutyRoles, unfilledRoles, unfilledSummary } from './role-gaps';

const HOLDER = {
  externalId: 'local:dev-x',
  username: 'dev-x',
  displayName: 'dev-x',
  email: 'fixture-23@example.test',
};

function catalogWithout(...empty: readonly ErpRole[]): RoleHolders[] {
  return ERP_ROLES.map((role) => ({
    role,
    holders: empty.includes(role) ? [] : [HOLDER],
  }));
}

describe('unfilledRoles', () => {
  it('is empty when every role has somebody', () => {
    expect(unfilledRoles(catalogWithout())).toEqual([]);
  });

  it('names the roles with no holders, in catalog order', () => {
    expect(unfilledRoles(catalogWithout('ProductionManager', 'Sales'))).toEqual([
      'Sales',
      'ProductionManager',
    ]);
  });
});

describe('unfilledDutyRoles', () => {
  it('ignores an unfilled role that carries no notification duty', () => {
    expect(unfilledDutyRoles(catalogWithout('Sales'))).toEqual([]);
  });

  it('names an unfilled duty role', () => {
    expect(unfilledDutyRoles(catalogWithout('ProductionManager'))).toEqual(['ProductionManager']);
  });

  it('reads NOTIFYING_ROLES rather than a pair written down here', () => {
    expect(unfilledDutyRoles(catalogWithout(...NOTIFYING_ROLES))).toEqual([...NOTIFYING_ROLES]);
  });
});

describe('unfilledSummary', () => {
  it('says nothing when every role has a holder', () => {
    expect(unfilledSummary(catalogWithout())).toBeUndefined();
  });

  it('leads with the consequence for a duty role', () => {
    expect(unfilledSummary(catalogWithout('ProductionManager'))).toBe(
      'Nobody holds ProductionManager, so the alerts that role receives go nowhere. Grant it to somebody who should be told.',
    );
  });

  it('states an ordinary gap plainly, with no consequence claimed', () => {
    expect(unfilledSummary(catalogWithout('Sales'))).toBe('Nobody holds Sales.');
  });

  it('puts the duty roles first when both kinds are unfilled', () => {
    const summary = unfilledSummary(catalogWithout('Sales', 'ProductionManager')) ?? '';
    expect(summary.indexOf('ProductionManager')).toBeLessThan(summary.indexOf('Sales.'));
    expect(summary).toContain('Nobody holds Sales.');
  });

  it('lists three or more plain roles with commas', () => {
    expect(unfilledSummary(catalogWithout('Sales', 'Billing', 'Production'))).toBe(
      'Nobody holds Sales, Billing and Production.',
    );
  });
});

describe('roleGapNote', () => {
  it('says nothing for a role that has holders', () => {
    expect(roleGapNote({ role: 'ProductionManager', holders: [HOLDER] })).toBeUndefined();
  });

  it('names the delivery consequence on a duty role', () => {
    expect(roleGapNote({ role: 'ProductionManager', holders: [] })).toBe(
      'Nobody holds this role, so its alerts are not delivered to anyone.',
    );
  });

  it('claims no consequence on a role that is told nothing', () => {
    expect(roleGapNote({ role: 'Sales', holders: [] })).toBe('Nobody holds this role.');
  });
});
