// The send form for another copy of a sent quote, and the note that says why no PDF exists yet.
import { formatMoney, type QuoteWithLines } from '@erp/types';
import { Button, COLOR, MEASURE, SectionNote } from '@erp/ui';

import { nobodyTagged } from '../../../../../lib/helptext';
import { ConfirmRecipientsFields } from '../../../../../lib/confirm-recipients-fields';
import { RECIPIENT_BUTTON_STYLE, recipientListLabel } from '../../../../../lib/confirm-recipients';
import { QUOTE_STATUS_LABELS } from '../../../format';
import { SUBMISSION_TOKEN_FIELD, mintSubmissionToken } from '../../../../../lib/submission-token';
import { sendQuoteAction } from '../actions';
import type { QuoteDocumentState } from '../printability';

export function SendCopyForm({
  quote,
  recipients,
  again,
}: {
  quote: QuoteWithLines;
  recipients: readonly string[];
  again: boolean;
}) {
  if (recipients.length === 0) {
    return (
      <p style={{ color: COLOR.warning, margin: 0, maxWidth: MEASURE.note }}>
        <WithCustomerLink
          sentence={nobodyTagged('quotes', 'Quote')}
          href={`/crm/customers/${encodeURIComponent(quote.customerId)}`}
        />
      </p>
    );
  }

  // Each of the two forms mints its own submission token, which
  // apps/web/src/app/every-append-form-carries-a-token.test.ts checks.
  const recipientLabel = recipientListLabel(recipients);
  return again ? (
    <form action={sendQuoteAction}>
      <input type="hidden" name="quoteId" value={quote.id} />
      <input type="hidden" name="lockVersion" value={quote.lockVersion} />

      <input type="hidden" name={SUBMISSION_TOKEN_FIELD} value={mintSubmissionToken()} />

      <input type="hidden" name="confirmRedistribute" value="1" />

      <ConfirmRecipientsFields addresses={recipients} />
      <Button style={RECIPIENT_BUTTON_STYLE}>Send another copy to {recipientLabel}</Button>
    </form>
  ) : (
    <form action={sendQuoteAction}>
      <input type="hidden" name="quoteId" value={quote.id} />

      <input type="hidden" name="lockVersion" value={quote.lockVersion} />

      <input type="hidden" name={SUBMISSION_TOKEN_FIELD} value={mintSubmissionToken()} />
      <ConfirmRecipientsFields addresses={recipients} />
      <Button style={RECIPIENT_BUTTON_STYLE}>Email to {recipientLabel}</Button>
    </form>
  );
}

export function WithCustomerLink({ sentence, href }: { sentence: string; href: string }) {
  const phrase = 'the customer';
  const at = sentence.indexOf(phrase);
  if (at < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, at)}
      <a href={href} style={{ color: COLOR.accent }}>
        {phrase}
      </a>
      {sentence.slice(at + phrase.length)}
    </>
  );
}

export function DocumentBlocked({ state }: { state: QuoteDocumentState }) {
  if (state.kind === 'ready') return null;

  if (state.kind === 'not-printable') {
    return (
      <SectionNote>
        Nothing to send yet ({QUOTE_STATUS_LABELS[state.status]}). A PDF exists from the moment the
        quote goes out.
      </SectionNote>
    );
  }

  if (state.kind === 'blocked-below-floor') {
    return (
      <div style={{ maxWidth: 520 }}>
        <div style={{ color: COLOR.danger }}>
          {state.belowFloor.map((line) => (
            <div key={line.lineNumber}>
              Line {line.lineNumber} is below floor — min {formatMoney(line.minimumPricePerRoll)}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '0.25rem' }}>
          <SectionNote>
            No PDF while a line is below its floor. An Admin can override the floor.
          </SectionNote>
        </div>
      </div>
    );
  }

  if (state.kind === 'blocked-unapproved-override') {
    return (
      <SectionNote>
        No PDF until the Billing Manager approves the hand-set price
        {state.manualCount === 1 ? '' : 's'}. The decision is made on the{' '}
        <a href="/approvals" style={{ color: COLOR.accent }}>
          Approvals
        </a>{' '}
        inbox.
      </SectionNote>
    );
  }

  return (
    <p style={{ color: COLOR.warning, margin: 0, maxWidth: MEASURE.note }}>
      No lead time, and the quote has already been sent, so none can be entered now. Revise the
      quote to add one.
    </p>
  );
}
