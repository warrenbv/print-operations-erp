// Tests which groups and pages each role sees, which group a path belongs to, and the names on the bar.
import { describe, expect, it } from 'vitest';

import {
  ADMIN_SECTION_READ_ROLES,
  ERP_ROLES,
  PRICE_OVERRIDE_APPROVAL_ROLES,
  type ErpRole,
} from '@erp/types';

import {
  LEAD_TIMES_HREF,
  NAV_GROUPS,
  ORDERS_HREF,
  QUOTES_HREF,
  SETTINGS_HREF,
  activeGroupId,
  isCurrentItem,
  itemCount,
  visibleGroups,
} from './nav-map';

const ids = (roles: readonly ErpRole[]): string[] => visibleGroups(roles).map((g) => g.id);

describe('what each role sees', () => {
  it('shows a user with no roles every group, not an error', () => {
    expect(ids([])).toEqual(['home', 'sales', 'production', 'approvals', 'settings']);
  });

  it.each(ERP_ROLES)('shows %s every group', (role) => {
    expect(ids([role])).toEqual(['home', 'sales', 'production', 'approvals', 'settings']);
  });

  it("restricts no group, and exactly two items, to the Admin section's gate", () => {
    expect(NAV_GROUPS.filter((group) => group.roles !== 'any')).toEqual([]);

    const restricted = NAV_GROUPS.flatMap((group) =>
      group.items.filter((item) => item.roles !== undefined).map((item) => ({ group, item })),
    );
    expect(restricted.map(({ group, item }) => [group.id, item.href])).toEqual([
      ['settings', '/admin/users'],
      ['settings', '/admin/roles'],
    ]);

    for (const { item } of restricted) {
      expect(item.roles, item.href).toBe(ADMIN_SECTION_READ_ROLES);
    }
  });

  it('offers Users and Roles to the Admin and to nobody else', () => {
    const settings = (roles: readonly ErpRole[]): string[] =>
      visibleGroups(roles)
        .find((g) => g.id === 'settings')
        ?.items.map((i) => i.href) ?? [];

    expect(settings(['Admin'])).toEqual([
      SETTINGS_HREF,
      '/quoting/tiers',
      '/quoting/config',
      '/quoting/tax-rates',
      '/admin/users',
      '/admin/roles',
    ]);

    const four = [SETTINGS_HREF, '/quoting/tiers', '/quoting/config', '/quoting/tax-rates'];
    for (const roles of [...ERP_ROLES.filter((r) => r !== 'Admin').map((r) => [r]), []]) {
      expect(settings(roles), `${roles[0] ?? 'a user with no roles'}`).toEqual(four);
    }

    expect(NAV_GROUPS.some((g) => g.id === 'admin')).toBe(false);
  });

  it('combines roles rather than picking one', () => {
    expect(ids(['Sales', 'Admin'])).toEqual([
      'home',
      'sales',
      'production',
      'approvals',
      'settings',
    ]);
    const settingsItems = (roles: readonly ErpRole[]): number =>
      visibleGroups(roles).find((g) => g.id === 'settings')?.items.length ?? 0;
    expect(settingsItems(['Sales', 'Admin'])).toBe(6);
    expect(settingsItems(['Sales'])).toBe(4);
  });

  it('never shows a group that has no items', () => {
    for (const role of ERP_ROLES) {
      const shown = visibleGroups([role]);
      expect(shown.every((group) => group.items.length > 0)).toBe(true);
    }

    expect(NAV_GROUPS.every((g) => g.items.length > 0)).toBe(true);
  });

  it('offers the approvals inbox to everyone and the decisions to nobody new', () => {
    const approvals = NAV_GROUPS.find((g) => g.id === 'approvals');
    expect(approvals?.roles).toBe('any');
    for (const role of ERP_ROLES) {
      expect(ids([role]), `${role} is not offered the inbox`).toContain('approvals');
    }
    expect(PRICE_OVERRIDE_APPROVAL_ROLES.length).toBeLessThan(ERP_ROLES.length);
  });
});

describe('the one approvals inbox is offered to every desk with business there', () => {
  const hrefs = (roles: readonly ErpRole[], groupId: string): string[] =>
    visibleGroups(roles)
      .find((g) => g.id === groupId)
      ?.items.map((i) => i.href) ?? [];

  it('offers the inbox to each audience that needs it — deciders and the desk that raises overrides', () => {
    expect(PRICE_OVERRIDE_APPROVAL_ROLES).not.toContain('ProductionManager');

    for (const role of ERP_ROLES) {
      expect(hrefs([role], 'approvals'), `${role}`).toEqual(['/approvals']);
    }
  });

  it('offers every role every group and every item but Users and Roles', () => {
    for (const role of ERP_ROLES) {
      const visible = visibleGroups([role]);
      expect(
        visible.map((g) => g.id),
        `${role} groups`,
      ).toEqual(NAV_GROUPS.map((g) => g.id));

      for (const group of NAV_GROUPS) {
        const shown = visible.find((g) => g.id === group.id);
        expect(
          shown?.items.map((i) => i.href),
          `${role} / ${group.id}`,
        ).toEqual(
          group.items
            .filter((i) => i.roles === undefined || i.roles.some((r) => r === role))
            .map((i) => i.href),
        );
      }
    }

    expect(NAV_GROUPS.length).toBe(5);

    expect(NAV_GROUPS.flatMap((g) => g.items)).toHaveLength(12);
  });

  it('offers all three pricing masters to every role', () => {
    const masters = ['/quoting/grades', '/quoting/config', '/quoting/tiers'];

    for (const role of [...ERP_ROLES, undefined]) {
      const settings = visibleGroups(role === undefined ? [] : [role]).find(
        (g) => g.id === 'settings',
      );
      for (const href of masters) {
        expect(
          settings?.items.map((i) => i.href),
          `${String(role)} / ${href}`,
        ).toContain(href);
      }
    }
  });

  it('never renders a heading with nothing under it', () => {
    for (const role of ERP_ROLES) {
      expect(visibleGroups([role]).every((g) => g.items.length > 0)).toBe(true);
    }
    expect(visibleGroups([]).every((g) => g.items.length > 0)).toBe(true);
  });
});

