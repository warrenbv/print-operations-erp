// Reads the Delivery and tax step, step 3, and the save-to-customer ticks beside it.
// Each line carries its own shipping, tax treatment and address: docs/product/requirements.md (R4).
// Step 3 posts only its own fields. Each line is rebuilt from the stored line plus those fields and read by
// apps/web/src/app/quoting/quotes/[id]/collect-lines.ts, because the API saves the whole set of lines.
import {
  TAX_STATUSES,
  formatRatePercent,
  taxCodeLookupFills,
  taxCodeLookupResponseSchema,
  type Customer,
  type Grade,
  type PostalAddress,
  type QuoteLine,
  type QuoteLineInput,
  type TaxCodeLookupRequest,
  type TaxCodeLookupResponse,
  type UpdateCustomerRequest,
} from '@erp/types';
import { optionalString } from '@erp/utils';

import { REASON_GLOSS } from '../../../../lib/api-error';
import { ECHO_PREFIX } from '../../../../lib/form-echo';
import { collectLines, type CollectResult } from './collect-lines';
import {
  SHIP_TO_FIELD,
  firstLine,
  shipToChoiceOf,
  storedLineValues,
  taxJurisdictionRevealCss,
  type ShipToChoice,
} from './line-defaults';

export const STEP_THREE_FIELDS = [
  'delivery.name',
  'delivery.line1',
  'delivery.line2',
  'delivery.city',
  'delivery.state',
  'delivery.postalCode',
  'taxStatus',
  'taxJurisdiction',
  'revenueCategory',
  'rateOverride',
  'carrierBid',
  'freightMarginPct',
] as const;

const LINE_ONE_FIELDS: ReadonlySet<string> = new Set([
  'delivery.name',
  'delivery.line1',
  'delivery.line2',
  'delivery.city',
  'delivery.state',
  'delivery.postalCode',
  'taxStatus',
  'taxJurisdiction',
]);

export const LINES_CHANGED =
  'The lines changed since this page was drawn. Open Delivery and tax again to see them.';

export const FREIGHT_IN_ROLL_PRICE_FIELD = 'freightInRollPrice';

export const FREIGHT_IN_ROLL_PRICE_LABEL = 'Include freight in the price per roll';

export const FREIGHT_IN_ROLL_PRICE_HINT =
  'The quote and order confirmation include freight in each price per roll. ' +
  'Each line still keeps its freight as a separate figure.';

export const FREIGHT_IN_ROLL_PRICE_PENDING_HINT =
  'A line still waiting on its carrier bid shows TBD until the bid is entered.';

export const FREIGHT_IN_ROLL_PRICE_READ_ONLY = 'Freight is included in the price per roll.';

export const FREIGHT_IN_ROLL_PRICE_PER_POUND_HINT =
  'Freight stays separate while a line is priced per pound, which is billed on the shipped weight.';

export function hasPerPoundLine(lines: readonly Pick<QuoteLine, 'pricingBasis'>[]): boolean {
  return lines.some((line) => line.pricingBasis === 'per_pound');
}

/**
 * The posted Include freight tick, or undefined to leave the stored setting alone. A quote with a line
 * priced per pound never sends it, because that line is billed on its shipped weight.
 */
export function postedFreightInRollPrice(
  formData: FormData,
  lines: readonly Pick<QuoteLine, 'pricingBasis'>[],
): boolean | undefined {
  if (hasPerPoundLine(lines)) {
    return undefined;
  }
  return formData.get(FREIGHT_IN_ROLL_PRICE_FIELD) !== null;
}

export function freightInRollPriceChecked(
  stored: boolean,
  echo: Readonly<Record<string, string>>,
): boolean {
  const refused = Object.keys(echo).some((key) => key.startsWith('lines['));
  return refused ? echo[FREIGHT_IN_ROLL_PRICE_FIELD] !== undefined : stored;
}

