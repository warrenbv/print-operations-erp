// Server actions that add and edit a pricing tier. Percents are typed as percents and sent as ratios.
// Only the Billing Manager or an Admin may save. The API enforces it in apps/api/src/quoting/catalog.controller.ts.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createPricingTierRequestSchema, updatePricingTierRequestSchema } from '@erp/types';
import { optionalString } from '@erp/utils';

import { apiFetch } from '../../../lib/api-fetch';
import { readableApiError } from '../../../lib/api-error';
import { percentToRatio } from '../../../lib/percent';
import { backWithError } from '../../../lib/redirect-error';
import { TIER_FIELDS } from './fields';

const PAGE = '/quoting/tiers';

function collectValues(formData: FormData): Record<string, string | number> | null {
  const values: Record<string, string | number> = {};
  for (const field of TIER_FIELDS) {
    const raw = optionalString(formData, field.name);
    if (raw === undefined) {
      backWithError(PAGE, `${field.label} is required — every tier must have one.`);
      return null;
    }
    if (field.kind === 'count') {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed)) {
        backWithError(PAGE, `${field.label} must be a whole number of pallets.`);
        return null;
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
        backWithError(PAGE, converted.message);
        return null;
      }
      values[field.name] = converted.ratio;
      continue;
    }
    values[field.name] = raw;
  }
  return values;
}

function firstIssue(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): string {
  const issue = error.issues[0];
  return issue === undefined
    ? 'Could not save the tier.'
    : `${issue.path.join('.')}: ${issue.message}`;
}

export async function updatePricingTierAction(formData: FormData): Promise<void> {
  const code = optionalString(formData, 'code');
  if (code === undefined) {
    backWithError(PAGE, 'That form did not say which tier to save.');
    return;
  }

  const values = collectValues(formData);
  if (values === null) {
    return;
  }

  const parsed = updatePricingTierRequestSchema.safeParse(values);
  if (!parsed.success) {
    backWithError(PAGE, firstIssue(parsed.error));
    return;
  }

  const response = await apiFetch(`/quoting/tiers/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: JSON.stringify(parsed.data),
  });
  if (!response.ok) {
    backWithError(PAGE, await readableApiError('Could not save that tier', response));
    return;
  }

  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=Tier+saved.`);
}

export async function createPricingTierAction(formData: FormData): Promise<void> {
  const values = collectValues(formData);
  if (values === null) {
    return;
  }
  const code = optionalString(formData, 'code');
  if (code === undefined) {
    backWithError(PAGE, 'A new tier needs a code.');
    return;
  }

  const parsed = createPricingTierRequestSchema.safeParse({ ...values, code });
  if (!parsed.success) {
    backWithError(PAGE, firstIssue(parsed.error));
    return;
  }

  const response = await apiFetch('/quoting/tiers', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  });
  if (!response.ok) {
    backWithError(PAGE, await readableApiError('Could not add that tier', response));
    return;
  }

  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=Tier+added.`);
}
