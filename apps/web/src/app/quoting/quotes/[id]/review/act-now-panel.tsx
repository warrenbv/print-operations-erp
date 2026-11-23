// The Act now panel on Review and send: the gate checklist and the one primary act, or why it is disabled:
// docs/product/requirements.md (R8). Its forms carry the quote's lockVersion, which
// apps/web/src/app/quoting/quotes/[id]/transition-forms-carry-the-token.test.ts checks.
import type { QuoteWithLines } from '@erp/types';
import {
  ActNow,
  ActRow,
  Button,
  ButtonReason,
  COLOR,
  Field,
  FieldLabel,
  FONT_SIZE,
  GateList,
  SectionNote,
  SPACE,
} from '@erp/ui';

import { ConfirmRecipientsFields } from '../../../../../lib/confirm-recipients-fields';
import { RECIPIENT_BUTTON_STYLE, recipientListLabel } from '../../../../../lib/confirm-recipients';
import { onlyDesk } from '../../../../../lib/helptext';
import { SUBMISSION_TOKEN_FIELD, mintSubmissionToken } from '../../../../../lib/submission-token';
import {
  createOrderWithoutSendingAction,
  overrideFloorAction,
  sendQuoteAction,
  transitionQuoteAction,
} from '../actions';
import { WithCustomerLink } from '../components/quote-document-section';
import type { Primary, QuoteGates } from './gates';
import { FROM_REVIEW } from './sent-notice';

export function ActNowPanel({
  quote,
  gates,
  mailModeNote,
}: {
  quote: QuoteWithLines;
  gates: QuoteGates;

  mailModeNote: string | undefined;
}) {
  const acting =
    gates.primary.kind === 'send' ||
    gates.primary.kind === 'request-approval' ||
    gates.primary.kind === 'override-floor';
  const customerHref = `/crm/customers/${encodeURIComponent(quote.customerId)}`;

  return (
    <ActNow tone={acting ? 'act' : 'waiting'} title={gates.title} who={gates.who} id="send">
      <GateList
        gates={gates.gates.map((gate) => ({
          text:
            gate.customerLink === true ? (
              <WithCustomerLink sentence={gate.text} href={customerHref} />
            ) : (
              gate.text
            ),
          clear: gate.clear,
          link: gate.link,
        }))}
      />

      <PrimaryAct quote={quote} primary={gates.primary} mailModeNote={mailModeNote} />
      {gates.createOrderWithoutSending && <WithoutSendingAct quote={quote} />}
    </ActNow>
  );
}

function PrimaryAct({
  quote,
  primary,
  mailModeNote,
}: {
  quote: QuoteWithLines;
  primary: Primary;
  mailModeNote: string | undefined;
}) {
  if (primary.kind === 'none') {
    return <SectionNote>{onlyDesk('Sales', 'sends a quote')}</SectionNote>;
  }

  if (primary.kind === 'disabled') {
    return (
      <ActRow>
        <Button type="button" variant="primary" disabled>
          {primary.label}
        </Button>
        <ButtonReason>{primary.reason}</ButtonReason>
      </ActRow>
    );
  }

  if (primary.kind === 'request-approval') {
    return (
      <form action={transitionQuoteAction}>
        <input type="hidden" name="quoteId" value={quote.id} />

        <input type="hidden" name="lockVersion" value={quote.lockVersion} />
        <input type="hidden" name="to" value="override_requested" />
        <input type="hidden" name="from" value={FROM_REVIEW} />
        <ActRow>
          <Button variant="primary">{primary.label}</Button>
          <ButtonReason>{primary.reason}</ButtonReason>
        </ActRow>
      </form>
    );
  }

  if (primary.kind === 'override-floor') {
    return (
      <form action={overrideFloorAction} style={{ display: 'grid', gap: SPACE.md }}>
        <input type="hidden" name="quoteId" value={quote.id} />

        <input type="hidden" name="lockVersion" value={quote.lockVersion} />
        <Field>
          <FieldLabel>Reason for overriding the floor (required)</FieldLabel>
          <input
            type="text"
            name="reason"
            required
            maxLength={500}
            style={{ padding: SPACE.sm, fontFamily: 'inherit', maxWidth: 480 }}
          />
        </Field>
        <ActRow>
          <Button variant="primary">Override the floor</Button>
          <ButtonReason>The reason is kept on the quote.</ButtonReason>
        </ActRow>
      </form>
    );
  }

  return (
    <form action={sendQuoteAction} style={{ display: 'grid', gap: SPACE.md }}>
      <input type="hidden" name="quoteId" value={quote.id} />

      <input type="hidden" name="lockVersion" value={quote.lockVersion} />

      <input type="hidden" name={SUBMISSION_TOKEN_FIELD} value={mintSubmissionToken()} />
      <input type="hidden" name="from" value={FROM_REVIEW} />

      {primary.revision && <input type="hidden" name="confirmRedistribute" value="1" />}

      <ConfirmRecipientsFields addresses={primary.addresses} />
      <ActRow>
        <Button variant="primary" style={RECIPIENT_BUTTON_STYLE}>
          {primary.revision ? 'Send revised quote' : 'Send quote'} to{' '}
          {recipientListLabel(primary.addresses)}
        </Button>
        <ButtonReason>
          Marks the quote Quoted and emails the PDF below. Production is told it went out.
        </ButtonReason>
      </ActRow>
      {mailModeNote !== undefined && (
        <p style={{ margin: 0, color: COLOR.warning, fontSize: FONT_SIZE.sm }}>{mailModeNote}</p>
      )}
    </form>
  );
}

function WithoutSendingAct({ quote }: { quote: QuoteWithLines }) {
  return (
    <form action={createOrderWithoutSendingAction}>
      <input type="hidden" name="quoteId" value={quote.id} />

      <input type="hidden" name="lockVersion" value={quote.lockVersion} />

      <input type="hidden" name={SUBMISSION_TOKEN_FIELD} value={mintSubmissionToken()} />
      <ActRow>
        <Button>Create the order without sending</Button>
        <ButtonReason>
          For a quote the customer has already accepted, for example with a PO. Marks it Quoted
          without emailing anyone, and opens Create orders.
        </ButtonReason>
      </ActRow>
    </form>
  );
}
