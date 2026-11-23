// The convert page: the customer's PO number and document, and one column of quantities per delivery.
// Converting creates orders that keep the quote's terms: docs/product/requirements.md (R9).
// Any signed-in user may do it: docs/product/requirements.md (R10) and docs/product/decisions.md.
import { randomUUID } from 'node:crypto';

import { notFound } from 'next/navigation';

import {
  quoteWithLinesSchema,
  formatWidthIn,
  type Grade,
  type QuoteLine,
  quoteReference,
} from '@erp/types';
import {
  Button,
  COLOR,
  DL,
  DangerBanner,
  ErrorBanner,
  Field,
  FieldLabel,
  FONT_SIZE,
  Hint,
  Input,
  PageLede,
  PageShell,
  Section,
  SectionNote,
  SPACE,
  TableScroll,
} from '@erp/ui';

import { submitted } from '../../../../../lib/form-echo';
import { RECEIVED_DOCUMENT_HINT } from '../../../../../lib/helptext';
import { loadMe } from '../../../../../lib/load-me';
import { formatOrderedPounds } from '../../../../../lib/measures';
import { loadCustomerName } from '../../../customer-names';
import { PRODUCT_FAMILY_LABELS } from '../../../format';
import { loadGrades } from '../../../load-grades';
import { SalesRepName } from '../../../../../lib/sales-rep-name';
import { loadResolvedRep } from '../../../../../lib/sales-reps';
import { addDeliveryAction, convertQuoteAction, removeDeliveryAction } from './actions';
import {
  AT_CAPACITY,
  DELIVERIES_FIELD,
  boxesFor,
  columnsOf,
  convertField,
  deliveryCount,
  gridLines,
  maxDeliveries,
  overWords,
  quotedPriceWords,
  type GridLine,
} from './convert-grid';
import { loadOrderedSoFar, loadQuote } from './loaders';
import { recordTitle } from '../../../../../lib/record-title';
import { SUBMISSION_TOKEN_FIELD, mintSubmissionToken } from '../../../../../lib/submission-token';

interface PageProps {
  params: Promise<{ id: string }>;

  searchParams: Promise<{ error?: string; [key: string]: string | string[] | undefined }>;
}

const PO_DOCUMENT_HINT = `Optional. ${RECEIVED_DOCUMENT_HINT} A chosen file is not kept when you add or remove a delivery: choose it just before you create.`;

const CREATE_NOTE = {
  one: 'Makes one order from the boxes above, with the PO number and the PO document if you gave them.',
  several:
    'Makes one order for each delivery above, each with the PO number and the PO document if you gave them.',
} as const;

const OUT_OF_SIGHT = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const title = await recordTitle(
    `/quoting/quotes/${encodeURIComponent(id)}`,
    quoteWithLinesSchema,
    (quote) => `Create orders from quote ${quoteReference(quote)}`,
    'Create orders',
  );
  return { title };
}