describe('which group the current path belongs to', () => {
  it.each([
    ['/', 'home'],
    ['/quoting/quotes', 'sales'],
    ['/crm/customers', 'sales'],
    ['/quoting/grades', 'settings'],
    ['/quoting/config', 'settings'],
    ['/quoting/tiers', 'settings'],
    ['/orders', 'production'],
    ['/production/lead-times', 'production'],
    ['/approvals', 'approvals'],
    ['/quoting/tax-rates', 'settings'],

    ['/quoting/tax-rates/WA-0202', 'settings'],
    ['/admin/users', 'settings'],
    ['/admin/roles', 'settings'],
  ])('puts %s in %s', (pathname, expected) => {
    expect(activeGroupId(pathname)).toBe(expected);
  });

  it('keeps a nested route in its own section', () => {
    expect(activeGroupId('/orders/01a021c1-8a26-70d1-9b9b-3f37b17d8b01')).toBe('production');
    expect(activeGroupId('/quoting/quotes/abc/convert')).toBe('sales');
    expect(activeGroupId('/crm/customers/abc/contacts')).toBe('sales');
  });

  it('does not let Home swallow every path', () => {
    expect(activeGroupId('/orders')).not.toBe('home');
    expect(activeGroupId('/')).toBe('home');
  });

  it('does not match a sibling route that merely starts the same way', () => {
    expect(activeGroupId('/orders-archive')).toBeUndefined();
  });

  it('returns nothing for a path the map does not cover', () => {
    expect(activeGroupId('/login')).toBeUndefined();
    expect(activeGroupId('/nowhere')).toBeUndefined();
  });
});

describe('marking the current item', () => {
  it('marks the item the reader is on, including its nested routes', () => {
    expect(isCurrentItem('/orders', '/orders')).toBe(true);
    expect(isCurrentItem('/orders/abc', '/orders')).toBe(true);
    expect(isCurrentItem('/orders-archive', '/orders')).toBe(false);
  });

  it('marks Home only on Home', () => {
    expect(isCurrentItem('/', '/')).toBe(true);
    expect(isCurrentItem('/orders', '/')).toBe(false);
  });
});

describe('itemCount', () => {
  const leadTimes = { label: 'Needs a lead time', href: LEAD_TIMES_HREF };

  it('reads the count for its own href', () => {
    expect(itemCount(leadTimes, { [LEAD_TIMES_HREF]: 3 })).toBe(3);
  });

  it('is zero with no count read, and for an item the counts do not name', () => {
    expect(itemCount(leadTimes)).toBe(0);
    expect(itemCount({ label: 'Orders', href: ORDERS_HREF }, { [LEAD_TIMES_HREF]: 3 })).toBe(0);
  });

  it('never puts the count in the label: the top bar draws it as a badge', () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(item.label, item.href).not.toMatch(/\(\d+\)/);
      }
    }
  });
});

describe('the page names', () => {
  const labels = (id: string): string[] =>
    NAV_GROUPS.find((group) => group.id === id)?.items.map((item) => item.label) ?? [];

  it('names the Home page Your work, in a group still called Home', () => {
    const home = NAV_GROUPS.find((group) => group.id === 'home');
    expect(home?.label).toBe('Home');
    expect(home?.items).toEqual([{ label: 'Your work', href: '/' }]);
  });

  it('lists the Production pages in order, under their page names', () => {
    expect(
      NAV_GROUPS.find((group) => group.id === 'production')?.items.map((item) => [
        item.label,
        item.href,
      ]),
    ).toEqual([
      ['Orders', ORDERS_HREF],
      ['Needs a lead time', LEAD_TIMES_HREF],
    ]);
  });

  it('lists the Settings pages in order, under their page names', () => {
    expect(
      NAV_GROUPS.find((group) => group.id === 'settings')?.items.map((item) => [
        item.label,
        item.href,
      ]),
    ).toEqual([
      ['Paper grades', SETTINGS_HREF],
      ['Pricing tiers', '/quoting/tiers'],
      ['Pricing constants', '/quoting/config'],
      ['Tax rates', '/quoting/tax-rates'],
      ['Users', '/admin/users'],
      ['Roles', '/admin/roles'],
    ]);
  });

  it('puts Settings last in the top row', () => {
    expect(NAV_GROUPS.at(-1)?.id).toBe('settings');
    expect(NAV_GROUPS.at(-1)?.label).toBe('Settings');
  });

  it('leaves Sales with its two daily pages', () => {
    expect(labels('sales')).toEqual(['Quotes', 'Customers']);
  });

  it('names no item after the Home group or a page this application does not have', () => {
    const all = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.label));
    for (const unused of [
      'Home',
      'Orders board',
      'Production dashboard',
      'Inventory',
      'Fulfilment',
    ]) {
      expect(all, unused).not.toContain(unused);
    }
  });

  it('puts every counted queue in the group whose row draws it', () => {
    expect(labels('sales')).toContain('Quotes');
    expect(activeGroupId(QUOTES_HREF)).toBe('sales');
    for (const href of [ORDERS_HREF, LEAD_TIMES_HREF]) {
      expect(activeGroupId(href), href).toBe('production');
    }
  });
});
