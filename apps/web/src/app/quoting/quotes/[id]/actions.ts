// Server actions of the quote page and its steps. Each change goes through the API: docs/decisions/004-server-first-web-ui.md.
// Every edit or move sends the lockVersion the page was drawn with, and the API refuses a stale one:
// docs/decisions/006-optimistic-concurrency.md.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { quoteSendSchema, quoteWithLinesSchema } from '@erp/types';
import { optionalString, requireString } from '@erp/utils';

import { apiFetch } from '../../../../lib/api-fetch';
import { readableApiError } from '../../../../lib/api-error';
import { confirmRecipientsBody, readConfirmRecipients } from '../../../../lib/confirm-recipients';
import { echoOf } from '../../../../lib/form-echo';
import { backWithError, noticeUrl } from '../../../../lib/redirect-error';
import { refusalReason } from '../../../../lib/refusal-reason';
import { sendRefusalPrefix } from './send-refusal';
import { SUBMISSION_TOKEN_FIELD, withSubmissionToken } from '../../../../lib/submission-token';
import { collectLeadTime } from './collect-lead-time';
import { collectLines } from './collect-lines';
import { leadTimeLabel } from './derive';
import { FROM_REVIEW, returnPath, sentNotice } from './review/sent-notice';

/**
 * Saves every line of the quote at once and the API prices them again. Editing lines revokes a
 * live price approval or floor override: docs/product/requirements.md (R6), docs/product/requirements.md (R7).
 */
export async function saveLinesAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');

  const echo = echoOf(formData, (name) => name.startsWith('lines['));

  const lockVersion = requireString(formData, 'lockVersion');

  const collected = collectLines(formData);
  if (!collected.ok) {
    backWithError(`/quoting/quotes/${encodeURIComponent(quoteId)}`, collected.message, echo);
  }

  const response = await apiFetch(`/quoting/quotes/${encodeURIComponent(quoteId)}/lines`, {
    method: 'PUT',
    body: JSON.stringify({ lines: collected.lines, lockVersion }),
  });
  if (!response.ok) {
    backWithError(
      `/quoting/quotes/${encodeURIComponent(quoteId)}`,
      await readableApiError('Save failed', response),
      echo,
    );
  }
  revalidatePath(`/quoting/quotes/${quoteId}`);
  redirect(`/quoting/quotes/${quoteId}`);
}

/**
 * Choose widths on a new row: saves nothing and redraws the page with the chosen paper, so the width
 * list can follow the grade without client script. The typed rows ride along as an echo.
 */
export async function chooseNewLinePaperAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const index = requireString(formData, 'newLineIndex');
  const paper = optionalString(formData, `lines[${index}].paper`);
  const echo = echoOf(formData, (name) => name.startsWith('lines['));
  const lockVersion = requireString(formData, 'lockVersion');
  const query = new URLSearchParams({
    ...echo,
    ...(Object.keys(echo).length === 0 ? {} : { linesDrawnAt: lockVersion }),
    ...(paper === undefined ? {} : { newLinePaper: paper }),
  }).toString();
  redirect(
    `/quoting/quotes/${encodeURIComponent(quoteId)}${query === '' ? '' : `?${query}`}#new-line`,
  );
}

export async function transitionQuoteAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const to = requireString(formData, 'to');
  const lockVersion = requireString(formData, 'lockVersion');

  const back = returnPath(quoteId, formData.get('from'));

  const response = await apiFetch(`/quoting/quotes/${encodeURIComponent(quoteId)}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to, lockVersion }),
  });
  if (!response.ok) {
    backWithError(back, await readableApiError('Transition failed', response));
  }
  revalidatePath(`/quoting/quotes/${quoteId}`);
  redirect(back);
}

/**
 * Moves the quote to Quoted without emailing it, then opens the convert page. Review and send offers
 * it only when the recipients gate is the one gate open (review/gates.ts). The API checks the floor,
 * approval and lead-time gates on this move as on a send.
 */
export async function createOrderWithoutSendingAction(formData: FormData): Promise<void> {
  await withSubmissionToken(optionalString(formData, SUBMISSION_TOKEN_FIELD), () =>
    markQuotedWithoutSending(formData),
  );
}

async function markQuotedWithoutSending(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const lockVersion = requireString(formData, 'lockVersion');
  const path = `/quoting/quotes/${encodeURIComponent(quoteId)}`;

  const response = await apiFetch(`${path}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to: 'quoted', lockVersion }),
  });
  if (!response.ok) {
    backWithError(
      returnPath(quoteId, FROM_REVIEW),
      await readableApiError('Could not mark the quote Quoted', response),
    );
  }
  revalidatePath(`/quoting/quotes/${quoteId}`);
  redirect(`${path}/convert`);
}

