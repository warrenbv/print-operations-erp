// Server action that saves the pricing constants. Percents are typed as percents and sent as ratios.
// Only the Billing Manager or an Admin may save. The API enforces it in apps/api/src/quoting/catalog.controller.ts.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { updatePricingConfigRequestSchema } from '@erp/types';
import { optionalString } from '@erp/utils';

import { apiFetch } from '../../../lib/api-fetch';
import { readableApiError } from '../../../lib/api-error';
import { percentToRatio } from '../../../lib/percent';
import { backWithError } from '../../../lib/redirect-error';
import { CONFIG_FIELDS } from './fields';

export async function updatePricingConfigAction(formData: FormData): Promise<void> {
  const values: Record<string, string | number> = {};
  for (const field of CONFIG_FIELDS) {
    const raw = optionalString(formData, field.name);
    if (raw === undefined) {
      backWithError(
        '/quoting/config',
        `${field.label} is required — every constant must have a value.`,
      );
      return;
    }
    if (field.kind === 'count') {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed)) {
        backWithError('/quoting/config', `${field.label} must be a whole number.`);
        return;
      }
      values[field.name] = parsed;
      continue;
    }
    if (field.kind === 'percent') {
      const converted = percentToRatio(raw, {
        subject: field.label,
        ...(field.maxExclusive === undefined ? {} : { maxExclusive: field.maxExclusive }),
      });
      if (!converted.ok) {
        backWithError('/quoting/config', converted.message);
        return;
      }
      values[field.name] = converted.ratio;
      continue;
    }
    values[field.name] = raw;
  }

  const parsed = updatePricingConfigRequestSchema.safeParse(values);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    backWithError(
      '/quoting/config',
      issue === undefined
        ? 'Could not save the pricing constants.'
        : `${issue.path.join('.')}: ${issue.message}`,
    );
    return;
  }

  const response = await apiFetch('/quoting/config', {
    method: 'PATCH',
    body: JSON.stringify(parsed.data),
  });
  if (!response.ok) {
    backWithError(
      '/quoting/config',
      await readableApiError('Could not save the pricing constants', response),
    );
    return;
  }

  revalidatePath('/quoting/config');
  redirect('/quoting/config?notice=Pricing+constants+saved.');
}
