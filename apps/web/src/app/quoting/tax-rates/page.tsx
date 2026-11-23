// Tax rates settings: the rate in force for each jurisdiction, and the form that loads a quarter's file.
// Rates are imported rows chosen by effective date, never edited in place: see the tax rates entry in docs/decisions/README.md.
// The load action is apps/web/src/app/quoting/tax-rates/actions.ts.
import {
  TAX_RATE_IMPORT_FORMATS,
  TAX_RATE_WRITE_ROLES,
  formatRatePercent,
  taxRateSummaryListResponseSchema,
  type TaxRateSummary,
} from '@erp/types';
import {
  Box,
  Button,
  COLOR,
  DataLine,
  EmptyState,
  ErrorBanner,
  Explainer,
  Field,
  FieldLabel,
  FONT_SIZE,
  Hint,
  InfoBanner,
  PageLede,
  PageShell,
  QueueCell,
  QueueTable,
  Section,
  Select,
  SPACE,
  WarnBanner,
  type QueueColumn,
} from '@erp/ui';

import { SETTINGS_HREF } from '../../nav/nav-map';
import { fetchParsed } from '../../../lib/fetch-parsed';
import { onlyDesk } from '../../../lib/helptext';
import { loadMe } from '../../../lib/load-me';

import { loadTaxRatesAction } from './actions';
import { RATE_PART_COLUMNS, RatePartCells } from './rate-part-cells';
import {
  resolveTaxRateSort,
  sortHeaders,
  sortSentence,
  sortTaxRates,
  type SortHeader,
} from './rate-sort';

export const metadata = { title: 'Tax rates' };

const BASE_PATH = '/quoting/tax-rates';

interface PageProps {
  searchParams: Promise<{ error?: string; notice?: string; sort?: string }>;
}

const FORMAT_LABELS: Record<(typeof TAX_RATE_IMPORT_FORMATS)[number], string> = {
  wa_dor_rates: 'Washington DOR quarterly release (Rates_YYQn.csv)',
  erp_rows: 'Rows typed here (jurisdiction, rate, effective from, source)',
};