/**
 * An Admin's override of the margin floor on this one quote, with a required reason that is kept on
 * the quote: docs/product/requirements.md (R6).
 */
export async function overrideFloorAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const lockVersion = requireString(formData, 'lockVersion');
  const reason = optionalString(formData, 'reason');
  const back = returnPath(quoteId, FROM_REVIEW);

  if (reason === undefined) {
    backWithError(back, 'Overriding the floor needs a reason. It is kept on the quote.');
  }

  const response = await apiFetch(
    `/quoting/quotes/${encodeURIComponent(quoteId)}/floor-override/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ reason, lockVersion }),
    },
  );
  if (!response.ok) {
    backWithError(back, await readableApiError('Could not override the floor', response));
  }
  revalidatePath(`/quoting/quotes/${quoteId}`);
  redirect(back);
}

/**
 * Opens the next version as a draft and goes to it. The API refuses a revision while the customer
 * is on credit hold: docs/product/requirements.md (R2).
 */
export async function reviseQuoteAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');

  const response = await apiFetch(`/quoting/quotes/${encodeURIComponent(quoteId)}/revise`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    backWithError(
      `/quoting/quotes/${encodeURIComponent(quoteId)}`,
      await readableApiError('Revise failed', response),
    );
  }
  const revision = quoteWithLinesSchema.parse(await response.json());
  revalidatePath(`/quoting/quotes/${quoteId}`);
  redirect(`/quoting/quotes/${revision.id}`);
}

/** Production's lead time on a draft quote: docs/product/requirements.md (R5). */
export async function setLeadTimeAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const path = `/quoting/quotes/${encodeURIComponent(quoteId)}`;

  const collected = collectLeadTime(formData);
  if (!collected.ok) {
    backWithError(path, collected.message);
  }

  const response = await apiFetch(`${path}/lead-time`, {
    method: 'PUT',
    body: JSON.stringify({
      leadTimeDays: collected.leadTimeDays,
      lockVersion: collected.lockVersion,
    }),
  });
  if (!response.ok) {
    backWithError(path, await readableApiError('Could not save the lead time', response));
  }
  revalidatePath(path);
  redirect(noticeUrl(path, `Lead time saved: ${leadTimeLabel(collected.leadTimeDays)}.`));
}

/**
 * Emails the quote to the contacts tagged for quotes, once the sender has confirmed that list, and
 * moves a draft to Quoted: docs/product/requirements.md (R8). A copy after the first needs
 * `confirmRedistribute`. It runs inside a submission token, so a double press sends once.
 */
export async function sendQuoteAction(formData: FormData): Promise<void> {
  await withSubmissionToken(optionalString(formData, SUBMISSION_TOKEN_FIELD), () => send(formData));
}

async function send(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const lockVersion = requireString(formData, 'lockVersion');

  const confirmRedistribute = formData.get('confirmRedistribute') !== null;

  const confirmation = confirmRecipientsBody(formData);
  const path = `/quoting/quotes/${encodeURIComponent(quoteId)}`;

  const from = formData.get('from');
  const back = returnPath(quoteId, from);

  const response = await apiFetch(`${path}/send`, {
    method: 'POST',
    body: JSON.stringify({
      lockVersion,
      confirmRedistribute,
      ...confirmation,
    }),
  });
  if (!response.ok) {
    const reason = await refusalReason(response.clone());
    const message = await readableApiError(sendRefusalPrefix(reason), response);
    backWithError(back, message, reason === 'redistribution-not-confirmed' ? { resend: '1' } : {});
  }
  revalidatePath(path);
  if (from === FROM_REVIEW) {
    const receipt = quoteSendSchema.safeParse(await response.json().catch(() => null));
    redirect(
      noticeUrl(
        path,
        sentNotice(
          readConfirmRecipients(formData),
          receipt.success ? receipt.data.acceptedByRelayAt : undefined,
        ),
      ),
    );
  }
  redirect(noticeUrl(path, 'Quote emailed to the customer.'));
}
