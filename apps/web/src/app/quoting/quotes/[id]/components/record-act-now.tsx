// The Act now panel of a quote's record, the orders made from it, and the banner for a PO document that was not attached.
// The panel says whose move it is: docs/product/requirements.md (R12).
import type { QuoteWithLines } from '@erp/types';
import {
  ActNow,
  ActRow,
  ButtonReason,
  COLOR,
  DangerBanner,
  LinkButton,
  QueueCell,
  QueueTable,
  RowLink,
  Section,
} from '@erp/ui';

import type { MissingDocumentRow, QuotePanel, QuoteOrderRow } from '../record';

export function QuoteActNow({
  panel,
  quote,
  currentVersion,
}: {
  panel: QuotePanel;
  quote: QuoteWithLines;

  currentVersion: { readonly id: string; readonly versionNumber: number } | undefined;
}) {
  const quotePath = `/quoting/quotes/${encodeURIComponent(quote.id)}`;
  const convertHref = `${quotePath}/convert`;
  return (
    <ActNow tone={panel.tone} title={panel.title} who={panel.who} id="act-now">
      <PanelBody
        panel={panel}
        quote={quote}
        convertHref={convertHref}
        currentVersion={currentVersion}
      />
    </ActNow>
  );
}

const ORDER_COLUMNS = [
  { label: 'Order' },
  { label: 'PO number' },
  { label: 'Delivery date' },
  { label: 'Lines' },
  { label: 'Status' },
] as const;

export function OrdersFromThisQuote({ rows }: { rows: readonly QuoteOrderRow[] }) {
  return (
    <Section id="orders" title="Orders from this quote">
      <QueueTable columns={ORDER_COLUMNS}>
        {rows.map((row) => (
          <tr key={row.id}>
            <QueueCell>
              <RowLink href={row.href}>{row.name}</RowLink>
            </QueueCell>
            <QueueCell>{row.poNumber}</QueueCell>
            <QueueCell>{row.deliveryDate}</QueueCell>
            <QueueCell>
              {row.lines.map((line, index) => (
                <span key={line}>
                  {index > 0 && <br />}
                  {line}
                </span>
              ))}
            </QueueCell>
            <QueueCell>{row.status}</QueueCell>
          </tr>
        ))}
      </QueueTable>
    </Section>
  );
}

export function MissingDocumentBanner({
  message,
  rows,
}: {
  message: string | undefined;
  rows: readonly MissingDocumentRow[];
}) {
  return (
    <DangerBanner>
      {message}
      {rows.map((row) => (
        <span key={row.id}>
          <br />
          <a href={row.href} style={{ color: COLOR.accent }}>
            {row.name}
          </a>
        </span>
      ))}
    </DangerBanner>
  );
}

function PanelBody({
  panel,
  quote,
  convertHref,
  currentVersion,
}: {
  panel: QuotePanel;
  quote: QuoteWithLines;
  convertHref: string;
  currentVersion: { readonly id: string; readonly versionNumber: number } | undefined;
}) {
  switch (panel.variant) {
    case 'convert':
      return (
        <ActRow>
          <LinkButton href={convertHref} variant="primary">
            Convert to order
          </LinkButton>
          <ButtonReason>
            The next page takes the customer&rsquo;s PO number, if they gave one.
          </ButtonReason>
        </ActRow>
      );

    case 'waiting':
      return (
        <p style={{ margin: 0 }}>
          Anyone may convert it when the customer says yes.{' '}
          <a href={convertHref} style={{ color: COLOR.accent }}>
            Convert to order
          </a>
        </p>
      );

    case 'orders':
      return quote.status === 'quoted' ? (
        <ActRow>
          <LinkButton href={convertHref} variant="primary">
            Create another order
          </LinkButton>
        </ActRow>
      ) : (
        <CurrentVersionLink currentVersion={currentVersion} />
      );

    case 'superseded':
      return <CurrentVersionLink currentVersion={currentVersion} />;

    case 'closed':
      return null;
  }
}

function CurrentVersionLink({
  currentVersion,
}: {
  currentVersion: { readonly id: string; readonly versionNumber: number } | undefined;
}) {
  return currentVersion === undefined ? null : (
    <p style={{ margin: 0 }}>
      <a href={`/quoting/quotes/${currentVersion.id}`} style={{ color: COLOR.accent }}>
        View the current version (v{currentVersion.versionNumber})
      </a>
    </p>
  );
}
