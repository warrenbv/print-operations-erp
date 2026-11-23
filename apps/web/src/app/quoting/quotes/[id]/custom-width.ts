// The custom width and custom length choices on a quote line.
// The reveal CSS shows the typed box only when Custom is chosen, with no client script: docs/decisions/004-server-first-web-ui.md.
import {
  CUSTOM_WIDTH_REFUSAL,
  ROLL_WIDTH_MAX_IN,
  ROLL_WIDTH_MIN_IN,
  type Grade,
  type QuoteLine,
} from '@erp/types';

import type { RowEcho } from './line-defaults';

export const CUSTOM_WIDTH_LABEL = 'Custom width';

export const CUSTOM_WIDTH_VALUE = 'custom';

export const CUSTOM_WIDTH_MIN = ROLL_WIDTH_MIN_IN;
export const CUSTOM_WIDTH_MAX = ROLL_WIDTH_MAX_IN;

export const LENGTH_CHOICE = { own: 'own', custom: 'custom' } as const;

export const CUSTOM_WIDTH_REVEAL_CSS = `
.line-width:not(:has(option[value="${CUSTOM_WIDTH_VALUE}"]:checked)) .custom-width-box,
.line-length:not(:has(option[value="${LENGTH_CHOICE.custom}"]:checked)) .custom-length-box {
  display: none;
}
`;

export function customWidthDefaults(
  line: QuoteLine | undefined,
  echo: RowEcho | undefined,
  grade: Grade | undefined,
): { customWidth: boolean; customWidthIn: string } {
  if (echo !== undefined) {
    return {
      customWidth: isCustomWidth(echo['rollWidthIn'], echo['customWidth']),
      customWidthIn: echo['customWidthIn'] ?? '',
    };
  }
  if (line === undefined) {
    return { customWidth: false, customWidthIn: '' };
  }
  // A stored width the grade no longer lists shows as custom, so reopening the line keeps its width.
  const offList =
    grade !== undefined && !grade.widths.some((w) => w.rollWidthIn === line.rollWidthIn);
  const custom = line.customWidth === true || offList;
  return { customWidth: custom, customWidthIn: custom ? String(line.rollWidthIn) : '' };
}

export function collectWidth(
  formData: FormData,
  i: number,
): { rollWidthIn: number | undefined; customWidth: boolean } | string {
  const selected = formData.get(`lines[${i}].rollWidthIn`);
  const flag = formData.get(`lines[${i}].customWidth`);
  if (
    !isCustomWidth(
      typeof selected === 'string' ? selected : undefined,
      typeof flag === 'string' ? flag : undefined,
    )
  ) {
    return { rollWidthIn: toNumber(selected), customWidth: false };
  }
  const typed = formData.get(`lines[${i}].customWidthIn`);
  const text = typeof typed === 'string' ? typed.trim() : '';
  if (text === '') {
    return `${CUSTOM_WIDTH_LABEL} is chosen - type the width in whole inches.`;
  }
  const width = Number(text);
  if (!/^\d+$/.test(text) || width < CUSTOM_WIDTH_MIN || width > CUSTOM_WIDTH_MAX) {
    return CUSTOM_WIDTH_REFUSAL;
  }
  return { rollWidthIn: width, customWidth: true };
}

function isCustomWidth(selected: string | undefined, flag: string | undefined): boolean {
  return selected === CUSTOM_WIDTH_VALUE || flag !== undefined;
}

export function customLengthChosen(
  echo: RowEcho | undefined,
  feetPerRollOverride: string,
): boolean {
  const posted = echo?.['lengthChoice'];
  return posted === undefined ? feetPerRollOverride !== '' : posted === LENGTH_CHOICE.custom;
}

export function collectLength(formData: FormData, i: number): string | undefined {
  if (formData.get(`lines[${i}].lengthChoice`) === LENGTH_CHOICE.own) {
    return undefined;
  }
  const typed = formData.get(`lines[${i}].feetPerRollOverride`);
  const text = typeof typed === 'string' ? typed.trim() : '';
  return text === '' ? undefined : text;
}

function toNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  return Number(value.trim());
}