export default async function TaxRatesPage({ searchParams }: PageProps) {
  const { error, notice, sort: sortParam } = await searchParams;
  const sort = resolveTaxRateSort(sortParam);

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Tax rates</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const rates = await fetchParsed('/quoting/tax-rates', taxRateSummaryListResponseSchema);
  // Hiding the form only spares other roles a refusal. The API enforces the role in
  // apps/api/src/quoting/tax-rates.controller.ts.
  const canWrite = TAX_RATE_WRITE_ROLES.some((role) => me.roles.includes(role));

  const stale = rates.items.filter((row) => row.stale);
  const washington = rates.items.filter((row) => row.jurisdiction.startsWith('WA-'));

  return (
    <PageShell>
      <p style={{ marginBottom: SPACE.md }}>
        <a href={SETTINGS_HREF} style={{ color: COLOR.accent }}>
          ← Settings
        </a>
      </p>
      <h1>Tax rates</h1>
      <PageLede>
        What each jurisdiction charges and since when. A rate is never edited; a change is a new
        row.
      </PageLede>

      <ErrorBanner message={error} />
      {notice !== undefined && notice !== '' && <InfoBanner>{notice}</InfoBanner>}

      {washington.length === 0 && (
        <WarnBanner>
          No Washington rate is loaded. A quote line taxed in a Washington jurisdiction is refused
          until one is, rather than taxed at 0%, because an unloaded jurisdiction and a tax-free one
          would otherwise look the same.
        </WarnBanner>
      )}

      {stale.length > 0 && (
        <WarnBanner>
          {stale.length === 1
            ? '1 jurisdiction is on a rate from before this quarter'
            : `${String(stale.length)} jurisdictions are on rates from before this quarter`}
          . The Washington DOR publishes quarterly, and the quarter beginning{' '}
          {rates.currentQuarterStart} has not been loaded for {stale.length === 1 ? 'it' : 'them'}.
        </WarnBanner>
      )}

      <Section title="Rates in force">
        {rates.items.length === 0 ? (
          <EmptyState>No rates are loaded at all.</EmptyState>
        ) : (
          <>
            <DataLine>{sortSentence(sort)}</DataLine>
            <div style={{ overflowX: 'auto' }}>
              <QueueTable
                columns={sortHeaders(BASE_PATH, sort).flatMap((header) =>
                  header.column === 'rate'
                    ? [...RATE_PART_COLUMNS, sortColumn(header)]
                    : [sortColumn(header)],
                )}
                caption={
                  <>
                    The rate in force on {rates.asOf}. A DOR rate from before{' '}
                    {rates.currentQuarterStart} is stale; a statute rate never is.
                  </>
                }
              >
                {sortTaxRates(rates.items, sort).map((row) => (
                  <TaxRateRow key={row.id} row={row} />
                ))}
              </QueueTable>
            </div>
          </>
        )}
      </Section>

      <Section
        title="Load a quarter"
        note={
          canWrite
            ? 'Check first. Checking writes nothing; loading writes the new rows and stops on a conflict.'
            : onlyDesk('the Billing Manager', 'loads a quarter')
        }
      >
        {canWrite && (
          <Box>
            <Explainer summary="Which file to load">
              Download the quarter from the{' '}
              <a
                href="https://dor.wa.gov/taxes-rates/sales-use-tax-rates/downloadable-database"
                style={{ color: COLOR.accent }}
              >
                Washington DOR downloadable database
              </a>{' '}
              and unzip it. Load the Rates file, the one keyed by location code, named like{' '}
              <code>Rates_YYQn.csv</code>. Do not load the address or ZIP+4 databases. They are
              hundreds of megabytes and carry no rates of their own.
            </Explainer>

            <form action={loadTaxRatesAction}>
              <Field>
                <FieldLabel>Layout</FieldLabel>

                <Select
                  name="format"
                  defaultValue="wa_dor_rates"
                  style={{ maxWidth: '100%', minWidth: 0 }}
                >
                  {TAX_RATE_IMPORT_FORMATS.map((format) => (
                    <option key={format} value={format}>
                      {FORMAT_LABELS[format]}
                    </option>
                  ))}
                </Select>
              </Field>

              <div style={{ marginTop: SPACE.lg }}>
                <Field>
                  <FieldLabel>File</FieldLabel>
                  <input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" />
                  <Hint>The unzipped CSV.</Hint>
                </Field>
              </div>

              <div style={{ marginTop: SPACE.lg }}>
                <Field>
                  <FieldLabel>or paste rows</FieldLabel>
                  <textarea
                    name="text"
                    rows={6}
                    style={{
                      width: '100%',
                      fontFamily: 'monospace',
                      fontSize: FONT_SIZE.sm,
                      padding: SPACE.sm,
                      border: `1px solid ${COLOR.border}`,
                      borderRadius: 4,
                    }}
                  />
                  <Hint>One rate per line. A ratio, so 8.5 percent is 0.085.</Hint>
                </Field>
              </div>

              <p style={{ marginTop: SPACE.xl, display: 'flex', gap: SPACE.md }}>
                <Button name="intent" value="check">
                  Check this file
                </Button>
                <Button name="intent" value="apply" variant="primary">
                  Load these rates
                </Button>
              </p>
            </form>
          </Box>
        )}
      </Section>
    </PageShell>
  );
}

function sortColumn(header: SortHeader): QueueColumn {
  const num = header.column === 'rate';

  if (header.direction === undefined) {
    return {
      label: (
        <a href={header.href} style={{ color: COLOR.accent }}>
          {header.label}
        </a>
      ),
      num,
    };
  }

  const ascending = header.direction === 'asc';
  return {
    label: (
      <a href={header.href} style={{ color: COLOR.accent }}>
        <strong>
          {header.label} <span aria-hidden="true">{ascending ? '▲' : '▼'}</span>
        </strong>
      </a>
    ),
    num,
    sort: ascending ? 'ascending' : 'descending',
  };
}

function TaxRateRow({ row }: { row: TaxRateSummary }) {
  return (
    <tr>
      <QueueCell>
        <a
          href={`/quoting/tax-rates/${encodeURIComponent(row.jurisdiction)}`}
          style={{ color: COLOR.accent }}
        >
          {row.jurisdiction}
        </a>
      </QueueCell>
      <QueueCell>{row.name ?? <span style={{ color: COLOR.muted }}>&mdash;</span>}</QueueCell>
      <RatePartCells row={row} />

      <QueueCell num>{formatRatePercent(row.rate)}</QueueCell>
      <QueueCell>{row.effectiveFrom}</QueueCell>
      <QueueCell>{row.source}</QueueCell>
      <QueueCell>
        {row.stale ? (
          <span style={{ color: COLOR.warning }}>stale</span>
        ) : (
          <span style={{ color: COLOR.muted }}>current</span>
        )}
      </QueueCell>
    </tr>
  );
}
