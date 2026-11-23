// Server actions that add and edit a paper grade, the cost inputs of docs/product/requirements.md (R3).
// An edit sends the lockVersion the form was drawn with, so two edits cannot silently overwrite each other:
// docs/decisions/006-optimistic-concurrency.md. The API checks the role in apps/api/src/quoting/catalog.controller.ts.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  createGradeRequestSchema,
  gradeFootageRequestSchema,
  productFamilySchema,
  updateGradeRequestSchema,
  type GradeFootage,
} from '@erp/types';
import { optionalString, requireString } from '@erp/utils';

import { apiFetch } from '../../../lib/api-fetch';
import { readableApiError } from '../../../lib/api-error';
import { backWithError } from '../../../lib/redirect-error';
import { PRODUCT_FAMILY_LABELS } from '../format';
import { collectWidths } from './collect-widths';

export async function createGradeAction(formData: FormData): Promise<void> {
  const subject = subjectOf(formData);

  const family = productFamilySchema.safeParse(optionalString(formData, 'productFamily'));
  if (!family.success) {
    backWithError('/quoting/grades', `${subject}: pick a product family before saving.`);
  }

  const scalars = readScalars(formData);
  if (!scalars.ok) {
    backWithError('/quoting/grades', `${subject}: ${scalars.message}`);
  }

  const footages = collectFootages(formData);
  if (!footages.ok) {
    backWithError('/quoting/grades', `${subject}: ${footages.message}`);
  }

  const widths = collectWidths(formData);
  if (!widths.ok) {
    backWithError('/quoting/grades', `${subject}: ${widths.message}`);
  }

  const parsed = createGradeRequestSchema.safeParse({
    productFamily: family.data,
    ...scalars.values,
    footages: footages.rows,

    ...(widths.rows.length === 0 ? {} : { widths: widths.rows }),
  });
  if (!parsed.success) {
    backWithError('/quoting/grades', `${subject}: ${firstIssue(parsed.error.issues)}`);
  }

  const response = await apiFetch('/quoting/grades', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  });
  if (!response.ok) {
    backWithError('/quoting/grades', await readableApiError(`Could not add ${subject}`, response));
  }
  revalidatePath('/quoting/grades');

  redirect(`/quoting/grades?notice=${encodeURIComponent(`Grade ${scalars.values.code} added.`)}`);
}

export async function updateGradeAction(formData: FormData): Promise<void> {
  const gradeId = requireString(formData, 'gradeId');
  const subject = subjectOf(formData);

  const scalars = readScalars(formData);
  if (!scalars.ok) {
    backWithError('/quoting/grades', `${subject}: ${scalars.message}`);
  }

  const footages = collectFootages(formData);
  if (!footages.ok) {
    backWithError('/quoting/grades', `${subject}: ${footages.message}`);
  }

  const widths = collectWidths(formData);
  if (!widths.ok) {
    backWithError('/quoting/grades', `${subject}: ${widths.message}`);
  }

  // A missing or malformed version reads as 0 or NaN, which the request schema refuses.
  const lockVersion = Number(formData.get('lockVersion'));

  const parsed = updateGradeRequestSchema.safeParse({
    ...scalars.values,
    footages: footages.rows,
    widths: widths.rows,
    lockVersion,
  });
  if (!parsed.success) {
    backWithError('/quoting/grades', `${subject}: ${firstIssue(parsed.error.issues)}`);
  }

  const response = await apiFetch(`/quoting/grades/${encodeURIComponent(gradeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(parsed.data),
  });
  if (!response.ok) {
    backWithError('/quoting/grades', await readableApiError(`Could not save ${subject}`, response));
  }
  revalidatePath('/quoting/grades');
  redirect(`/quoting/grades?notice=${encodeURIComponent(`Grade ${scalars.values.code} saved.`)}`);
}

interface GradeScalars {
  code: string;
  basisWeightLb: string;
  reamAreaDivisor: string;
  paperCostPerTonne: string;
}

type ScalarResult = { ok: true; values: GradeScalars } | { ok: false; message: string };

function readScalars(formData: FormData): ScalarResult {
  const code = optionalString(formData, 'code');
  if (code === undefined) {
    return { ok: false, message: 'a grade code is required.' };
  }
  const basisWeightLb = optionalString(formData, 'basisWeightLb');
  if (basisWeightLb === undefined) {
    return { ok: false, message: 'basis weight (lb) is required.' };
  }
  const reamAreaDivisor = optionalString(formData, 'reamAreaDivisor');
  if (reamAreaDivisor === undefined) {
    return {
      ok: false,
      message: 'a ream area divisor is required — 432 for a 24×36 ream, 187 for bond.',
    };
  }
  const paperCostPerTonne = optionalString(formData, 'paperCostPerTonne');
  if (paperCostPerTonne === undefined) {
    return { ok: false, message: 'a paper cost ($/tonne) is required.' };
  }
  return { ok: true, values: { code, basisWeightLb, reamAreaDivisor, paperCostPerTonne } };
}

type FootageResult = { ok: true; rows: GradeFootage[] } | { ok: false; message: string };

function collectFootages(formData: FormData): FootageResult {
  const rows: GradeFootage[] = [];
  for (let i = 0; ; i += 1) {
    if (formData.get(`footages[${i}].variant`) === null) {
      break;
    }
    if (formData.get(`footages[${i}].remove`) !== null) {
      continue;
    }

    const variant = optionalString(formData, `footages[${i}].variant`);
    const label = optionalString(formData, `footages[${i}].label`);
    const feetPerRoll = optionalString(formData, `footages[${i}].feetPerRoll`);
    if (variant === undefined && label === undefined && feetPerRoll === undefined) {
      continue;
    }

    const missing = [
      ...(variant === undefined ? ['a variant code'] : []),
      ...(label === undefined ? ['a label'] : []),
      ...(feetPerRoll === undefined ? ['feet per roll'] : []),
    ];
    if (missing.length > 0) {
      return {
        ok: false,
        message: `footage row ${i + 1} is missing ${missing.join(' and ')} — fill the row in, or clear all three of its fields to drop the variant.`,
      };
    }

    const parsed = gradeFootageRequestSchema.safeParse({ variant, label, feetPerRoll });
    if (!parsed.success) {
      return { ok: false, message: `footage row ${i + 1} — ${firstIssue(parsed.error.issues)}` };
    }
    rows.push(parsed.data);
  }
  return { ok: true, rows };
}

function subjectOf(formData: FormData): string {
  const family = productFamilySchema.safeParse(optionalString(formData, 'productFamily'));
  const familyLabel = family.success ? PRODUCT_FAMILY_LABELS[family.data] : 'Grade';
  const code = optionalString(formData, 'code');
  return code === undefined ? familyLabel : `${familyLabel} ${code}`;
}

function firstIssue(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const issue = issues[0];
  return issue === undefined ? 'invalid input' : `${issue.path.join('.')}: ${issue.message}`;
}
