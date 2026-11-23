// The Lines step form: every line, open or folded, in one form that saves them all: docs/product/requirements.md (R3).
// The posted fields are read by apps/web/src/app/quoting/quotes/[id]/collect-lines.ts.
import type {
  StoredCustomerPart,
  Grade,
  PostalAddress,
  PricingTier,
  QuoteWithLines,
  TaxStatus,
} from '@erp/types';
import type { ReactNode } from 'react';

import { COLOR, FONT_SIZE, LinkButton, RADIUS, SPACE } from '@erp/ui';

import { saveLinesAction } from '../actions';
import { CUSTOM_WIDTH_REVEAL_CSS } from '../custom-width';
import { floorOverrideLive } from '../derive';
import {
  CUSTOMER_PARTS_FIELD,
  SEED_FREIGHT_MODE_FIELD,
  SEED_PRICING_BASIS_FIELD,
  SEED_TIER_CODE_FIELD,
  type LineSeed,
} from '../customer-seed';
import {
  LINE_FORM_CLASS,
  LINE_FREIGHT_REVEAL_CSS,
  LINE_TAX_JURISDICTION_REVEAL_CSS,
  MARGIN_ENTERED_REVEAL_CSS,
  MARGIN_FLOOR_FIELD,
  PRINTED_NO_PRINT_COST_CSS,
  blankRowStart,
  openForms,
  rowEcho,
} from '../line-defaults';
import { LineInputs, StoredLineHiddenInputs } from './line-inputs';
import { LineResults } from './line-results';
import { LineSummary, lineSummaryOf } from './line-summary';
import { LineFormButtons } from './save-and-price';

