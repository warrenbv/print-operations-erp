// Reads the quote defaults form and its numbered part rows into the API's request, and rebuilds the
// form's starting values from the stored record or from echoed input.
// A part is keyed by paper and width, and two rows with the same pair are refused.
import {
  CUSTOMER_PARTS_MAX,
  putCustomerDefaultsRequestSchema,
  type CustomerPart,
  type PutCustomerDefaultsRequest,
} from '@erp/types';
import { optionalString } from '@erp/utils';

import { notAWidth, POSITIVE_MEASURE_PATTERN, typedWidth } from '../../../../../lib/measures';

const MAX_LEAD_TIME_DAYS = 3650;

const ROLL_LENGTH_TEXT = new RegExp(`^(?:${POSITIVE_MEASURE_PATTERN})$`);

export function partField(
  i: number,
  field: 'gradeId' | 'rollWidthIn' | 'partNumber' | 'description' | 'feetPerRoll' | 'remove',
): string {
  return `parts[${String(i)}].${field}`;
}

export type CollectDefaultsResult =
  { ok: true; request: PutCustomerDefaultsRequest } | { ok: false; message: string };

export function collectDefaults(formData: FormData): CollectDefaultsResult {
  const lockVersion = wholeNumber(optionalString(formData, 'lockVersion'));
  if (lockVersion === undefined) {
    return { ok: false, message: 'This form is out of date. Reload the page and try again.' };
  }

  const rawDays = optionalString(formData, 'leadTimeDays');
  const leadTimeDays = wholeNumber(rawDays);
  if (rawDays !== undefined && (leadTimeDays === undefined || leadTimeDays > MAX_LEAD_TIME_DAYS)) {
    return {
      ok: false,
      message: `A lead time is a whole number of days, 0 to ${String(MAX_LEAD_TIME_DAYS)}.`,
    };
  }

  const parts = collectParts(formData);
  if (typeof parts === 'string') {
    return { ok: false, message: parts };
  }

  const pricingBasis = optionalString(formData, 'pricingBasis');

  const tierCode = optionalString(formData, 'tierCode');
  const freightMode = optionalString(formData, 'freightMode');
  const parsed = putCustomerDefaultsRequestSchema.safeParse({
    ...(pricingBasis === undefined ? {} : { pricingBasis }),
    ...(tierCode === undefined ? {} : { tierCode }),
    ...(freightMode === undefined ? {} : { freightMode }),
    ...(leadTimeDays === undefined ? {} : { leadTimeDays }),
    parts,
    lockVersion,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      message: `Could not read the form${issue === undefined ? '' : `: ${issue.path.join('.')} ${issue.message}`}.`,
    };
  }
  return { ok: true, request: parsed.data };
}

