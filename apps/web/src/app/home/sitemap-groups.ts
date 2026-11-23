// The groups and links of the page map on Your work. Users and roles shows to an Admin only,
// as on the top bar in apps/web/src/app/nav/nav-map.ts.
import type { ErpRole } from '@erp/types';

interface SitemapItem {
  readonly label: string;
  readonly href: string;

  readonly only?: ErpRole;
}

export interface SitemapGroup {
  readonly label: string;
  readonly items: readonly SitemapItem[];
}

export const SITEMAP: readonly SitemapGroup[] = [
  {
    label: 'Sales',
    items: [
      { label: 'Quotes', href: '/quoting/quotes' },
      { label: 'Customers', href: '/crm/customers' },
    ],
  },
  {
    label: 'Production',
    items: [{ label: 'Orders', href: '/orders' }],
  },
  {
    label: 'Approvals',
    items: [{ label: 'Price approvals and exceptions', href: '/approvals#price-approvals' }],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Paper grades', href: '/quoting/grades' },
      { label: 'Pricing tiers', href: '/quoting/tiers' },
      { label: 'Pricing constants', href: '/quoting/config' },
      { label: 'Tax rates', href: '/quoting/tax-rates' },
      { label: 'Users and roles', href: '/admin/users', only: 'Admin' },
    ],
  },
];

export function sitemapFor(roles: readonly ErpRole[]): readonly SitemapGroup[] {
  return SITEMAP.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.only === undefined || roles.includes(item.only)),
  }));
}
