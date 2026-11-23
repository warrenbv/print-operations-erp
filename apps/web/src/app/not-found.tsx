// The page for a route or record that does not exist. Its words are in apps/web/src/lib/not-found-notice.ts.
import { COLOR, InfoBanner, PageShell } from '@erp/ui';

import { notFoundNotice } from '../lib/not-found-notice';

export const metadata = { title: notFoundNotice().heading };

export default function NotFound() {
  const { heading, detail } = notFoundNotice();

  return (
    <PageShell>
      <h1>{heading}</h1>

      <InfoBanner>{detail}</InfoBanner>
      <p>
        <a href="/" style={{ color: COLOR.accent }}>
          Back to Your work
        </a>
      </p>
    </PageShell>
  );
}