function collectParts(formData: FormData): CustomerPart[] | string {
  const parts: CustomerPart[] = [];
  const seen = new Map<string, number>();
  // Every drawn row has a paper field, even a blank one, so the rows end at the first index without one.
  for (let i = 0; ; i += 1) {
    if (formData.get(partField(i, 'gradeId')) === null) {
      break;
    }
    if (formData.get(partField(i, 'remove')) !== null) {
      continue;
    }
    const gradeId = optionalString(formData, partField(i, 'gradeId'));
    const rawWidth = optionalString(formData, partField(i, 'rollWidthIn'));
    const partNumber = optionalString(formData, partField(i, 'partNumber'));
    const description = optionalString(formData, partField(i, 'description'));
    const feetPerRoll = optionalString(formData, partField(i, 'feetPerRoll'));

    if (
      gradeId === undefined &&
      rawWidth === undefined &&
      partNumber === undefined &&
      description === undefined &&
      feetPerRoll === undefined
    ) {
      continue;
    }
    const row = `Part ${String(i + 1)}`;
    if (gradeId === undefined) {
      return `${row}: pick a paper.`;
    }
    if (rawWidth === undefined) {
      return `${row}: enter the width, in inches.`;
    }

    const rollWidthIn = typedWidth(rawWidth);
    if (rollWidthIn === undefined) {
      return `${row}: ${notAWidth(rawWidth)}`;
    }
    if (partNumber === undefined && description === undefined) {
      return `${row}: enter a part number, a description or both.`;
    }

    if (feetPerRoll !== undefined && !ROLL_LENGTH_TEXT.test(feetPerRoll)) {
      return `${row}: Roll length must be a number of feet greater than 0, such as 1480. You entered "${feetPerRoll}".`;
    }
    const key = `${gradeId.toLowerCase()}|${String(rollWidthIn)}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      return `${row}: part ${String(earlier)} already has that paper and width.`;
    }
    seen.set(key, i + 1);
    parts.push({
      gradeId,
      rollWidthIn,
      ...(partNumber === undefined ? {} : { partNumber }),
      ...(description === undefined ? {} : { description }),
      ...(feetPerRoll === undefined ? {} : { feetPerRoll }),
    });
  }
  if (parts.length > CUSTOMER_PARTS_MAX) {
    return `An account holds at most ${String(CUSTOMER_PARTS_MAX)} parts.`;
  }
  return parts;
}

function wholeNumber(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

export interface PartRowStart {
  gradeId: string;
  rollWidthIn: string;
  partNumber: string;
  description: string;

  feetPerRoll: string;

  remove: boolean;
}

export interface DefaultsFormStart {
  pricingBasis: string;

  tierCode: string;
  freightMode: string;
  leadTimeDays: string;

  parts: PartRowStart[];
}

export function defaultsFormStart(
  stored: {
    pricingBasis?: string | undefined;
    tierCode?: string | undefined;
    freightMode?: string | undefined;
    leadTimeDays?: number | undefined;
    parts: readonly CustomerPart[];
  },
  echo: Readonly<Record<string, string>>,
): DefaultsFormStart {
  const blank: PartRowStart = {
    gradeId: '',
    rollWidthIn: '',
    partNumber: '',
    description: '',
    feetPerRoll: '',
    remove: false,
  };
  if (Object.keys(echo).length === 0) {
    return {
      pricingBasis: stored.pricingBasis ?? '',
      tierCode: stored.tierCode ?? '',
      freightMode: stored.freightMode ?? '',
      leadTimeDays: stored.leadTimeDays === undefined ? '' : String(stored.leadTimeDays),
      parts: [
        ...stored.parts.map((part) => ({
          gradeId: part.gradeId,
          rollWidthIn: String(part.rollWidthIn),
          partNumber: part.partNumber ?? '',
          description: part.description ?? '',
          feetPerRoll: part.feetPerRoll ?? '',
          remove: false,
        })),
        blank,
      ],
    };
  }
  const indices = new Set<number>();
  for (const key of Object.keys(echo)) {
    const match =
      /^parts\[(\d+)\]\.(gradeId|rollWidthIn|partNumber|description|feetPerRoll|remove)$/.exec(key);
    if (match?.[1] !== undefined) {
      indices.add(Number(match[1]));
    }
  }
  const rows = [...indices]
    .sort((a, b) => a - b)
    .map((i) => ({
      gradeId: echo[partField(i, 'gradeId')] ?? '',
      rollWidthIn: echo[partField(i, 'rollWidthIn')] ?? '',
      partNumber: echo[partField(i, 'partNumber')] ?? '',
      description: echo[partField(i, 'description')] ?? '',
      feetPerRoll: echo[partField(i, 'feetPerRoll')] ?? '',
      remove: echo[partField(i, 'remove')] !== undefined,
    }));
  return {
    pricingBasis: echo['pricingBasis'] ?? '',
    tierCode: echo['tierCode'] ?? '',
    freightMode: echo['freightMode'] ?? '',
    leadTimeDays: echo['leadTimeDays'] ?? '',
    parts: [...rows, blank],
  };
}
