// Where a page lands when the API refuses a read with 403. apps/web/src/lib/fetch-parsed.ts sends it here.
// Most reads are open to every signed-in user (docs/product/roles.md). The Admin section is the narrowed one: packages/types/src/roles.ts.
import { COLOR, PageShell, WarnBanner } from '@erp/ui';

import { safeReturnPath } from '../../lib/api-outage';
import { forbiddenNotice } from '../../lib/forbidden-notice';

export const metadata = { title: forbiddenNotice().heading };

interface PageProps {
  searchParams: Promise<{ from?: string }>;
}

export default async function ForbiddenPage({ searchParams }: PageProps) {
  const { from } = await searchParams;
  const { heading, detail } = forbiddenNotice();

  return (
    <PageShell>
      <h1>{heading}</h1>

      <WarnBanner>{detail}</WarnBanner>
      <p>
        <a href={safeReturnPath(from)} style={{ color: COLOR.accent }}>
          Back
        </a>
      </p>
    </PageShell>
  );
}
