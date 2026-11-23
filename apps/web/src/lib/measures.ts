// Feet, pounds and roll widths: how they print and what a measure box accepts.
// Measures stay decimal strings and are printed without float arithmetic: docs/decisions/003-decimal-arithmetic.md.
// The roll width rules are in packages/types/src/roll-width.ts.
import {
  formatEstimatedPounds as formatSharedEstimatedPounds,
  formatMeasure,
  formatWidthIn,
  isRollWidth,
} from '@erp/types';

export function formatFeet(value: string): string {
  return formatMeasure(value);
}

export function formatOrderedPounds(value: string): string {
  return formatMeasure(value);
}

export function formatEstimatedPounds(value: string): string {
  return formatSharedEstimatedPounds(value);
}

// The `pattern` of a measure box: a positive number with at most four decimal places, the scale a measure is stored at.
export const POSITIVE_MEASURE_PATTERN = '(?=.*[1-9])\\d{1,8}(\\.\\d{1,4})?';

export function formatWidth(line: { rollWidthIn: number; customWidth?: boolean }): string {
  return `${formatWidthIn(line.rollWidthIn)}${line.customWidth === true ? ' custom' : ''}`;
}

export function typedWidth(text: string): number | undefined {
  // Only a plain decimal is read. `Number` alone would also accept forms such as "1e2" and "0x10".
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return undefined;
  }
  const width = Number(text);
  return isRollWidth(width) ? width : undefined;
}

export function notAWidth(typed: string): string {
  return `${typed} is not a width. A width is whole inches or sixteenths of an inch from 1 to 1000, typed as a decimal: 11.3125 for 11 5/16.`;
}
