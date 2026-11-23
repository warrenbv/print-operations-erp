// The price build-up page: each line's cost, tier, margin and floor result: docs/product/requirements.md (R3).
// The rows come from apps/web/src/app/quoting/quotes/[id]/build-up/build-up.ts.
import { notFound } from 'next/navigation';

import { quoteReference, quoteWithLinesSchema, type Grade } from '@erp/types';
import { COLOR, FONT_SIZE, PageLede, PageShell, SPACE } from '@erp/ui';

import { loadMe } from '../../../../../lib/load-me';
import { recordTitle } from '../../../../../lib/record-title';
import { UNKNOWN_CUSTOMER } from '../../../customer-names';
import { loadCustomer, loadGrades, loadQuote } from '../loaders';
import { NOT_RECORDED_SENTENCE, buildUpHeading, buildUpOf, type BuildUpGroup } from './build-up';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const title = await recordTitle(
    `/quoting/quotes/${encodeURIComponent(id)}`,
    quoteWithLinesSchema,
    (quote) => `Price build-up for quote ${quoteReference(quote)}`,
    'Price build-up',
  );
  return { title };
}

export default async function PriceBuildUpPage({ params }: PageProps) {
  const { id } = await params;

  const mePromise = loadMe();
  const reads = Promise.all([loadQuote(id), loadGrades()]);
  reads.catch(() => {});
  const me = await mePromise;
  if (me === null) {
    return (
      <PageShell>
        <h1>Price build-up</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const [quote, grades] = await reads;
  if (quote === null) {
    notFound();
  }
  const customer = await loadCustomer(quote.customerId);
  const reference = quoteReference(quote);
  const quoteHref = `/quoting/quotes/${encodeURIComponent(quote.id)}`;
  const gradeById = new Map<string, Grade>(grades.map((grade) => [grade.id, grade]));

  return (
    <PageShell>
      <p style={{ margin: `0 0 ${SPACE.md}`, fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
        <a href="/quoting/quotes" style={{ color: COLOR.accent }}>
          Quotes
        </a>{' '}
        /{' '}
        <a href={quoteHref} style={{ color: COLOR.accent }}>
          {reference}
        </a>{' '}
        / Price build-up
      </p>
      <h1>
        Price build-up: quote {reference} for {customer?.name ?? UNKNOWN_CUSTOMER}
      </h1>
      <PageLede>
        Each line&apos;s price, step by step in pricing order, from the figures stored when the line
        was priced.
      </PageLede>

      {quote.lines.length === 0 ? (
        <p style={{ color: COLOR.muted }}>
          No lines yet. A line has a build-up once it is priced on{' '}
          <a href={quoteHref} style={{ color: COLOR.accent }}>
            the quote
          </a>
          .
        </p>
      ) : (
        quote.lines.map((line) => (
          <section
            key={line.id}
            id={`line-${String(line.lineNumber)}`}
            aria-labelledby={`line-${String(line.lineNumber)}-heading`}
            style={{ marginTop: SPACE.xxl }}
          >
            <h2
              id={`line-${String(line.lineNumber)}-heading`}
              style={{ fontSize: FONT_SIZE.lg, marginBottom: SPACE.md }}
            >
              {buildUpHeading(line, gradeById.get(line.gradeId))}
            </h2>
            {buildUpOf(line, gradeById.get(line.gradeId)).map((group) => (
              <Group key={group.title} group={group} />
            ))}
          </section>
        ))
      )}

      <p style={{ marginTop: SPACE.xxl, fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
        {NOT_RECORDED_SENTENCE}{' '}
        <a href="/quoting/config" style={{ color: COLOR.accent }}>
          Today&apos;s pricing constants
        </a>
        . They may have changed since this line was priced.
      </p>

      <p style={{ marginTop: SPACE.lg }}>
        <a href={quoteHref} style={{ color: COLOR.accent }}>
          Back to quote {reference}
        </a>
      </p>
    </PageShell>
  );
}

function Group({ group }: { group: BuildUpGroup }) {
  return (
    <div style={{ marginTop: SPACE.lg }}>
      <h3 style={{ fontSize: FONT_SIZE.md, margin: `0 0 ${SPACE.xs}` }}>{group.title}</h3>
      <dl style={grid}>
        {group.rows.map((row) => (
          <div key={row.label} style={{ display: 'contents' }}>
            <dt style={{ color: COLOR.muted }}>{row.label}</dt>
            <dd style={{ margin: 0 }}>
              {row.strong === true ? <strong>{row.value}</strong> : row.value}
              {row.note !== undefined && <span style={{ color: COLOR.muted }}> · {row.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {group.after !== undefined && (
        <p style={{ margin: `${SPACE.xs} 0 0`, fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
          {group.after}
        </p>
      )}
    </div>
  );
}

const grid = {
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  columnGap: SPACE.xl,
  rowGap: SPACE.xs,
  margin: 0,
} as const;
