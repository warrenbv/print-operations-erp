// Server action that checks or loads a quarter of tax rates. Checking is a dry run and writes nothing.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { importTaxRatesResponseSchema, taxRateImportFormatSchema } from '@erp/types';

import { apiFetch } from '../../../lib/api-fetch';
import { readableApiError } from '../../../lib/api-error';
import { backWithError, errorUrl, noticeUrl } from '../../../lib/redirect-error';
import { summariseLoad } from './load-summary';
import { ratesBody } from './rates-body';

const TAX_RATES = '/quoting/tax-rates';

export async function loadTaxRatesAction(formData: FormData): Promise<void> {
  const format = taxRateImportFormatSchema.safeParse(formData.get('format'));
  if (!format.success) {
    backWithError(TAX_RATES, 'Choose which layout the rates are in.');
  }

  // Anything but an explicit apply is a check, so a stray submit never writes rates.
  const dryRun = formData.get('intent') !== 'apply';

  const load = await ratesBody(formData.get('file'), formData.get('text'), format.data, dryRun);
  if ('refusal' in load) {
    backWithError(TAX_RATES, load.refusal);
  }

  const response = await apiFetch('/quoting/tax-rates/import', {
    method: 'POST',
    body: load.body,
  });
  if (!response.ok) {
    backWithError(TAX_RATES, await readableApiError('Could not read those rates', response));
  }

  const report = importTaxRatesResponseSchema.parse(await response.json());
  const summary = summariseLoad(report);

  if (!report.dryRun && !report.refused) {
    revalidatePath(TAX_RATES);
  }

  redirect(
    summary.channel === 'error'
      ? errorUrl(TAX_RATES, summary.message)
      : noticeUrl(TAX_RATES, summary.message),
  );
}