export function LinesEditor({
  quote,
  query,
  echo,
  linesDrawnAt,
  grades,
  tiers,
  marginFloorPct,
  taxSeed,
  shippingSeed,
  billingState,
  lineSeed,
  customerParts,
  customerPartsValue,
  approvalLive,
}: {
  quote: QuoteWithLines;

  query: Readonly<Record<string, string | string[] | undefined>>;

  echo: Readonly<Record<string, string>>;

  linesDrawnAt: string;
  grades: readonly Grade[];
  tiers: readonly PricingTier[];

  marginFloorPct: string;
  taxSeed: { taxStatus: TaxStatus | ''; taxJurisdiction: string };
  shippingSeed: PostalAddress | undefined;
  billingState: string;
  lineSeed: LineSeed;
  customerParts: readonly StoredCustomerPart[];
  customerPartsValue: string | undefined;
  approvalLive: boolean;
}) {
  const base = `/quoting/quotes/${encodeURIComponent(quote.id)}`;
  const newLinePaper =
    typeof query['newLinePaper'] === 'string' ? query['newLinePaper'] : undefined;
  const open = openForms({
    lineCount: quote.lines.length,
    echo,
    edit: typeof query['edit'] === 'string' ? query['edit'] : undefined,
    add: query['add'] !== undefined,
    newLinePaper,
  });
  const openCount = open.stored.size + (open.blank ? 1 : 0);
  const blankIndex = quote.lines.length;
  const blankRow = blankRowStart(rowEcho(echo, blankIndex), newLinePaper);
  const gradeById = new Map(grades.map((grade) => [grade.id, grade]));

  // A folded line posts its stored values as hidden inputs, because the save replaces every line.
  // The margin floor and billing state ride along for the checks in collect-lines.ts.
  return (
    <form action={saveLinesAction} style={{ display: 'grid', gap: SPACE.lg }}>
      <input type="hidden" name="quoteId" value={quote.id} />

      <input type="hidden" name="lockVersion" value={linesDrawnAt} />

      <input type="hidden" name="newLineIndex" value={blankIndex} />

      {lineSeed.pricingBasis !== undefined && (
        <input type="hidden" name={SEED_PRICING_BASIS_FIELD} value={lineSeed.pricingBasis} />
      )}
      {lineSeed.freightMode !== undefined && (
        <input type="hidden" name={SEED_FREIGHT_MODE_FIELD} value={lineSeed.freightMode} />
      )}

      {lineSeed.tierCode !== undefined && (
        <input type="hidden" name={SEED_TIER_CODE_FIELD} value={lineSeed.tierCode} />
      )}
      {customerPartsValue !== undefined && (
        <input type="hidden" name={CUSTOMER_PARTS_FIELD} value={customerPartsValue} />
      )}
      <style>{CUSTOM_WIDTH_REVEAL_CSS}</style>

      <style>{LINE_FREIGHT_REVEAL_CSS}</style>

      <style>{PRINTED_NO_PRINT_COST_CSS}</style>

      <style>{MARGIN_ENTERED_REVEAL_CSS}</style>

      <style>{LINE_TAX_JURISDICTION_REVEAL_CSS}</style>

      <input type="hidden" name="billingState" value={billingState} />

      <input type="hidden" name={MARGIN_FLOOR_FIELD} value={marginFloorPct} />

      {quote.lines.map((line, i) => {
        const grade = gradeById.get(line.gradeId);
        if (!open.stored.has(i)) {
          return (
            <div key={line.id}>
              <StoredLineHiddenInputs index={i} line={line} grade={grade} />
              <LineSummary
                id={`line-${line.lineNumber}`}
                {...lineSummaryOf(line, grade, floorOverrideLive(quote))}
                edit={{
                  href: `${base}?edit=${line.lineNumber}#line-${line.lineNumber}`,
                  label: `Edit line ${line.lineNumber}`,
                }}
              />
            </div>
          );
        }
        return (
          <LineFieldset key={line.id} id={`line-${line.lineNumber}`} number={line.lineNumber}>
            <LineInputs
              index={i}
              line={line}
              echo={rowEcho(echo, i)}
              grades={grades}
              tiers={tiers}
              marginFloorPct={marginFloorPct}
              chosenPaper={undefined}
              taxSeed={taxSeed}
              shippingSeed={shippingSeed}

              customerParts={customerParts}
            />

            <LineResults line={line} />
            <LineFormButtons
              lineNumber={line.lineNumber}
              primary={openCount === 1}
              remove={{ kind: 'stored', name: `lines[${i}].remove` }}
              approvalLive={approvalLive}
            />
          </LineFieldset>
        );
      })}

      {open.blank ? (
        <LineFieldset id="new-line" number={blankIndex + 1}>
          <LineInputs
            index={blankIndex}
            line={undefined}
            echo={blankRow.echo}
            grades={grades}
            tiers={tiers}
            marginFloorPct={marginFloorPct}
            chosenPaper={blankRow.chosenPaper}
            taxSeed={taxSeed}
            shippingSeed={shippingSeed}
            lineSeed={lineSeed}
            customerParts={customerParts}
          />
          <LineFormButtons
            lineNumber={blankIndex + 1}
            primary={openCount === 1}
            remove={{ kind: 'new', href: `${base}#lines` }}
            approvalLive={approvalLive}
          />
        </LineFieldset>
      ) : (
        <div>
          <LinkButton href={`${base}?add=1#new-line`}>Add another line</LinkButton>
        </div>
      )}
    </form>
  );
}

function LineFieldset({
  id,
  number,
  children,
}: {
  id: string;
  number: number;
  children: ReactNode;
}) {
  return (
    <fieldset
      id={id}
      className={LINE_FORM_CLASS}
      style={{
        border: `1px solid ${COLOR.border}`,
        borderRadius: RADIUS,
        padding: `${SPACE.lg} ${SPACE.xl}`,
        margin: 0,
        display: 'grid',
        gap: SPACE.lg,
        minWidth: 0,
      }}
    >
      <legend style={{ fontWeight: 700, padding: `0 ${SPACE.xs}`, fontSize: FONT_SIZE.md }}>
        Line {number}: what the customer is buying
      </legend>
      {children}
    </fieldset>
  );
}