export function collectDelivery(input: {
  lines: readonly QuoteLine[];
  grades: ReadonlyMap<string, Grade>;
  formData: FormData;
}): CollectResult {
  const { lines, grades, formData } = input;

  const postedIndex = postedRows(formData);

  // The posted rows must be exactly the stored lines. Otherwise step 3's values could land on
  // lines the reader never saw, so nothing is saved.
  if (postedIndex.size !== lines.length || lines.some((line) => !postedIndex.has(line.id))) {
    return { ok: false, message: LINES_CHANGED };
  }
  const first = firstLine(lines);
  const firstRow = first === undefined ? -1 : (postedIndex.get(first.id) ?? -1);

  const built = new FormData();
  lines.forEach((line, j) => {
    const i = postedIndex.get(line.id) ?? -1;
    const choice = postedShipTo(formData, i, line.id === first?.id);
    const values = storedLineValues(line, grades.get(line.gradeId));
    for (const field of STEP_THREE_FIELDS) {
      delete values[field];
      if (choice === 'collected' && field.startsWith('delivery.')) {
        continue;
      }
      // Same as line 1 copies line 1's posted address and tax onto this line. Freight stays the line's own.
      const from = choice === 'same' && LINE_ONE_FIELDS.has(field) ? firstRow : i;
      const posted = optionalString(formData, `lines[${from}].${field}`);
      if (posted !== undefined) {
        values[field] = posted;
      }
    }
    for (const [key, value] of Object.entries(values)) {
      built.append(`lines[${j}].${key}`, value);
    }
  });

  const billingState = optionalString(formData, 'billingState');
  if (billingState !== undefined) {
    built.append('billingState', billingState);
  }
  return collectLines(built);
}

// Line 1 has no ship-to choice. It always carries its own address.
function postedShipTo(formData: FormData, index: number, isLineOne: boolean): ShipToChoice {
  if (isLineOne) {
    return 'different';
  }
  return (
    shipToChoiceOf(optionalString(formData, `lines[${index}].${SHIP_TO_FIELD}`)) ?? 'different'
  );
}

function postedRows(formData: FormData): Map<string, number> {
  const postedIndex = new Map<string, number>();
  for (let i = 0; ; i += 1) {
    const lineId = formData.get(`lines[${i}].lineId`);
    if (lineId === null) {
      break;
    }
    postedIndex.set(typeof lineId === 'string' ? lineId : '', i);
  }
  return postedIndex;
}

export const DELIVERY_SAVED = 'Delivery and tax saved.';

export const SAVE_SHIPPING_FIELD = 'saveShippingAddress';

export const SAVE_TAX_FIELD = 'saveTaxJurisdiction';

export const CUSTOMER_LOCK_FIELD = 'customerLockVersion';

export const SAVE_SHIPPING_LABEL = "Also save this as the customer's shipping address";

export const SAVE_TAX_LABEL = "Also save this tax jurisdiction on the customer's record";

export const NON_TAXABLE_TICK_HINT =
  'Only the customer page makes a customer non-taxable, because it records the reason.';

export const EXEMPT_CUSTOMER_TAX_HINT =
  'This customer is marked exempt or reseller; change that on the customer page.';

export function onFileHint(value: string | undefined): string {
  return value === undefined ? 'None on file now.' : `On file now: ${value}.`;
}

export function offersShippingTick(customer: Customer | null): boolean {
  return customer !== null;
}

export function offersTaxTick(customer: Customer | null): boolean {
  return customer !== null && !customer.taxExempt && !customer.reseller;
}

export function tickChecked(
  echo: Readonly<Record<string, string>>,
  index: number,
  field: string,
): boolean {
  return echo[`lines[${index}].${field}`] !== undefined;
}

export const DELIVERY_CARD_CLASS = 'delivery-card';

export const TAX_TICK_CLASS = 'tax-tick';

export const NON_TAX_HINT_CLASS = 'non-tax-hint';

export const TAX_TICK_REVEAL_CSS = taxTickRevealCss();

function taxTickRevealCss(): string {
  const chosen = (status: string): string =>
    `:has(select[name$=".taxStatus"] option[value="${status}"]:checked)`;
  const notTaxable = TAX_STATUSES.filter((status) => status !== 'non_tax')
    .map((status) => `:not(${chosen(status)})`)
    .join('');
  return [
    '',
    `.${DELIVERY_CARD_CLASS}${notTaxable} .${TAX_TICK_CLASS} {\n  display: none;\n}`,
    `.${DELIVERY_CARD_CLASS}:not(${chosen('non_tax')}) .${NON_TAX_HINT_CLASS} {\n  display: none;\n}`,
    '',
  ].join('\n');
}

export const TAX_JURISDICTION_REVEAL_CSS = taxJurisdictionRevealCss(DELIVERY_CARD_CLASS);

export const OWN_ADDRESS_CLASS = 'ship-to-own-address';

export const OWN_TAX_CLASS = 'ship-to-own-tax';

export const SAME_AS_LINE_ONE_CLASS = 'ship-to-same-as-line-1';

