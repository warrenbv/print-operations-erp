// Where a page lands when the session read gets no usable answer from the API. apps/web/src/lib/load-me.ts sends it here.
// It reads the session again on every load, and once the API answers it offers the way back to the page the person wanted.
import { COLOR, InfoBanner, PageShell, WarnBanner } from '@erp/ui';

import { API_SERVER_URL } from '../../lib/api-fetch';
import { outageNotice, safeReturnPath } from '../../lib/api-outage';
import { loadSessionOutcome } from '../../lib/load-me';

const ANSWERING_AGAIN = 'The API is answering again';

export async function generateMetadata() {
  const outcome = await loadSessionOutcome();
  if (outcome.kind === 'signed-in' || outcome.kind === 'signed-out') {
    return { title: ANSWERING_AGAIN };
  }
  return { title: outageNotice(outcome, API_SERVER_URL).heading };
}

interface PageProps {
  searchParams: Promise<{ from?: string }>;
}

export default async function ApiUnavailablePage({ searchParams }: PageProps) {
  const { from } = await searchParams;
  const back = safeReturnPath(from);
  const outcome = await loadSessionOutcome();

  if (outcome.kind === 'signed-in' || outcome.kind === 'signed-out') {
    return (
      <PageShell>
        <h1>{ANSWERING_AGAIN}</h1>

        <InfoBanner>
          Whatever was wrong has cleared. The page you wanted should load now.
        </InfoBanner>
        <p>
          <a href={back} style={{ color: COLOR.accent }}>
            Continue
          </a>
        </p>
      </PageShell>
    );
  }

  const { heading, detail } = outageNotice(outcome, API_SERVER_URL);

  return (
    <PageShell>
      <h1>{heading}</h1>

      <WarnBanner>{detail}</WarnBanner>
      <p>
        <a href={back} style={{ color: COLOR.accent }}>
          Try again
        </a>
      </p>
    </PageShell>
  );
}
