// The error boundary for every page. It is the one client component, because the framework requires
// error boundaries to be client components: docs/decisions/004-server-first-web-ui.md.
// A client component cannot export metadata, so it renders its own title element.
// apps/web/src/app/every-page-has-a-title.test.ts checks that element.
'use client';

import { COLOR, PageShell, WarnBanner } from '@erp/ui';

import { pageErrorNotice } from '../lib/page-error';
import { fullTitle } from '../lib/titles';

export default function PageError({ error }: { error: Error & { digest?: string } }) {
  const { heading, detail, reference } = pageErrorNotice(error.digest);

  return (
    <PageShell>
      <title>{fullTitle(heading)}</title>
      <h1>{heading}</h1>

      <WarnBanner>{detail}</WarnBanner>
      <p>
        <a href="/" style={{ color: COLOR.accent }}>
          Back to Your work
        </a>
      </p>
      {reference !== undefined && (
        <p style={{ color: COLOR.muted }}>Reference {reference} — quote this if you report it.</p>
      )}
    </PageShell>
  );
}