export const SHIP_TO_REVEAL_CSS = shipToRevealCss();

function shipToRevealCss(): string {
  const select = `select[name$=".${SHIP_TO_FIELD}"]`;
  const chosen = (choice: ShipToChoice): string =>
    `:has(${select} option[value="${choice}"]:checked)`;
  const card = `.${DELIVERY_CARD_CLASS}`;
  return [
    '',
    `.${OWN_ADDRESS_CLASS},\n.${OWN_TAX_CLASS} {\n  display: contents;\n}`,
    `${card}:has(${select}):not(${chosen('different')}) .${OWN_ADDRESS_CLASS} {\n  display: none;\n}`,
    `${card}${chosen('same')} .${OWN_TAX_CLASS} {\n  display: none;\n}`,
    `${card}:not(${chosen('same')}) .${SAME_AS_LINE_ONE_CLASS} {\n  display: none;\n}`,
    '',
  ].join('\n');
}

export const CUSTOMER_STALE = `Save failed: ${REASON_GLOSS['stale-aggregate'] ?? ''}`;

export const CUSTOMER_NOT_SAVED = "Delivery and tax saved. The customer's record was not changed";

const CUSTOMER_CHANGED_MEANWHILE =
  "Delivery and tax saved. The customer's record was not changed, because somebody saved the customer while this page was open. Check it on the customer page.";

const CUSTOMER_SERVER_FAILED =
  "Delivery and tax saved. The customer's record was not changed, because the server failed. Tick it again, and tell IT if it fails twice.";

export function customerNotSavedSentence(status: number): string | undefined {
  if (status === 409) {
    return CUSTOMER_CHANGED_MEANWHILE;
  }
  if (status >= 500) {
    return CUSTOMER_SERVER_FAILED;
  }
  return undefined;
}

export type CustomerWrite =
  { ok: true; body: UpdateCustomerRequest | null; notice: string } | { ok: false; message: string };

/**
 * The change to the customer record the ticks ask for, if any. Ticks that disagree are refused. The
 * write carries the customer's lockVersion from when the page was drawn, and a stale one is refused
 * before anything is saved: docs/decisions/006-optimistic-concurrency.md.
 */
export function collectCustomerWrite(input: {
  lines: readonly QuoteLine[];
  saved: readonly QuoteLineInput[];
  customer: Customer | null;
  formData: FormData;
}): CustomerWrite {
  const { lines, saved, customer, formData } = input;
  if (customer === null) {
    return { ok: true, body: null, notice: DELIVERY_SAVED };
  }
  const postedIndex = postedRows(formData);
  const ticked = (lineId: string, field: string): boolean => {
    const i = postedIndex.get(lineId);
    return i !== undefined && formData.get(`lines[${i}].${field}`) !== null;
  };
  const first = firstLine(lines);

  const addresses: { line: number; value: PostalAddress }[] = [];
  const jurisdictions: { line: number; value: string }[] = [];
  for (let j = 0; j < lines.length; j += 1) {
    const line = lines[j];
    const savedLine = saved[j];
    if (line === undefined || savedLine === undefined) {
      continue;
    }

    const n = j + 1;

    const choice = postedShipTo(formData, postedIndex.get(line.id) ?? -1, line.id === first?.id);
    if (choice === 'different' && ticked(line.id, SAVE_SHIPPING_FIELD)) {
      if (savedLine.deliveryAddress === undefined) {
        return {
          ok: false,
          message: `Line ${n} has no delivery address to save on the customer's record. Fill it in, or untick the box.`,
        };
      }
      addresses.push({ line: n, value: postalAddressOf(savedLine.deliveryAddress) });
    }
    if (choice !== 'same' && ticked(line.id, SAVE_TAX_FIELD) && offersTaxTick(customer)) {
      const { taxStatus, taxJurisdiction } = savedLine.taxTreatment;
      if (taxStatus !== 'non_tax' && taxJurisdiction !== undefined) {
        jurisdictions.push({ line: n, value: taxJurisdiction });
      }
    }
  }

  if (new Set(addresses.map(({ value }) => addressKey(value))).size > 1) {
    return {
      ok: false,
      message: conflict(
        addresses.map(({ line }) => line),
        'a shipping address',
        'the addresses differ',
      ),
    };
  }
  if (new Set(jurisdictions.map(({ value }) => value)).size > 1) {
    return {
      ok: false,
      message: conflict(
        jurisdictions.map(({ line }) => line),
        'a tax jurisdiction',
        'the jurisdictions differ',
      ),
    };
  }

  const sentences: string[] = [];
  let shippingAddress: PostalAddress | undefined;
  let taxJurisdiction: string | undefined;
  const address = addresses[0];
  if (address !== undefined) {
    const which = linesText(addresses.map(({ line }) => line));
    const onFile = customer.shippingAddress;
    if (onFile !== undefined && addressKey(onFile) === addressKey(address.value)) {
      sentences.push(`The customer's shipping address already matched ${which}.`);
    } else {
      shippingAddress = address.value;
      sentences.push(`The customer's shipping address now matches ${which}.`);
    }
  }
  const jurisdiction = jurisdictions[0];
  if (jurisdiction !== undefined) {
    const which = linesText(jurisdictions.map(({ line }) => line));
    if (customer.taxJurisdiction === jurisdiction.value) {
      sentences.push(`The customer's tax jurisdiction already matched ${which}.`);
    } else {
      taxJurisdiction = jurisdiction.value;
      sentences.push(`The customer's tax jurisdiction now matches ${which}.`);
    }
  }
  const notice = [DELIVERY_SAVED, ...sentences].join(' ');
  if (shippingAddress === undefined && taxJurisdiction === undefined) {
    return { ok: true, body: null, notice };
  }

  const drawnAt = optionalString(formData, CUSTOMER_LOCK_FIELD);
  if (drawnAt === undefined || !/^\d+$/.test(drawnAt) || Number(drawnAt) !== customer.lockVersion) {
    return { ok: false, message: CUSTOMER_STALE };
  }
  return {
    ok: true,
    body: {
      ...(shippingAddress === undefined ? {} : { shippingAddress }),
      ...(taxJurisdiction === undefined ? {} : { taxJurisdiction }),
      lockVersion: Number(drawnAt),
    },
    notice,
  };
}

