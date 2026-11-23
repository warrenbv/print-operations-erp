// Server actions of the Delivery and tax step: save the step, and look up a tax code for one line.
// The step saves through the same lines route as step 2, after apps/web/src/app/quoting/quotes/[id]/collect-delivery.ts rebuilds each line.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { taxCodeLookupResponseSchema, type TaxCodeLookupResponse } from '@erp/types';
import { requireString } from '@erp/utils';

import { apiFetch } from '../../../../../lib/api-fetch';
import { readableApiError } from '../../../../../lib/api-error';
import { echoOf } from '../../../../../lib/form-echo';
import { backWithError, noticeUrl } from '../../../../../lib/redirect-error';
import {
  CUSTOMER_NOT_SAVED,
  FREIGHT_IN_ROLL_PRICE_FIELD,
  collectCustomerWrite,
  collectDelivery,
  customerNotSavedSentence,
  lookupAddress,
  lookupRedirect,
  postedFreightInRollPrice,
  postsCustomerTick,
} from '../collect-delivery';
import { firstLine } from '../line-defaults';
import { loadCustomer, loadGrades, loadQuote } from '../loaders';

function stepEcho(formData: FormData): Record<string, string> {
  return echoOf(
    formData,
    (name) => name.startsWith('lines[') || name === FREIGHT_IN_ROLL_PRICE_FIELD,
  );
}

export async function saveDeliveryAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const path = `/quoting/quotes/${encodeURIComponent(quoteId)}/delivery`;

  const echo = stepEcho(formData);
  const lockVersion = requireString(formData, 'lockVersion');

  const refuse = (message: string): never =>
    backWithError(
      path,
      message,
      Object.keys(echo).length === 0 ? {} : { ...echo, linesDrawnAt: lockVersion },
    );

  const [quote, grades] = await Promise.all([loadQuote(quoteId), loadGrades()]);
  if (quote === null) {
    return refuse('This quote could not be loaded.');
  }

  const collected = collectDelivery({
    lines: quote.lines,
    grades: new Map(grades.map((grade) => [grade.id, grade])),
    formData,
  });
  if (!collected.ok) {
    return refuse(collected.message);
  }

  const customer = postsCustomerTick(formData) ? await loadCustomer(quote.customerId) : null;
  const write = collectCustomerWrite({
    lines: quote.lines,
    saved: collected.lines,
    customer,
    formData,
  });
  if (!write.ok) {
    return refuse(write.message);
  }

  const freightInRollPrice = postedFreightInRollPrice(formData, quote.lines);
  const response = await apiFetch(`/quoting/quotes/${encodeURIComponent(quoteId)}/lines`, {
    method: 'PUT',
    body: JSON.stringify({
      lines: collected.lines,
      lockVersion,
      ...(freightInRollPrice === undefined ? {} : { freightInRollPrice }),
    }),
  });
  if (!response.ok) {
    return refuse(await readableApiError('Save failed', response));
  }
  revalidatePath(`/quoting/quotes/${quoteId}`);
  revalidatePath(`/quoting/quotes/${quoteId}/delivery`);

  // The customer is written only after the lines are saved. If that write fails, the lines stay
  // saved and the message says the customer's record was not changed.
  if (write.body !== null) {
    const patched = await apiFetch(`/crm/customers/${encodeURIComponent(quote.customerId)}`, {
      method: 'PATCH',
      body: JSON.stringify(write.body),
    });
    if (!patched.ok) {
      return backWithError(
        path,
        customerNotSavedSentence(patched.status) ??
          (await readableApiError(CUSTOMER_NOT_SAVED, patched)),
      );
    }
    revalidatePath(`/crm/customers/${quote.customerId}`);
  }
  redirect(noticeUrl(path, write.notice));
}

const UNAVAILABLE: TaxCodeLookupResponse = { outcome: 'unavailable' };

export async function lookUpTaxCodeAction(index: number, formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const path = `/quoting/quotes/${encodeURIComponent(quoteId)}/delivery`;
  const echo = stepEcho(formData);
  const lockVersion = requireString(formData, 'lockVersion');
  const refuse = (message: string): never =>
    backWithError(
      path,
      message,
      Object.keys(echo).length === 0 ? {} : { ...echo, linesDrawnAt: lockVersion },
    );

  const quote = await loadQuote(quoteId);
  if (quote === null) {
    return refuse('This quote could not be loaded.');
  }

  if (!Number.isInteger(index) || index < 0) {
    return refuse('That line could not be found on this quote.');
  }
  const rowOf = (lineId: string | undefined): number => {
    for (let i = 0; ; i += 1) {
      const posted = formData.get(`lines[${String(i)}].lineId`);
      if (posted === null) return -1;
      if (posted === lineId) return i;
    }
  };
  const pressed = quote.lines.find((line) => rowOf(line.id) === index);
  const lineNumber = pressed?.lineNumber ?? index + 1;
  const go = (result: Parameters<typeof lookupRedirect>[0]['result']): never =>
    redirect(lookupRedirect({ path, index, lineNumber, echo, lockVersion, result }));

  // An empty echo means the typed form cannot ride back in the URL, because nothing was typed or
  // it is too long to carry (apps/web/src/lib/form-echo.ts). The lookup then asks for a save first.
  if (Object.keys(echo).length === 0) {
    return go({ outcome: 'save_first' });
  }

  const address = lookupAddress(formData, index, rowOf(firstLine(quote.lines)?.id));
  // Any failure of the lookup reads as unavailable. The page then asks for the code to be typed.
  let answer = UNAVAILABLE;
  try {
    const response = await apiFetch('/quoting/tax-code-lookup', {
      method: 'POST',
      body: JSON.stringify(address),
    });
    if (response.ok) {
      const parsed = taxCodeLookupResponseSchema.safeParse(await response.json());
      answer = parsed.success ? parsed.data : UNAVAILABLE;
    }
  } catch {
    answer = UNAVAILABLE;
  }
  return go(answer);
}
