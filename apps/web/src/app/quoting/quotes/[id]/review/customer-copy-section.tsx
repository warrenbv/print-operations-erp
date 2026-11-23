// Renders the customer's copy built by apps/web/src/app/quoting/quotes/[id]/review/customer-copy.ts.
import { formatQuoteNumber, type QuoteWithLines } from '@erp/types';
import { COLOR, FONT_SIZE, QueueCell, QueueTable, RADIUS, SPACE } from '@erp/ui';

import { API_BASE_URL } from '../../../../../lib/api-fetch';
import { PdfLink } from '../../../../../lib/pdf-link';
import type { CustomerCopy } from './customer-copy';

export function CustomerCopySection({
  quote,
  copy,
  title,
  printable,
  change,
}: {
  quote: QuoteWithLines;
  copy: CustomerCopy;

  title: string;

  printable: boolean;

  change?: { readonly linesHref: string; readonly deliveryHref: string } | undefined;
}) {
  const date = copy.rows.find((row) => row.label === 'Date')?.value;
  return (
    <section aria-labelledby="copy-heading" style={{ marginTop: SPACE.xxl }}>
      <h2 id="copy-heading" style={{ fontSize: FONT_SIZE.lg, marginBottom: SPACE.md }}>
        {title}
      </h2>
      <div
        style={{
          border: `1px solid ${COLOR.border}`,
          borderRadius: RADIUS,
          background: COLOR.page,
          padding: `${SPACE.xl} 1.25rem`,
          display: 'grid',
          gap: SPACE.lg,
        }}
      >
        <div style={{ display: 'flex', gap: SPACE.lg, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <b>{copy.letterhead.nameLines.join(' ')}</b>
            <div style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm }}>
              {copy.letterhead.detailLines.join(' · ')}
            </div>
          </div>
          <span style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm, marginLeft: 'auto' }}>
            Quote {formatQuoteNumber(quote.quoteNumber)} · version {quote.versionNumber}
            {date === undefined ? '' : ` · ${date}`}
          </span>
        </div>

        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            columnGap: SPACE.xl,
            rowGap: SPACE.xs,
            margin: 0,
          }}
        >
          {copy.rows.map((row) => (
            <div key={row.label} style={{ display: 'contents' }}>
              <dt style={{ color: COLOR.muted }}>{row.label}</dt>
              <dd style={{ margin: 0 }}>{row.value}</dd>
            </div>
          ))}
        </dl>

        <div style={{ overflowX: 'auto', minWidth: 0 }}>
          <QueueTable
            columns={copy.columns.map((column) => ({
              label: column.label,
              num: column.align === 'right',
            }))}
          >
            {copy.lines.map((line) => (
              <tr key={line.line}>
                {copy.columns.map((column) => (
                  <QueueCell key={column.key} num={column.align === 'right'}>
                    {line[column.key]}
                  </QueueCell>
                ))}
              </tr>
            ))}
          </QueueTable>
        </div>

        {copy.notices.map((notice) => (
          <p key={notice} style={{ margin: 0, fontSize: FONT_SIZE.sm }}>
            {notice}
          </p>
        ))}

        <p style={{ margin: 0, textAlign: 'right' }}>
          {copy.total.label}: <b>{copy.total.value}</b>
        </p>

        {copy.notes !== undefined && (
          <p style={{ margin: 0 }}>
            <b>Notes</b> {copy.notes}
          </p>
        )}
      </div>

      {(printable || change !== undefined) && (
        <p style={{ display: 'flex', gap: SPACE.xl, flexWrap: 'wrap', marginTop: SPACE.md }}>
          {printable && (
            <PdfLink
              href={`${API_BASE_URL}/quoting/quotes/${encodeURIComponent(quote.id)}/document`}
            >
              Open the PDF
            </PdfLink>
          )}
          {change !== undefined && (
            <>
              <a href={change.linesHref} style={{ color: COLOR.accent }}>
                Change the lines (step 2)
              </a>
              <a href={change.deliveryHref} style={{ color: COLOR.accent }}>
                Change delivery and tax (step 3)
              </a>
            </>
          )}
        </p>
      )}
    </section>
  );
}
