// Every rate one tax jurisdiction has carried, newest first.
import { formatRatePercent, taxRateListResponseSchema } from '@erp/types';
import {
  COLOR,
  EmptyState,
  PageLede,
  PageShell,
  QueueCell,
  QueueTable,
  SPACE,
  Section,
} from '@erp/ui';

import { fetchParsed } from '../../../../lib/fetch-parsed';
import { loadMe } from '../../../../lib/load-me';
import { RATE_PART_COLUMNS, RatePartCells } from '../rate-part-cells';

interface PageProps {
  params: Promise<{ jurisdiction: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { jurisdiction } = await params;
  return { title: decodeURIComponent(jurisdiction) };
}

export default async function TaxRateHistoryPage({ params }: PageProps) {
  const { jurisdiction } = await params;
  const code = decodeURIComponent(jurisdiction);

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Tax rate history</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const history = await fetchParsed(
    `/quoting/tax-rates/${encodeURIComponent(code)}/history`,
    taxRateListResponseSchema,
  );

  return (
    <PageShell>
      <p style={{ marginBottom: SPACE.md }}>
        <a href="/quoting/tax-rates" style={{ color: COLOR.accent }}>
          ← Tax rates
        </a>
      </p>
      <h1>{code}</h1>
      <PageLede>Every rate this jurisdiction has carried, newest first.</PageLede>

      <Section title="Every rate on file">
        {history.items.length === 0 ? (
          <EmptyState>
            Nothing is on file for {code}. A quote line naming this jurisdiction is refused rather
            than taxed at 0%.
          </EmptyState>
        ) : (
          <QueueTable
            columns={[
              { label: 'Effective from' },
              ...RATE_PART_COLUMNS,
              { label: 'Rate', num: true },
              { label: 'Name' },
              { label: 'Source' },
            ]}
            caption="Each row supersedes the one below it from its effective date."
          >
            {history.items.map((row) => (
              <tr key={row.id}>
                <QueueCell>{row.effectiveFrom}</QueueCell>
                <RatePartCells row={row} />
                <QueueCell num>{formatRatePercent(row.rate)}</QueueCell>
                <QueueCell>
                  {row.name ?? <span style={{ color: COLOR.muted }}>&mdash;</span>}
                </QueueCell>
                <QueueCell>{row.source}</QueueCell>
              </tr>
            ))}
          </QueueTable>
        )}
      </Section>
    </PageShell>
  );
}
