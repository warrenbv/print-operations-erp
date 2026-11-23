// The lead-time panel on the Lines step: enter it, wait for it, or see who entered it: docs/product/requirements.md (R5).
// The form posts to `setLeadTimeAction` in apps/web/src/app/quoting/quotes/[id]/actions.ts.
import type { QuoteSendAttempt, QuoteWithLines } from '@erp/types';
import {
  ActNow,
  Button,
  COLOR,
  Field,
  FieldLabel,
  FieldRow,
  Fold,
  Hint,
  Input,
  SPACE,
} from '@erp/ui';

import { setLeadTimeAction } from '../actions';
import { leadTimeDoneLine, leadTimeWaitingLine, type LeadTimePanelState } from '../derive';

export function LeadTimeSection({
  quote,
  state,
  formLive,
  customerLeadTimeDays,
  enteredByName,
  sends,
  now,
}: {
  quote: QuoteWithLines;
  state: Exclude<LeadTimePanelState, 'none'>;

  formLive: boolean;

  customerLeadTimeDays?: number | undefined;

  enteredByName?: string | undefined;

  sends: readonly QuoteSendAttempt[];

  now: Date;
}) {
  if (state === 'enter') {
    return (
      <ActNow id="lead-time" tone="act" title="Enter the lead time">
        <LeadTimeForm quote={quote} customerLeadTimeDays={customerLeadTimeDays} />
      </ActNow>
    );
  }

  if (state === 'waiting') {
    return (
      <ActNow
        id="lead-time"
        tone="waiting"
        title="Lead time: waiting on Production"
        who={leadTimeWaitingLine(quote, sends, now)}
      >
        <p style={{ margin: 0 }}>
          Production enters the lead time on this quote. You can finish the lines and the delivery
          step now; Send is offered on step 4 once the lead time is in.{' '}
          <a href="/production/lead-times" style={{ color: COLOR.accent }}>
            Production&rsquo;s quote queue
          </a>
        </p>
      </ActNow>
    );
  }

  return (
    <ActNow id="lead-time" tone="done" label="Lead time">
      <p style={{ margin: 0 }}>{leadTimeDoneLine(quote, enteredByName)}</p>
      {formLive && (
        <Fold summary="Change the lead time">
          <LeadTimeForm quote={quote} customerLeadTimeDays={undefined} />
        </Fold>
      )}
    </ActNow>
  );
}

function LeadTimeForm({
  quote,
  customerLeadTimeDays,
}: {
  quote: QuoteWithLines;
  customerLeadTimeDays: number | undefined;
}) {
  const prefilled = quote.leadTimeDays === undefined && customerLeadTimeDays !== undefined;
  return (
    <form action={setLeadTimeAction} style={{ display: 'grid', gap: SPACE.md }}>
      <input type="hidden" name="quoteId" value={quote.id} />

      <input type="hidden" name="lockVersion" value={quote.lockVersion} />
      <FieldRow align="end">
        <Field>
          <FieldLabel>Days</FieldLabel>
          <DaysInput value={quote.leadTimeDays ?? customerLeadTimeDays} />
        </Field>
        <Button variant="primary">Save lead time</Button>

        {prefilled ? (
          <Hint>The customer&rsquo;s usual, in calendar days. 0 means same day.</Hint>
        ) : (
          <Hint>Calendar days, weekends included. 0 means same day.</Hint>
        )}
      </FieldRow>
    </form>
  );
}

// The bounds match the server-side check in apps/web/src/app/quoting/quotes/[id]/collect-lead-time.ts.
function DaysInput({ value }: { value: number | undefined }) {
  return (
    <Input
      type="number"
      name="leadTimeDays"
      min={0}
      max={3650}
      step={1}
      required
      defaultValue={value === undefined ? '' : String(value)}
      style={{ width: '7rem' }}
    />
  );
}
