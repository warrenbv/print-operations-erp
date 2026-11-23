// Server actions of the convert page: create the orders, add a delivery column, remove one.
// Any signed-in user may convert. The API records who converted from the session: docs/product/requirements.md (R10).
// The order copies the quote's lines at the quoted prices: docs/product/requirements.md (R9).
'use server';

import { redirect } from 'next/navigation';

import {
  CREATE_ORDERS_MAX_DELIVERIES,
  createOrdersResponseSchema,
  orderWithLinesSchema,
} from '@erp/types';
import { optionalString, requireString } from '@erp/utils';

import { apiFetch } from '../../../../../lib/api-fetch';
import { readableApiError } from '../../../../../lib/api-error';
import { echoOf } from '../../../../../lib/form-echo';
import { backWithError, noticeUrl } from '../../../../../lib/redirect-error';
import { SUBMISSION_TOKEN_FIELD, withSubmissionToken } from '../../../../../lib/submission-token';
import { attachPoDocument, chosenFile } from '../../../../orders/[id]/attach-po-document';
import {
  AT_CAPACITY,
  DELIVERIES_FIELD,
  convertField,
  convertPageUrl,
  deliveryCount,
  gridLines,
  isConvertField,
  maxDeliveries,
  overNotice,
  withoutDelivery,
} from './convert-grid';
import {
  createdNotice,
  documentRefusedUrl,
  ordersCreatedUrl,
  refusedPress,
} from './convert-po-document';
import { toConvertPress } from './convert-request';
import { loadOrderedSoFar, loadQuote } from './loaders';

function convertPath(quoteId: string): string {
  return `/quoting/quotes/${encodeURIComponent(quoteId)}/convert`;
}

/**
 * Creates the orders. It runs inside a submission token, so a second press of the same form
 * creates nothing more: apps/web/src/lib/submission-token.ts.
 */
export async function convertQuoteAction(formData: FormData): Promise<void> {
  await withSubmissionToken(optionalString(formData, SUBMISSION_TOKEN_FIELD), async () => {
    const quoteId = requireString(formData, 'quoteId');
    const back = convertPath(quoteId);
    const posted = formData.get(DELIVERIES_FIELD);
    const poFile = chosenFile(formData.get('poDocument'));
    const refused = (message: string): string => refusedPress(message, poFile !== undefined);

    const echoWith = (columns: number) => ({
      ...echoOf(formData, isConvertField),
      [DELIVERIES_FIELD]: String(columns),
    });

    const [quote, soFar] = await Promise.all([loadQuote(quoteId), loadOrderedSoFar(quoteId)]);
    if (quote === null) {
      backWithError(
        back,
        refused('Converting to an order failed: the quote was not found.'),
        echoWith(deliveryCount(posted, CREATE_ORDERS_MAX_DELIVERIES)),
      );
    }
    // The column count is clamped to what the page may hold, so a hand-edited count cannot exceed it.
    const lines = gridLines(quote.lines, soFar);
    const columns = deliveryCount(posted, maxDeliveries(lines));
    const echo = echoWith(columns);
    const box = (name: string): string => {
      const value = formData.get(name);
      return typeof value === 'string' ? value : '';
    };

    const outcome = toConvertPress({
      quoteId,
      poNumber: optionalString(formData, 'poNumber'),
      columns,
      date: (column) => optionalString(formData, convertField.date(column)),
      lines,
      boxes: (line, column) => ({
        rolls: box(convertField.rolls(line.quoteLineId, column)),
        pounds: box(convertField.pounds(line.quoteLineId, column)),
      }),
    });
    if (!outcome.ok) {
      backWithError(back, refused(outcome.message), echo);
    }

    if (outcome.kind === 'one') {
      const created = await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify(outcome.request),
      });

      if (!created.ok) {
        backWithError(
          back,
          refused(await readableApiError('Converting to an order failed', created)),
          echo,
        );
      }
      const order = orderWithLinesSchema.parse(await created.json());

      const orderPath = `/orders/${order.id}`;
      const notice = overNotice(lines, outcome.request.lines ?? []);

      // The order already exists here. A failed attachment does not undo it. The order page says
      // the document was not attached.
      if (poFile !== undefined) {
        let refusal: string | undefined;
        let threw = false;
        try {
          refusal = await attachPoDocument(order.id, poFile);
        } catch {
          threw = true;
        }
        if (threw || refusal !== undefined) {
          redirect(documentRefusedUrl(orderPath, refusal, notice));
        }
      }
      redirect(notice === undefined ? orderPath : noticeUrl(orderPath, notice));
    }

    const created = await apiFetch('/orders/deliveries', {
      method: 'POST',
      body: JSON.stringify(outcome.request),
    });
    if (!created.ok) {
      backWithError(
        back,
        refused(await readableApiError('Creating the orders failed', created)),
        echo,
      );
    }
    const { items: orders } = createOrdersResponseSchema.parse(await created.json());
    const { deliveries } = outcome.request;
    const notice = createdNotice(
      outcome.request.poNumber,
      deliveries.map((delivery) => delivery.requestedDate),
      overNotice(
        lines,
        deliveries.flatMap((delivery) => delivery.lines),
      ),
    );
    const quotePath = `/quoting/quotes/${encodeURIComponent(quoteId)}`;

    // The same PO document is attached to every order made from this PO. Orders it failed on are
    // listed on the quote page rather than undone.
    const missing: string[] = [];
    let refusal: string | undefined;
    if (poFile !== undefined) {
      for (const order of orders) {
        let said: string | undefined;
        let threw = false;
        try {
          said = await attachPoDocument(order.id, poFile);
        } catch {
          threw = true;
        }
        if (threw || said !== undefined) {
          missing.push(order.id);
          refusal ??= said;
        }
      }
    }
    redirect(
      ordersCreatedUrl(quotePath, notice, { orderIds: missing, made: orders.length, refusal }),
    );
  });
}

export async function addDeliveryAction(formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const quote = await loadQuote(quoteId);
  const max = maxDeliveries(quote === null ? [] : gridLines(quote.lines, new Map()));
  const columns = deliveryCount(formData.get(DELIVERIES_FIELD), max);
  const echo = echoOf(formData, isConvertField);
  if (columns >= max) {
    backWithError(convertPath(quoteId), AT_CAPACITY, {
      ...echo,
      [DELIVERIES_FIELD]: String(columns),
    });
  }
  redirect(convertPageUrl(quoteId, columns + 1, echo));
}

export async function removeDeliveryAction(removed: number, formData: FormData): Promise<void> {
  const quoteId = requireString(formData, 'quoteId');
  const quote = await loadQuote(quoteId);
  const lines = quote === null ? [] : gridLines(quote.lines, new Map());
  const columns = deliveryCount(formData.get(DELIVERIES_FIELD), maxDeliveries(lines));
  if (columns < 2 || !Number.isInteger(removed) || removed < 1 || removed > columns) {
    redirect(convertPageUrl(quoteId, columns, echoOf(formData, isConvertField)));
  }

  const values: Record<string, string> = {};
  formData.forEach((value, name) => {
    if (typeof value === 'string' && isConvertField(name)) values[name] = value;
  });
  const kept = new FormData();
  for (const [name, value] of Object.entries(withoutDelivery(values, lines, columns, removed))) {
    kept.append(name, value);
  }
  redirect(convertPageUrl(quoteId, columns - 1, echoOf(kept, isConvertField)));
}
