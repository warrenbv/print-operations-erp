// Tests for the role catalogue and the role list behind each act: packages/types/src/roles.ts.
// The last block classifies every exported list as a read or a write gate, so a new list cannot arrive unclassified.
// Reading is open to every signed-in user (docs/product/roles.md). A read gate that stops admitting every role fails
// unless it is named with its reason, and so does a write gate that admits every role. A failure means an API guard
// or a page would now admit the wrong desks.
import { describe, expect, it } from 'vitest';

import * as roles from '../src/roles';
import {
  ADMIN_SECTION_READ_ROLES,
  CUSTOMER_DEFAULTS_WRITE_ROLES,
  ERP_ROLES,
  erpRoleSchema,
  FLOOR_OVERRIDE_ROLES,
  isErpRole,
  PRICE_OVERRIDE_APPROVAL_ROLES,
  SALES_WRITE_ROLES,
} from '../src/roles';

describe('ERP_ROLES', () => {
  it('is exactly the catalog documented in docs/product/roles.md', () => {
    expect(ERP_ROLES).toEqual(['Sales', 'Billing', 'Production', 'ProductionManager', 'Admin']);
  });

  it('has no duplicates', () => {
    expect(new Set(ERP_ROLES).size).toBe(ERP_ROLES.length);
  });
});

describe('erpRoleSchema', () => {
  it.each(ERP_ROLES)('accepts %s', (role) => {
    expect(erpRoleSchema.parse(role)).toBe(role);
  });

  it.each([['admin'], ['ADMIN'], ['Superuser'], ['']])('rejects %p', (value) => {
    expect(erpRoleSchema.safeParse(value).success).toBe(false);
  });
});

describe('isErpRole', () => {
  it('narrows a value from the catalog', () => {
    expect(isErpRole('Admin')).toBe(true);
  });

  it('rejects a role that is not in the catalog', () => {
    expect(isErpRole('Sorcerer')).toBe(false);
  });
});

describe('SALES_WRITE_ROLES', () => {
  it('is exactly Sales and Admin', () => {
    expect(SALES_WRITE_ROLES).toEqual(['Sales', 'Admin']);
  });

  it('admits nobody else in the catalog', () => {
    const admitted = ERP_ROLES.filter((role) =>
      (SALES_WRITE_ROLES as readonly string[]).includes(role),
    );
    expect(admitted).toEqual(['Sales', 'Admin']);
  });

  it('admits a role exactly when it is Sales or Admin', () => {
    for (const role of ERP_ROLES) {
      const hand = role === 'Sales' || role === 'Admin';
      expect((SALES_WRITE_ROLES as readonly string[]).includes(role)).toBe(hand);
    }
  });
});

describe('PRICE_OVERRIDE_APPROVAL_ROLES', () => {
  it('puts the decision with the Billing Manager', () => {
    expect(PRICE_OVERRIDE_APPROVAL_ROLES).toEqual(['Billing', 'Admin']);
  });

  it('keeps break-glass, because Admin is not a job', () => {
    expect(PRICE_OVERRIDE_APPROVAL_ROLES).toContain('Admin');
  });

  it('does not admit the role that sets the price', () => {
    for (const role of SALES_WRITE_ROLES) {
      if (role === 'Admin') continue;
      expect(PRICE_OVERRIDE_APPROVAL_ROLES).not.toContain(role);
    }
  });

  it('every member is a real role', () => {
    for (const role of PRICE_OVERRIDE_APPROVAL_ROLES) {
      expect(isErpRole(role)).toBe(true);
    }
  });
});

describe('FLOOR_OVERRIDE_ROLES', () => {
  it('is Admin alone', () => {
    expect(FLOOR_OVERRIDE_ROLES).toEqual(['Admin']);
  });

  it('admits neither the Billing Manager nor Sales', () => {
    expect(FLOOR_OVERRIDE_ROLES).not.toContain('Billing');
    expect(FLOOR_OVERRIDE_ROLES).not.toContain('Sales');
    const admitted = ERP_ROLES.filter((role) =>
      (FLOOR_OVERRIDE_ROLES as readonly string[]).includes(role),
    );
    expect(admitted).toEqual(['Admin']);
  });
});

describe('CUSTOMER_DEFAULTS_WRITE_ROLES', () => {
  it('is Sales, Billing and Admin', () => {
    expect(CUSTOMER_DEFAULTS_WRITE_ROLES).toEqual(['Sales', 'Billing', 'Admin']);
  });

  it('admits nobody else in the catalog, and Billing stays out of the Sales gate', () => {
    const admitted = ERP_ROLES.filter((role) =>
      (CUSTOMER_DEFAULTS_WRITE_ROLES as readonly string[]).includes(role),
    );
    expect(admitted).toEqual(['Sales', 'Billing', 'Admin']);
    expect(SALES_WRITE_ROLES).not.toContain('Billing');
  });
});

