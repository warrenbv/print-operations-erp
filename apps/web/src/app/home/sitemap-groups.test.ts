// Tests the page map's groups and who sees Users and roles.
import { describe, expect, it } from 'vitest';

import { SITEMAP, sitemapFor } from './sitemap-groups';

const labels = (roles: Parameters<typeof sitemapFor>[0]) =>
  sitemapFor(roles).flatMap((group) => group.items.map((item) => item.label));

describe('the site map', () => {
  it('groups the pages in the order the top bar draws them', () => {
    expect(SITEMAP.map((group) => group.label)).toEqual([
      'Sales',
      'Production',
      'Approvals',
      'Settings',
    ]);
    expect(SITEMAP.find((group) => group.label === 'Settings')?.items.map((i) => i.label)).toEqual([
      'Paper grades',
      'Pricing tiers',
      'Pricing constants',
      'Tax rates',
      'Users and roles',
    ]);
  });

  it('shows Users and roles to an Admin only', () => {
    expect(labels(['Admin'])).toContain('Users and roles');
    expect(labels(['Admin', 'Sales'])).toContain('Users and roles');
    expect(labels(['Sales'])).not.toContain('Users and roles');
    expect(labels([])).not.toContain('Users and roles');
  });

  it('keeps every other page for every reader', () => {
    expect(labels([])).toHaveLength(labels(['Admin']).length - 1);
  });

  it('links each page once, and never to the roles page (Users links to it)', () => {
    const hrefs = SITEMAP.flatMap((group) => group.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).not.toContain('/admin/roles');
  });
});
