// The map of every page at the foot of Your work. The groups are in apps/web/src/app/home/sitemap-groups.ts.
import type { ErpRole } from '@erp/types';
import { COLOR, FONT_SIZE, QueueCard, QueueCardRow, Section } from '@erp/ui';

import { QueueGrid } from './queue-grid';
import { sitemapFor } from './sitemap-groups';

export function Sitemap({ roles }: { roles: readonly ErpRole[] }) {
  return (
    <Section title="Everywhere else">
      <QueueGrid>
        {sitemapFor(roles).map((group) => (
          <QueueCard key={group.label} title={group.label}>
            {group.items.map((item) => (
              <QueueCardRow key={item.href} href={item.href}>
                {item.label}
              </QueueCardRow>
            ))}
          </QueueCard>
        ))}
      </QueueGrid>
      <p style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm }}>
        Every page is still here. Settings holds the pages you set up once and rarely change.
      </p>
    </Section>
  );
}