export default async function ConvertQuotePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const { error } = query;

  const mePromise = loadMe();
  const wave1 = Promise.all([loadQuote(id), loadGrades()]);
  // The reads start before the session check finishes. The empty catch only keeps a failure from
  // being reported as unhandled meanwhile. The await below still throws it.
  wave1.catch(() => {});
  const me = await mePromise;
  if (me === null) {
    return (
      <PageShell>
        <h1 style={{ fontSize: '1.5rem' }}>Create orders</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const [quoteResult, grades] = await wave1;
  if (quoteResult === null) {
    notFound();
  }
  const quote = quoteResult;

  const customerName = await loadCustomerName(quote.customerId);

  const salesRep = await loadResolvedRep(quote.salesRep);

  // Only a Quoted quote converts. The API refuses any other: docs/product/requirements.md (R9).
  if (quote.status !== 'quoted') {
    return (
      <PageShell>
        <h1 style={{ fontSize: '1.5rem' }}>Create orders</h1>
        <DangerBanner>
          This quote is not ready to convert: only a Quoted quote can become an order.
        </DangerBanner>
        <p>
          <a href={`/quoting/quotes/${quote.id}`} style={link}>
            ← Back to the quote
          </a>
        </p>
      </PageShell>
    );
  }

  const gradeById = new Map(grades.map((g) => [g.id, g]));
  const quoteLineById = new Map(quote.lines.map((line) => [line.id, line]));
  const lines = gridLines(quote.lines, await loadOrderedSoFar(quote.id));

  const echo = submitted(query);
  const fromEcho = Object.keys(echo).length > 0;

  const max = maxDeliveries(lines);
  const columns = columnsOf(deliveryCount(query[DELIVERIES_FIELD], max));
  const several = columns.length > 1;
  const createLabel = `Create ${String(columns.length)} order${several ? 's' : ''}`;

  // A fresh key each render makes the form start over from its default values after a redirect.
  // The form also opens with an out-of-sight submit button, so Enter creates the orders instead of
  // pressing the first visible button, Add another delivery.
  const drawn = randomUUID();

  return (
    <PageShell>
      <h1 style={{ fontSize: '1.5rem' }}>Create orders from quote {quoteReference(quote)}</h1>
      <PageLede>
        Each delivery below becomes its own order. Each line keeps the quote&apos;s price.
      </PageLede>
      <p style={{ marginBottom: '0.5rem' }}>
        <a href={`/quoting/quotes/${quote.id}`} style={link}>
          ← Back to the quote
        </a>
      </p>

      <ErrorBanner message={error} />

      <DL>
        <dt>Customer</dt>
        <dd>{customerName}</dd>

        {salesRep !== undefined && (
          <>
            <dt>Sales rep</dt>
            <dd>
              <SalesRepName rep={salesRep} />
            </dd>
          </>
        )}
      </DL>

      <form key={drawn} action={convertQuoteAction} style={{ display: 'grid', gap: '1rem' }}>
        {/* eslint-disable-next-line no-restricted-syntax -- intentional */}
        <button type="submit" tabIndex={-1} aria-hidden="true" style={OUT_OF_SIGHT}>
          {createLabel}
        </button>
        <input type="hidden" name="quoteId" value={quote.id} />

        <input type="hidden" name={SUBMISSION_TOKEN_FIELD} value={mintSubmissionToken()} />

        <input type="hidden" name={DELIVERIES_FIELD} value={String(columns.length)} />

        <Section title="Their PO">
          <div style={{ display: 'grid', gap: SPACE.lg }}>
            <Field>
              <FieldLabel>PO number</FieldLabel>
              <Input
                type="text"
                name="poNumber"
                maxLength={64}
                defaultValue={echo.poNumber}
                style={{ maxWidth: 260 }}
              />
              <Hint>Optional, as the customer wrote it.</Hint>
            </Field>

            <Field>
              <FieldLabel>PO document</FieldLabel>
              <Input type="file" name="poDocument" />
              <Hint>{PO_DOCUMENT_HINT}</Hint>
            </Field>
          </div>
        </Section>

        <Section id="deliveries" title="What goes on each delivery">
          <TableScroll>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ verticalAlign: 'bottom', textAlign: 'left' }}>
                  <th scope="col" style={cell}>
                    Line
                  </th>
                  <th scope="col" style={numberCell}>
                    Quoted
                  </th>
                  <th scope="col" style={numberCell}>
                    Ordered so far
                  </th>

                  {columns.map((column) => (
                    <th key={column} scope="col" style={deliveryCell}>
                      <DeliveryHead
                        column={column}
                        several={several}
                        date={echo[convertField.date(column)]}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const quoteLine = quoteLineById.get(line.quoteLineId);
                  const boxes = columns.map((column) => boxesFor(line, echo, fromEcho, column));

                  const over = overWords(line, boxes);
                  return (
                    <tr key={line.quoteLineId} style={{ verticalAlign: 'top' }}>
                      <th scope="row" style={{ ...cell, fontWeight: 'normal' }}>
                        {quoteLine !== undefined && (
                          <QuotedLine line={quoteLine} grade={gradeById.get(quoteLine.gradeId)} />
                        )}
                        {over !== undefined && (
                          <p
                            style={{
                              margin: `${SPACE.sm} 0 0`,
                              fontSize: FONT_SIZE.sm,
                              color: COLOR.warning,
                            }}
                          >
                            {over}
                          </p>
                        )}
                      </th>
                      <td style={numberCell}>
                        <Figures rolls={line.quotedRolls} pounds={line.quotedPounds} />
                      </td>
                      <td style={numberCell}>
                        {line.soFar === undefined ? (
                          'None'
                        ) : (
                          <Figures
                            rolls={line.soFar.rolls}
                            pounds={line.perPound ? line.soFar.pounds : undefined}
                          />
                        )}
                      </td>
                      {columns.map((column) => (
                        <td key={column} style={deliveryCell}>
                          <DeliveryBoxes
                            line={line}
                            column={column}
                            rolls={boxes[column - 1]?.rolls ?? ''}
                            pounds={boxes[column - 1]?.pounds ?? ''}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          <SectionNote>
            Leave a box empty or at 0 to keep that line off that delivery. The quoted quantity is
            not a limit: you can order more, and the line will say so.
          </SectionNote>

          <div style={{ marginTop: SPACE.md }}>
            {columns.length < max ? (
              <Button formAction={addDeliveryAction}>Add another delivery</Button>
            ) : (
              <SectionNote>{AT_CAPACITY}</SectionNote>
            )}
          </div>
        </Section>

        <div>
          <Button variant="primary">{createLabel}</Button>
          <div style={{ marginTop: '0.35rem' }}>
            <SectionNote>{several ? CREATE_NOTE.several : CREATE_NOTE.one}</SectionNote>
          </div>
        </div>
      </form>
    </PageShell>
  );
}

function QuotedLine({ line, grade }: { line: QuoteLine; grade: Grade | undefined }) {
  return (
    <span style={{ color: COLOR.muted }}>
      <strong style={{ color: 'inherit' }}>Line {line.lineNumber}</strong>{' '}
      {grade !== undefined
        ? `${PRODUCT_FAMILY_LABELS[grade.productFamily]} — ${grade.code}`
        : line.gradeId}{' '}
      · {line.footageVariant} · {formatWidthIn(line.rollWidthIn)} · {quotedPriceWords(line)}
    </span>
  );
}

function Figures({ rolls, pounds }: { rolls: number; pounds: string | undefined }) {
  return (
    <>
      {rolls} roll{rolls === 1 ? '' : 's'}
      {pounds !== undefined && (
        <>
          <br />
          <span style={{ color: COLOR.muted }}>{formatOrderedPounds(pounds)} lb</span>
        </>
      )}
    </>
  );
}

function DeliveryHead({
  column,
  several,
  date,
}: {
  column: number;
  several: boolean;

  date: string | undefined;
}) {
  return (
    <div style={{ display: 'grid', gap: SPACE.sm }}>
      <span>Delivery {column}</span>

      <div style={{ fontWeight: 'normal', display: 'grid', gap: SPACE.sm }}>
        <Field>
          <FieldLabel>Delivery date</FieldLabel>
          <Input
            type="date"
            name={convertField.date(column)}
            defaultValue={date}
            style={{ maxWidth: 200 }}
          />
          <Hint>
            {several
              ? 'The day the customer is to receive it, from their PO.'
              : 'Optional. The day the customer is to receive it, from their PO.'}
          </Hint>
        </Field>
        {several && (
          <div>
            <Button formAction={removeDeliveryAction.bind(null, column)}>
              Remove this delivery
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function DeliveryBoxes({
  line,
  column,
  rolls,
  pounds,
}: {
  line: GridLine;
  column: number;
  rolls: string;
  pounds: string;
}) {
  return (
    <div style={{ display: 'grid', gap: SPACE.sm }}>
      <Field>
        <FieldLabel>Rolls</FieldLabel>
        <Input
          type="number"
          name={convertField.rolls(line.quoteLineId, column)}
          min={0}
          step={1}
          defaultValue={rolls}
          style={{ width: 110 }}
        />
      </Field>
      {line.perPound && (
        <Field>
          <FieldLabel>Pounds ordered</FieldLabel>
          <Input
            type="text"
            inputMode="decimal"
            name={convertField.pounds(line.quoteLineId, column)}
            defaultValue={pounds}
            style={{ width: 110 }}
          />
        </Field>
      )}
    </div>
  );
}

const link = { color: COLOR.accent } as const;

const cell = {
  padding: `${SPACE.md} ${SPACE.lg}`,
  borderBottom: `1px solid ${COLOR.border}`,
  textAlign: 'left',
} as const;

const numberCell = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' } as const;

const deliveryCell = { ...cell, borderLeft: `2px solid ${COLOR.accent}` } as const;