describe('every read gate admits every role', () => {
  type GateKind = 'read' | 'write' | 'not-a-gate';

  const GATE_KIND: Record<string, GateKind> = {
    ERP_ROLES: 'not-a-gate',

    NOTIFYING_ROLES: 'not-a-gate',

    ADMIN_SECTION_READ_ROLES: 'read',

    CREDIT_HOLD_ROLES: 'write',

    ORDER_CONFIRMATION_SEND_ROLES: 'write',
    PRICE_OVERRIDE_APPROVAL_ROLES: 'write',
    PRICING_CONFIG_WRITE_ROLES: 'write',
    ORDER_CONFIRM_ROLES: 'write',
    QUOTE_LEAD_TIME_ROLES: 'write',
    SALES_WRITE_ROLES: 'write',
    TAX_RATE_WRITE_ROLES: 'write',

    FLOOR_OVERRIDE_ROLES: 'write',

    CUSTOMER_DEFAULTS_WRITE_ROLES: 'write',
  };

  const WRITE_GATES_OPEN_TO_EVERY_ROLE: readonly string[] = ['ORDER_CONFIRMATION_SEND_ROLES'];

  const NARROWED_READ_GATES: Record<string, string> = {
    ADMIN_SECTION_READ_ROLES: 'the Admin section is Admin-only',
  };

  const moduleExports = roles as unknown as Record<string, unknown>;

  const exported = Object.entries(moduleExports).filter(
    (entry): entry is [string, readonly string[]] =>
      entry[0].endsWith('_ROLES') && Array.isArray(entry[1]),
  );

  it('classifies every exported role list, so a new one cannot slip in unclassified', () => {
    expect(exported.map(([name]) => name).sort()).toEqual(Object.keys(GATE_KIND).sort());
  });

  const readGates = exported.filter(([name]) => GATE_KIND[name] === 'read');

  const openReadGates = readGates.filter(([name]) => !(name in NARROWED_READ_GATES));

  it.each(openReadGates.map(([name, list]): [string, readonly string[]] => [name, list]))(
    '%s admits every role in the catalog',
    (name, list) => {
      for (const role of ERP_ROLES) {
        expect(list, `${name} does not admit ${role}`).toContain(role);
      }
    },
  );

  it.each(openReadGates.map(([name, list]): [string, readonly string[]] => [name, list]))(
    '%s is exactly the catalog, which is the tripwire',
    (name, list) => {
      expect([...list].sort(), `${name} is not the whole catalog`).toEqual([...ERP_ROLES].sort());
    },
  );

  it('has one read gate, and it is a narrowed one', () => {
    expect(readGates).toHaveLength(1);

    expect(openReadGates).toHaveLength(0);
  });

  describe('read gates narrower than the catalog', () => {
    const narrowed = Object.keys(NARROWED_READ_GATES);

    it('names only gates that exist and are classified as reads', () => {
      const classified = readGates.map(([name]) => name);
      const orphaned = narrowed.filter((name) => !classified.includes(name));
      expect(orphaned, 'exempted but not an exported read gate').toEqual([]);
    });

    it('gives every exemption a reason to point at', () => {
      for (const [name, reason] of Object.entries(NARROWED_READ_GATES)) {
        expect(reason.trim(), `${name} has no reason recorded`).not.toBe('');
      }
    });

    it('keeps each one genuinely narrower than the catalog', () => {
      for (const [name, list] of readGates) {
        if (!(name in NARROWED_READ_GATES)) continue;
        expect(list.length, `${name} is exempt but admits every role`).toBeLessThan(
          ERP_ROLES.length,
        );
      }
    });

    it('puts the Admin section with Admin alone', () => {
      expect(ADMIN_SECTION_READ_ROLES).toEqual(['Admin']);
    });

    it('admits nobody else in the catalog', () => {
      const admitted = ERP_ROLES.filter((role) =>
        (ADMIN_SECTION_READ_ROLES as readonly string[]).includes(role),
      );
      expect(admitted).toEqual(['Admin']);
    });

    it('is classified as a read gate', () => {
      expect(GATE_KIND.ADMIN_SECTION_READ_ROLES).toBe('read');
    });
  });

  it('keeps every write gate narrower than the catalog, except the named ones', () => {
    const writeGates = exported.filter(([name]) => GATE_KIND[name] === 'write');

    expect(writeGates.length).toBeGreaterThanOrEqual(7);

    for (const [name, list] of writeGates) {
      if (WRITE_GATES_OPEN_TO_EVERY_ROLE.includes(name)) continue;
      expect(list.length, `${name} admits every role`).toBeLessThan(ERP_ROLES.length);
    }
  });

  it('names every write gate that admits the whole catalog, and only those', () => {
    const wide = exported
      .filter(([name]) => GATE_KIND[name] === 'write')
      .filter(([, list]) => [...list].sort().join() === [...ERP_ROLES].sort().join())
      .map(([name]) => name);
    expect(wide).toEqual(WRITE_GATES_OPEN_TO_EVERY_ROLE);
  });

  it('every member of every gate is a real role', () => {
    for (const [name, list] of exported) {
      if (name === 'ERP_ROLES') continue;
      for (const role of list) {
        expect(isErpRole(role), `${name} contains ${role}`).toBe(true);
      }
    }
  });
});