export function postsCustomerTick(formData: FormData): boolean {
  for (const i of postedRows(formData).values()) {
    if (
      formData.get(`lines[${i}].${SAVE_SHIPPING_FIELD}`) !== null ||
      formData.get(`lines[${i}].${SAVE_TAX_FIELD}`) !== null
    ) {
      return true;
    }
  }
  return false;
}

function postalAddressOf(address: PostalAddress): PostalAddress {
  return {
    ...(address.name === undefined ? {} : { name: address.name }),
    line1: address.line1,
    ...(address.line2 === undefined ? {} : { line2: address.line2 }),
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
  };
}

function addressKey(address: PostalAddress): string {
  return JSON.stringify([
    address.name ?? '',
    address.line1,
    address.line2 ?? '',
    address.city,
    address.state,
    address.postalCode,
  ]);
}

function linesText(numbers: readonly number[]): string {
  if (numbers.length < 2) {
    return `line ${numbers.join('')}`;
  }
  const last = numbers.slice(-1).join('');
  return `lines ${numbers.slice(0, -1).join(', ')} and ${last}`;
}

function conflict(numbers: readonly number[], what: string, differ: string): string {
  const which = linesText(numbers);
  const both = numbers.length === 2 ? 'both' : 'all';
  return (
    `${which.charAt(0).toUpperCase()}${which.slice(1)} are ${both} ticked to save ${what} ` +
    `on the customer's record, and ${differ}. Untick one, or make them match.`
  );
}

export const TAX_LOOKUP_LABEL = 'Look up tax code';

export function taxLookupAriaLabel(lineNumber: number): string {
  return `${TAX_LOOKUP_LABEL} for line ${String(lineNumber)}`;
}

export function lookupAddress(
  formData: FormData,
  index: number,
  firstRow: number,
): TaxCodeLookupRequest {
  const choice = postedShipTo(formData, index, index === firstRow);
  if (choice === 'collected') {
    return { line1: '', city: '', postalCode: '', state: '' };
  }
  const from = choice === 'same' ? firstRow : index;
  const box = (field: string): string =>
    optionalString(formData, `lines[${from}].delivery.${field}`) ?? '';
  return {
    line1: box('line1'),
    city: box('city'),
    postalCode: box('postalCode'),
    state: box('state'),
  };
}

export type TaxLookupResult = TaxCodeLookupResponse | { readonly outcome: 'save_first' };

export const TAX_LOOKUP_SAVE_FIRST = 'Save the step first, then look up the code.';

