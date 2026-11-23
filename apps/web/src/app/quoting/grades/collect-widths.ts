// Reads the stock-width rows of the grade form. A width whose rolls per pallet are not counted yet is kept as null.
import { formatWidthIn, gradeWidthSchema, PALLETS_NOT_COUNTED, type GradeWidth } from '@erp/types';
import { optionalString } from '@erp/utils';

import { notAWidth, typedWidth } from '../../../lib/measures';

export type WidthsResult = { ok: true; rows: GradeWidth[] } | { ok: false; message: string };

export function collectWidths(formData: FormData): WidthsResult {
  const rows: GradeWidth[] = [];
  for (let i = 0; ; i += 1) {
    if (formData.get(`widths[${i}].rollWidthIn`) === null) {
      break;
    }
    if (formData.get(`widths[${i}].remove`) !== null) {
      continue;
    }

    const width = optionalString(formData, `widths[${i}].rollWidthIn`);
    const rolls = optionalString(formData, `widths[${i}].rollsPerPallet`);
    if (width === undefined && rolls === undefined) {
      continue;
    }
    if (width === undefined) {
      return {
        ok: false,
        message: `width row ${i + 1} is missing the width — fill the row in, or clear both of its boxes to drop the width.`,
      };
    }

    const rollWidthIn = typedWidth(width);
    if (rollWidthIn === undefined) {
      return { ok: false, message: `width row ${i + 1}: ${notAWidth(width)}` };
    }
    const parsed = gradeWidthSchema.safeParse({
      rollWidthIn,
      rollsPerPallet: rolls === undefined ? null : wholeNumber(rolls),
    });
    if (!parsed.success) {
      return {
        ok: false,
        message: `width row ${i + 1} — the rolls per pallet is a whole number from 1 to 10000, or blank until counted.`,
      };
    }
    rows.push(parsed.data);
  }
  return { ok: true, rows };
}

export function widthListText(width: GradeWidth): string {
  const count =
    width.rollsPerPallet === null
      ? PALLETS_NOT_COUNTED
      : `${String(width.rollsPerPallet)} a pallet`;
  return `${formatWidthIn(width.rollWidthIn)} (${count})`;
}

function wholeNumber(text: string): number {
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}
