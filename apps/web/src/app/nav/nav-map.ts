// The top bar's map: five groups, their pages, and which roles see each one.
// Every group is open to every role, because reading is open to every signed-in user: docs/product/roles.md.
// Only Users and Roles are narrowed, to the Admin section's readers. The bar is drawn by apps/web/src/app/nav/top-bar.tsx.
import { ADMIN_SECTION_READ_ROLES, type ErpRole } from '@erp/types';

export interface NavItem {
  readonly label: string;
  readonly href: string;

  readonly roles?: readonly ErpRole[];
}

export interface NavGroup {
  readonly id: string;
  readonly label: string;

  readonly roles: readonly ErpRole[] | 'any';
  readonly items: readonly NavItem[];
}

export const QUOTES_HREF = '/quoting/quotes';

export const ORDERS_HREF = '/orders';

export const LEAD_TIMES_HREF = '/production/lead-times';

export const SETTINGS_HREF = '/quoting/grades';

export type NavCounts = Readonly<Partial<Record<string, number>>>;

export function itemCount(item: NavItem, counts: NavCounts = {}): number {
  return counts[item.href] ?? 0;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'home',

    label: 'Home',
    roles: 'any',
    items: [{ label: 'Your work', href: '/' }],
  },
  {
    id: 'sales',
    label: 'Sales',
    roles: 'any',
    items: [
      { label: 'Quotes', href: QUOTES_HREF },
      { label: 'Customers', href: '/crm/customers' },
    ],
  },
  {
    id: 'production',
    label: 'Production',
    roles: 'any',
    items: [
      { label: 'Orders', href: ORDERS_HREF },

      { label: 'Needs a lead time', href: LEAD_TIMES_HREF },
    ],
  },
  {
    id: 'approvals',
    label: 'Approvals',

    roles: 'any',
    items: [{ label: 'Inbox', href: '/approvals' }],
  },
  {
    id: 'settings',
    label: 'Settings',

    roles: 'any',
    items: [
      { label: 'Paper grades', href: SETTINGS_HREF },
      { label: 'Pricing tiers', href: '/quoting/tiers' },
      { label: 'Pricing constants', href: '/quoting/config' },
      { label: 'Tax rates', href: '/quoting/tax-rates' },
      { label: 'Users', href: '/admin/users', roles: ADMIN_SECTION_READ_ROLES },
      { label: 'Roles', href: '/admin/roles', roles: ADMIN_SECTION_READ_ROLES },
    ],
  },
];

export function visibleGroups(roles: readonly ErpRole[]): readonly NavGroup[] {
  const admits = (gate: readonly ErpRole[] | 'any'): boolean =>
    gate === 'any' || gate.some((role) => roles.includes(role));

  return NAV_GROUPS.filter((group) => group.items.length > 0 && admits(group.roles))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => admits(item.roles ?? group.roles)),
    }))
    .filter((group) => group.items.length > 0);
}

/** The longest matching page wins, so a nested route lands in its own group and `/` matches only itself. */
export function activeGroupId(pathname: string): string | undefined {
  let bestId: string | undefined;
  let bestLength = -1;

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const matches = item.href === '/' ? pathname === '/' : isUnder(pathname, item.href);
      if (matches && item.href.length > bestLength) {
        bestId = group.id;
        bestLength = item.href.length;
      }
    }
  }
  return bestId;
}

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isCurrentItem(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : isUnder(pathname, href);
}