const LOOKUP_PREFIX = 'lookup.';
const LOOKUP_FIELDS = [
  'outcome',
  'locationCode',
  'key',
  'name',
  'ourRate',
  'effectiveFrom',
  'stateRate',
] as const;

/**
 * The page to return to after a tax-code lookup. The answer and the typed form travel in the query
 * string, so the page redraws them with no client state: docs/decisions/004-server-first-web-ui.md.
 * A matched code fills the line's jurisdiction box. The lookup never supplies a rate: see the tax code
 * lookup entry in docs/decisions/README.md.
 */
export function lookupRedirect(input: {
  readonly path: string;
  readonly index: number;
  readonly lineNumber: number;
  readonly echo: Readonly<Record<string, string>>;
  readonly lockVersion: string;
  readonly result: TaxLookupResult;
}): string {
  const { path, index, lineNumber, echo, lockVersion, result } = input;
  const answer = result.outcome === 'save_first' ? undefined : result;
  const fill =
    answer !== undefined && taxCodeLookupFills(answer)
      ? { [`${ECHO_PREFIX}lines[${String(index)}].taxJurisdiction`]: answer.key }
      : {};
  const carried =
    Object.keys(echo).length === 0 ? {} : { ...echo, ...fill, linesDrawnAt: lockVersion };
  const lookup: Record<string, string> = { [`${LOOKUP_PREFIX}line`]: String(index) };
  for (const field of LOOKUP_FIELDS) {
    const value = (result as Partial<Record<(typeof LOOKUP_FIELDS)[number], string>>)[field];
    if (value !== undefined) {
      lookup[`${LOOKUP_PREFIX}${field}`] = value;
    }
  }
  return `${path}?${new URLSearchParams({ ...carried, ...lookup }).toString()}#line-${String(lineNumber)}`;
}

export function lookupFromQuery(
  query: Readonly<Record<string, string | string[] | undefined>>,
): { readonly index: number; readonly result: TaxLookupResult } | undefined {
  const line = query[`${LOOKUP_PREFIX}line`];
  if (typeof line !== 'string' || !/^\d+$/.test(line)) {
    return undefined;
  }
  const fields: Record<string, string> = {};
  for (const field of LOOKUP_FIELDS) {
    const value = query[`${LOOKUP_PREFIX}${field}`];
    if (typeof value === 'string') {
      fields[field] = value;
    }
  }
  if (fields['outcome'] === 'save_first') {
    return { index: Number(line), result: { outcome: 'save_first' } };
  }
  const parsed = taxCodeLookupResponseSchema.safeParse(fields);
  return parsed.success ? { index: Number(line), result: parsed.data } : undefined;
}

export function taxLookupSentence(result: TaxLookupResult): string {
  switch (result.outcome) {
    case 'save_first':
      return TAX_LOOKUP_SAVE_FIRST;
    case 'matched':
      return filled('The state matched this address', result, 'Press Save to keep it.');
    case 'matched_zip4':
      return filled('The state matched the ZIP+4', result, 'Check the address before you save.');
    case 'corrected':
      return filled(
        'The state corrected the address to find it',
        result,
        'Check the address before you save.',
      );
    case 'not_loaded':
      return (
        `The state says location ${result.locationCode ?? ''}, but no rate is loaded for ` +
        `${result.key ?? ''}. Load the current quarter on Settings > Tax rates.`
      );
    case 'zip_only':
      return 'The state matched only the ZIP code, which covers more than one tax location. Type the code.';
    case 'not_found':
      return 'The state found no match for this address. Type the code.';
    case 'unavailable':
      return "The state's lookup could not be reached. Type the code as before.";
    case 'not_washington':
      return 'This line does not ship to Washington.';
    case 'incomplete_address':
      return 'The lookup is for a Washington street address. Type the street and ZIP first.';
  }
}

function filled(lead: string, answer: TaxCodeLookupResponse, close: string): string {
  const place = answer.name === undefined ? answer.key : `${answer.key ?? ''} ${answer.name}`;
  const ours = answer.ourRate === undefined ? undefined : formatRatePercent(answer.ourRate);
  const theirs = answer.stateRate === undefined ? undefined : formatRatePercent(answer.stateRate);
  const differs =
    ours !== undefined && theirs !== undefined && ours !== theirs
      ? ` The state's rate is ${theirs}, not ${ours}, so the current quarter may not be loaded yet.`
      : '';
  return `${lead}: ${place ?? ''}, our rate ${ours ?? ''} from ${answer.effectiveFrom ?? ''}.${differs} ${close}`;
}
