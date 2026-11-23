// The rare acts at the foot of a quote page: price build-up, revise and close as lost.
import { Button, ButtonReason, COLOR, RareActs, SPACE } from '@erp/ui';

import { reviseQuoteAction } from '../actions';

export function QuoteRareActs({
  closeHref,
  revise,
  buildUpHref,
}: {
  closeHref?: string | undefined;

  revise?: { readonly quoteId: string; readonly nextVersion: number } | undefined;

  buildUpHref?: string | undefined;
}) {
  if (closeHref === undefined && revise === undefined && buildUpHref === undefined) return null;
  return (
    <RareActs>
      {buildUpHref !== undefined && (
        <div style={{ display: 'flex', gap: SPACE.lg, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href={buildUpHref} style={{ color: COLOR.accent }}>
            Price build-up
          </a>
          <ButtonReason>Each line&apos;s cost, tier, margin and freight, as stored.</ButtonReason>
        </div>
      )}
      {revise !== undefined && (
        <form
          action={reviseQuoteAction}
          style={{ display: 'flex', gap: SPACE.lg, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <input type="hidden" name="quoteId" value={revise.quoteId} />
          <Button>Revise</Button>
          <ButtonReason>
            Opens v{revise.nextVersion} as a draft. The customer keeps this version until you send
            the revision.
          </ButtonReason>
        </form>
      )}
      {closeHref !== undefined && (
        <div style={{ display: 'flex', gap: SPACE.lg, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href={closeHref} style={{ color: COLOR.danger }}>
            Close as lost
          </a>
          <ButtonReason>
            Asks you to confirm on the next page. The customer is not emailed.
          </ButtonReason>
        </div>
      )}
    </RareActs>
  );
}
