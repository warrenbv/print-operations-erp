// The starting value of every field on a line form, and the CSS that reveals fields without client script.
// A field starts from the refused post if there was one, else the stored line, else the customer's seed.
// Rarely needed fields fold under More options: docs/product/requirements.md (R3) and docs/product/ux-direction.md.
import type {
  DeliveryAddress,
  Grade,
  PostalAddress,
  QuoteLine,
  ShippingMode,
  TaxStatus,
} from '@erp/types';
import {
  MARGIN_ENTERED_MAX,
  SHIPPING_MODES,
  formatMoney,
  formatPricePerPound,
  formatRatePercent,
  gradeLabel,
} from '@erp/types';

import { addressText } from '../../../../lib/address';
import { formatFeet } from '../../../../lib/measures';
import { ratioToPercent } from '../../../../lib/percent';
import { SHIPPING_MODE_LABELS, marginEnteredWords } from '../../format';
import { customWidthDefaults } from './custom-width';
import type { LineSeed } from './customer-seed';

export interface TaxSeed {
  taxStatus: TaxStatus | '';
  taxJurisdiction: string;
}

export interface VariantOption {
  readonly value: string;
  readonly label: string;
}

interface PaperOption {
  readonly value: string;

  readonly label: string;
}

export interface PaperGroup {
  readonly gradeId: string;
  readonly label: string;
  readonly options: readonly PaperOption[];
}

export { gradeLabel };

const PAPER_VALUE_SEPARATOR = ':';

// One select picks the grade and its footage variant, so its value carries both, joined by the separator.
export function paperValue(gradeId: string, footageVariant: string): string {
  return gradeId === '' ? '' : `${gradeId}${PAPER_VALUE_SEPARATOR}${footageVariant}`;
}

export function splitPaperValue(value: string): { gradeId: string; footageVariant: string } {
  const at = value.indexOf(PAPER_VALUE_SEPARATOR);
  return at === -1
    ? { gradeId: value, footageVariant: '' }
    : { gradeId: value.slice(0, at), footageVariant: value.slice(at + 1) };
}

export function paperGroups(grades: readonly Grade[]): readonly PaperGroup[] {
  return grades.map((grade) => ({
    gradeId: grade.id,
    label: gradeLabel(grade),
    options: grade.footages.map((f) => ({
      value: paperValue(grade.id, f.variant),

      label: `${gradeLabel(grade)} — ${formatFeet(f.feetPerRoll)} ft — ${f.label}`,
    })),
  }));
}

export function catalogVariants(grades: readonly Grade[]): readonly VariantOption[] {
  const byVariant = new Map<string, string>();
  for (const grade of grades) {
    for (const f of grade.footages) {
      if (!byVariant.has(f.variant)) {
        byVariant.set(f.variant, f.label);
      }
    }
  }
  return [...byVariant.entries()].map(([value, label]) => ({ value, label }));
}

export type RowEcho = Readonly<Record<string, string>>;

/**
 * One row's slice of a refused post. Undefined when the post carried no line fields at all, so the
 * form falls back to the stored line. A row missing from a post that did carry lines gets an empty echo.
 */
export function rowEcho(
  echo: Readonly<Record<string, string>>,
  index: number,
): RowEcho | undefined {
  const prefix = `lines[${index}].`;
  const any = Object.keys(echo).some((key) => key.startsWith('lines['));
  if (!any) {
    return undefined;
  }
  const row: Record<string, string> = {};
  for (const [key, value] of Object.entries(echo)) {
    if (key.startsWith(prefix)) {
      row[key.slice(prefix.length)] = value;
    }
  }
  return row;
}

// A blank row whose echo holds only a paper choice has nothing typed to keep, so it starts from
// the customer's seed with that paper chosen.
export function blankRowStart(
  echo: RowEcho | undefined,
  newLinePaper: string | undefined,
): { echo: RowEcho | undefined; chosenPaper: string | undefined } {
  const onlyPaper =
    echo !== undefined && Object.keys(echo).every((key) => key === 'paper' || key === OPEN_FIELD);
  return {
    echo: onlyPaper ? undefined : echo,
    chosenPaper: newLinePaper ?? (onlyPaper ? echo['paper'] : undefined),
  };
}

export function coreDefaults(
  line: QuoteLine | undefined,
  echo: RowEcho | undefined,

  seed: LineSeed = {},
): {
  gradeId: string;
  footageVariant: string;

  feetPerRollOverride: string;
  rollWidthIn: string;
  quantityRolls: string;
  overwrap: boolean;
  printed: boolean;

  tierOverrideCode: string;

  marginOverridePct: string;
  overridePricePerRoll: string;

  overridePricePerLb: string;

  pricingBasis: string;

  orderedWeightLb: string;

  customerPartNumber: string;

  customerDescription: string;

  convertCostPerTon: string;
  printCostPerTon: string;
  freightMode: string;
} {
  if (echo !== undefined) {
    const paper = splitPaperValue(echo['paper'] ?? '');
    return {
      gradeId: paper.gradeId,
      footageVariant: paper.footageVariant,
      feetPerRollOverride: echo['feetPerRollOverride'] ?? '',
      rollWidthIn: echo['rollWidthIn'] ?? '',
      quantityRolls: echo['quantityRolls'] ?? '',

      overwrap: echo['overwrap'] !== undefined,
      printed: echo['printed'] !== undefined,
      tierOverrideCode: echo['tierOverrideCode'] ?? '',

      marginOverridePct: echo['marginOverridePct'] ?? '',
      overridePricePerRoll: echo['overridePricePerRoll'] ?? '',
      overridePricePerLb: echo['overridePricePerLb'] ?? '',

      pricingBasis: echo['pricingBasis'] ?? 'per_roll',
      orderedWeightLb: echo['orderedWeightLb'] ?? '',
      customerPartNumber: echo['customerPartNumber'] ?? '',
      customerDescription: echo['customerDescription'] ?? '',

      convertCostPerTon: echo['convertCostPerTon'] ?? '',
      printCostPerTon: echo['printCostPerTon'] ?? '',

      freightMode: echo['freightMode'] ?? 'pickup',
    };
  }
  return {
    gradeId: line?.gradeId ?? '',
    footageVariant: line?.footageVariant ?? '',
    feetPerRollOverride: line?.feetPerRollOverride ?? '',
    rollWidthIn: line === undefined ? '' : String(line.rollWidthIn),
    quantityRolls: line === undefined ? '' : String(line.quantityRolls),
    overwrap: line?.overwrap === true,
    printed: line?.printed === true,

    tierOverrideCode:
      line === undefined
        ? (seed.tierCode ?? '')
        : line.marginOverridePct !== undefined
          ? MARGIN_ENTERED_CHOICE
          : (line.tierOverrideCode ?? ''),
    marginOverridePct:
      line?.marginOverridePct === undefined ? '' : ratioToPercent(line.marginOverridePct),
    overridePricePerRoll: line?.overridePricePerRoll ?? '',
    overridePricePerLb: line?.overridePricePerLb ?? '',
    pricingBasis: line === undefined ? (seed.pricingBasis ?? 'per_roll') : line.pricingBasis,
    orderedWeightLb: line?.orderedWeightLb ?? '',
    customerPartNumber: line?.customerPartNumber ?? '',
    customerDescription: line?.customerDescription ?? '',
    convertCostPerTon: line?.convertCostPerTon ?? '',
    printCostPerTon: line?.printCostPerTon ?? '',
    freightMode: line === undefined ? (seed.freightMode ?? 'pickup') : line.freight.mode,
  };
}

/**
 * Whether the stored grade, variant and width are still on offer. One that is not is shown
 * as stored, so opening a line never changes it silently.
 */
export function storedListed(
  line: QuoteLine | undefined,
  core: { footageVariant: string; rollWidthIn: string },
  grade: Grade | undefined,
  variantOptions: readonly { value: string }[],

  widths: readonly { rollWidthIn: number }[],
): { grade: boolean; variant: boolean; width: boolean } {
  return {
    grade: line === undefined || grade !== undefined,
    variant: line === undefined || variantOptions.some((o) => o.value === core.footageVariant),
    width: line === undefined || widths.some((w) => String(w.rollWidthIn) === core.rollWidthIn),
  };
}

export interface FreightValues {
  readonly rateOverride: string;
  readonly carrierBid: string;
  readonly freightMargin: string;
}

export function freightDefaults(
  line: QuoteLine | undefined,
  echo: RowEcho | undefined,
): FreightValues {
  if (echo !== undefined) {
    return {
      rateOverride: echo['rateOverride'] ?? '',
      carrierBid: echo['carrierBid'] ?? '',
      freightMargin: echo['freightMarginPct'] ?? '',
    };
  }
  const freight = line?.freight;
  return {
    rateOverride:
      freight !== undefined && (freight.mode === 'our_vehicle' || freight.mode === 'pass_through')
        ? (freight.rateOverride ?? '')
        : '',
    carrierBid:
      freight === undefined
        ? ''
        : freight.mode === 'pass_through' || freight.mode === 'carrier'
          ? (freight.carrierBid ?? '')
          : '',

    freightMargin:
      freight !== undefined && freight.mode === 'carrier' && freight.freightMarginPct !== undefined
        ? ratioToPercent(freight.freightMarginPct)
        : '',
  };
}

export type DeliveryDefaults = Record<keyof DeliveryAddress, string>;

export function deliveryDefaults(
  line: QuoteLine | undefined,
  seed: PostalAddress | undefined,
  echo: RowEcho | undefined,
): DeliveryDefaults {
  if (echo !== undefined) {
    return {
      name: echo['delivery.name'] ?? '',
      line1: echo['delivery.line1'] ?? '',
      line2: echo['delivery.line2'] ?? '',
      city: echo['delivery.city'] ?? '',
      state: echo['delivery.state'] ?? '',
      postalCode: echo['delivery.postalCode'] ?? '',
    };
  }

  const address = line === undefined ? seed : line.deliveryAddress;
  return {
    name: address?.name ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    postalCode: address?.postalCode ?? '',
  };
}

export function taxAndRevenueDefaults(
  line: QuoteLine | undefined,
  taxSeed: TaxSeed,
  echo: RowEcho | undefined,
): { revenueCategory: string; taxStatus: string; taxJurisdiction: string } {
  if (echo !== undefined) {
    return {
      revenueCategory: echo['revenueCategory'] ?? 'print',
      taxStatus: echo['taxStatus'] ?? '',
      taxJurisdiction: echo['taxJurisdiction'] ?? '',
    };
  }
  const taxStatus = line === undefined ? taxSeed.taxStatus : line.taxStatus;
  const code = line === undefined ? taxSeed.taxJurisdiction : (line.taxJurisdiction ?? '');
  const washington: TaxStatus = 'wa_tax';
  return {
    revenueCategory: line?.revenueCategory ?? 'print',
    taxStatus,
    taxJurisdiction: taxStatus === washington ? code : '',
  };
}

export function firstLine(lines: readonly QuoteLine[]): QuoteLine | undefined {
  let first: QuoteLine | undefined;
  for (const line of lines) {
    if (first === undefined || line.lineNumber < first.lineNumber) {
      first = line;
    }
  }
  return first;
}

export function firstAddressedLine(lines: readonly QuoteLine[]): QuoteLine | undefined {
  let first: QuoteLine | undefined;
  for (const line of lines) {
    if (
      line.deliveryAddress !== undefined &&
      (first === undefined || line.lineNumber < first.lineNumber)
    ) {
      first = line;
    }
  }
  return first;
}

export interface NewLineSeeds {
  readonly shippingSeed: PostalAddress | undefined;
  readonly taxSeed: TaxSeed;
}

/**
 * Where a new line's address and tax start: line 1 if it has an address, else the customer's shipping
 * address with the customer's tax seed, else the first line that has an address.
 */
export function newLineSeeds(
  shippingAddress: PostalAddress | undefined,
  customerTaxSeed: TaxSeed,
  lines: readonly QuoteLine[],
): NewLineSeeds {
  const first = firstLine(lines);
  if (first?.deliveryAddress !== undefined) {
    return { shippingSeed: first.deliveryAddress, taxSeed: taxPairOf(first) };
  }
  if (shippingAddress !== undefined) {
    return { shippingSeed: shippingAddress, taxSeed: customerTaxSeed };
  }
  const source = firstAddressedLine(lines);
  if (source === undefined) {
    return { shippingSeed: undefined, taxSeed: customerTaxSeed };
  }
  return { shippingSeed: source.deliveryAddress, taxSeed: taxPairOf(source) };
}

function taxPairOf(line: Pick<QuoteLine, 'taxStatus' | 'taxJurisdiction'>): TaxSeed {
  return { taxStatus: line.taxStatus, taxJurisdiction: line.taxJurisdiction ?? '' };
}

export const SHIP_TO_FIELD = 'shipTo';

export const SHIP_TO_CHOICES = ['same', 'different', 'collected'] as const;

export type ShipToChoice = (typeof SHIP_TO_CHOICES)[number];

export const SHIP_TO_LABELS: Readonly<Record<ShipToChoice, string>> = {
  same: 'Same as line 1',
  different: 'A different address',
  collected: 'No delivery address (collected)',
};

export function shipToChoiceOf(value: string | undefined): ShipToChoice | undefined {
  return SHIP_TO_CHOICES.find((choice) => choice === value);
}

export function shipToStart(input: {
  line: Pick<QuoteLine, 'deliveryAddress' | 'taxStatus' | 'taxJurisdiction'>;
  first: Pick<QuoteLine, 'deliveryAddress' | 'taxStatus' | 'taxJurisdiction'>;
  row: RowEcho | undefined;
}): ShipToChoice {
  const { line, first, row } = input;
  if (row !== undefined) {
    return shipToChoiceOf(row[SHIP_TO_FIELD]) ?? 'different';
  }
  if (
    sameAddress(line.deliveryAddress, first.deliveryAddress) &&
    line.taxStatus === first.taxStatus &&
    (line.taxJurisdiction ?? '') === (first.taxJurisdiction ?? '')
  ) {
    return 'same';
  }
  return line.deliveryAddress === undefined ? 'collected' : 'different';
}

const ADDRESS_PARTS = ['name', 'line1', 'line2', 'city', 'state', 'postalCode'] as const;

function sameAddress(a: DeliveryAddress | undefined, b: DeliveryAddress | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return ADDRESS_PARTS.every((part) => (a[part] ?? '') === (b[part] ?? ''));
}

export const SAME_AS_LINE_ONE_NOTE = "Saving copies line 1's address and tax onto this line.";

export function lineOneSavedAddress(first: Pick<QuoteLine, 'deliveryAddress'>): string | undefined {
  return first.deliveryAddress === undefined
    ? undefined
    : `Line 1's saved address: ${addressText(first.deliveryAddress)}.`;
}

export const OPEN_FIELD = 'open';

export function openForms(input: {
  lineCount: number;
  echo: Readonly<Record<string, string>>;
  edit: string | undefined;
  add: boolean;
  newLinePaper: string | undefined;
}): { stored: ReadonlySet<number>; blank: boolean } {
  const stored = new Set<number>();
  for (let i = 0; i < input.lineCount; i += 1) {
    if (input.echo[`lines[${i}].${OPEN_FIELD}`] !== undefined) {
      stored.add(i);
    }
  }
  const edit = input.edit === undefined ? Number.NaN : Number(input.edit);
  if (Number.isInteger(edit) && edit >= 1 && edit <= input.lineCount) {
    stored.add(edit - 1);
  }
  const blank =
    input.lineCount === 0 ||
    input.add ||
    input.newLinePaper !== undefined ||
    input.echo[`lines[${input.lineCount}].${OPEN_FIELD}`] !== undefined;
  return { stored, blank };
}

export type MoreOptionsValues = Pick<
  ReturnType<typeof coreDefaults>,
  | 'pricingBasis'
  | 'tierOverrideCode'
  | 'marginOverridePct'
  | 'overridePricePerRoll'
  | 'overridePricePerLb'
  | 'orderedWeightLb'
  | 'customerDescription'
  | 'customerPartNumber'
  | 'printed'
  | 'overwrap'
  | 'convertCostPerTon'
  | 'printCostPerTon'
  | 'freightMode'
> &
  FreightValues;

// Only the freight boxes the chosen mode reads count. A value left in a box the mode ignores is not shown.
function countedFreight(values: MoreOptionsValues): FreightValues {
  const mode = SHIPPING_MODES.find((m) => m === values.freightMode);
  const reads = mode === undefined ? NO_FREIGHT_BOXES : freightBoxes(mode);
  return {
    rateOverride: reads.rateOverride ? values.rateOverride : '',
    carrierBid: reads.carrierBid ? values.carrierBid : '',
    freightMargin: reads.freightMargin ? values.freightMargin : '',
  };
}

export function moreOptionsSum(
  values: MoreOptionsValues,
  tiers: readonly { code: string; name: string }[],
): string {
  const perPound = values.pricingBasis === 'per_pound';
  const tier = tiers.find((t) => t.code === values.tierOverrideCode);
  const parts = [
    perPound ? 'priced per pound' : 'priced per roll',
    values.tierOverrideCode === MARGIN_ENTERED_CHOICE
      ? values.marginOverridePct === ''
        ? 'margin entered manually'
        : `margin entered manually, ${percentText(values.marginOverridePct)}`
      : values.tierOverrideCode === ''
        ? 'tier by volume'
        : `${tier?.name ?? values.tierOverrideCode} tier`,
  ];
  if (perPound && values.orderedWeightLb !== '') {
    parts.push(`${values.orderedWeightLb} lb ordered`);
  }
  if (values.overridePricePerRoll !== '') {
    parts.push(`hand-set ${moneyText(values.overridePricePerRoll)} / roll`);
  }
  if (values.overridePricePerLb !== '') {
    parts.push(`hand-set ${perPoundText(values.overridePricePerLb)} / lb`);
  }
  const freight = countedFreight(values);
  if (freight.rateOverride !== '') {
    parts.push(`rate override ${moneyText(freight.rateOverride)}`);
  }
  if (freight.carrierBid !== '') {
    parts.push(`carrier bid ${moneyText(freight.carrierBid)}`);
  }
  if (freight.freightMargin !== '') {
    parts.push(`freight margin ${percentText(freight.freightMargin)}`);
  }
  parts.push(
    `${values.printed ? 'printed' : 'plain'}, ${values.overwrap ? 'overwrap' : 'no overwrap'}`,
  );
  if (values.convertCostPerTon !== '') {
    parts.push(`converting ${moneyText(values.convertCostPerTon)} / ton`);
  }
  if (values.printCostPerTon !== '') {
    parts.push(`print ${moneyText(values.printCostPerTon)} / ton`);
  }
  parts.push(
    values.customerDescription === ''
      ? 'no customer description'
      : `described as "${values.customerDescription}"`,
  );
  if (values.customerPartNumber !== '') {
    parts.push(`part ${values.customerPartNumber}`);
  }
  return parts.join(' · ');
}

// More options opens by itself when a folded field holds a value, so a set value is never hidden.
export function moreOptionsOpen(values: MoreOptionsValues): boolean {
  const freight = countedFreight(values);
  return (
    values.pricingBasis !== 'per_roll' ||
    values.tierOverrideCode !== '' ||
    values.overridePricePerRoll !== '' ||
    values.overridePricePerLb !== '' ||
    values.orderedWeightLb !== '' ||
    values.customerDescription !== '' ||
    values.customerPartNumber !== '' ||
    values.printed ||
    values.overwrap ||
    values.convertCostPerTon !== '' ||
    values.printCostPerTon !== '' ||
    freight.rateOverride !== '' ||
    freight.carrierBid !== '' ||
    freight.freightMargin !== ''
  );
}

export type FreightBox = keyof FreightValues;

export const FREIGHT_BOX_ORDER: readonly FreightBox[] = [
  'rateOverride',
  'carrierBid',
  'freightMargin',
];

export const FREIGHT_FIELD: Readonly<Record<FreightBox, string>> = {
  rateOverride: 'rateOverride',
  carrierBid: 'carrierBid',
  freightMargin: 'freightMarginPct',
};

export function freightBoxes(mode: ShippingMode): Record<FreightBox, boolean> {
  return {
    rateOverride: mode === 'our_vehicle' || mode === 'pass_through',
    carrierBid: mode === 'pass_through' || mode === 'carrier',
    freightMargin: mode === 'carrier',
  };
}

export const ALL_FREIGHT_BOXES: Readonly<Record<FreightBox, boolean>> = {
  rateOverride: true,
  carrierBid: true,
  freightMargin: true,
};

const NO_FREIGHT_BOXES: Readonly<Record<FreightBox, boolean>> = {
  rateOverride: false,
  carrierBid: false,
  freightMargin: false,
};

export const LINE_FORM_CLASS = 'line-form';

export const FREIGHT_ROW_CLASS = 'freight-row';

export const FREIGHT_BOX_CLASS: Readonly<Record<FreightBox, string>> = {
  rateOverride: 'freight-rate',
  carrierBid: 'freight-bid',
  freightMargin: 'freight-margin',
};

export const LINE_FREIGHT_REVEAL_CSS = lineFreightRevealCss();

function lineFreightRevealCss(): string {
  const chosen = (mode: ShippingMode): string =>
    `:has(select[name$=".freightMode"] option[value="${mode}"]:checked)`;
  const boxRules = FREIGHT_BOX_ORDER.map((box) => {
    const readers = SHIPPING_MODES.filter((mode) => freightBoxes(mode)[box]);
    const unread = readers.map((mode) => `:not(${chosen(mode)})`).join('');
    return `.${LINE_FORM_CLASS}${unread} .${FREIGHT_BOX_CLASS[box]} {\n  display: none;\n}`;
  });
  const readsNone = SHIPPING_MODES.filter((mode) =>
    FREIGHT_BOX_ORDER.every((box) => !freightBoxes(mode)[box]),
  );
  const rowRule =
    readsNone.length === 0
      ? []
      : [
          `${readsNone
            .map((mode) => `.${LINE_FORM_CLASS}${chosen(mode)} .${FREIGHT_ROW_CLASS}`)
            .join(',\n')} {\n  display: none;\n}`,
        ];
  return `\n${[...boxRules, ...rowRule].join('\n')}\n`;
}

export const TAX_JURISDICTION_CLASS = 'tax-jurisdiction';

export function taxJurisdictionRevealCss(scope: string): string {
  const washington: TaxStatus = 'wa_tax';
  const chosen = `:has(select[name$=".taxStatus"] option[value="${washington}"]:checked)`;
  return [
    '',
    `.${TAX_JURISDICTION_CLASS} {\n  display: contents;\n}`,
    `.${scope}:not(${chosen}) .${TAX_JURISDICTION_CLASS} {\n  display: none;\n}`,
    '',
  ].join('\n');
}

export const LINE_TAX_JURISDICTION_REVEAL_CSS = taxJurisdictionRevealCss(LINE_FORM_CLASS);

export const COST_PER_TON_PATTERN = '\\d+(\\.\\d{1,4})?';

export const PRINTED_NO_PRINT_COST_HINT =
  'Printed, with no print cost entered, so printing adds nothing to the price.';

export const PRINTED_NO_PRINT_COST_CLASS = 'printed-no-print-cost';

export const PRINTED_NO_PRINT_COST_CSS = `
.${PRINTED_NO_PRINT_COST_CLASS} {
  display: none;
}
.${LINE_FORM_CLASS}:has(input[name$=".printed"]:checked):has(input[name$=".printCostPerTon"]:placeholder-shown) .${PRINTED_NO_PRINT_COST_CLASS} {
  display: contents;
}
`;

export const MARGIN_ENTERED_CHOICE = 'entered-margin';

export const MARGIN_ENTERED_LABEL = 'Enter margin manually';

export const MARGIN_PERCENT_PATTERN = '\\d+(\\.\\d)?';

export const MARGIN_ENTERED_MAX_PERCENT = ratioToPercent(MARGIN_ENTERED_MAX);

export const MARGIN_FLOOR_FIELD = 'marginFloorPct';

export function marginEnteredHint(marginFloorPct: string): string {
  return (
    `From ${formatRatePercent(marginFloorPct)} to ${MARGIN_ENTERED_MAX_PERCENT}%, ` +
    'to one decimal place. Needs no approval.'
  );
}

export const MARGIN_ROW_CLASS = 'line-margin';

export const MARGIN_BOX_CLASS = 'margin-entered-box';

export const MARGIN_ENTERED_REVEAL_CSS = `
.${MARGIN_ROW_CLASS}:not(:has(option[value="${MARGIN_ENTERED_CHOICE}"]:checked)) .${MARGIN_BOX_CLASS} {
  display: none;
}
`;

export interface DeliveryTaxValues {
  readonly taxStatus: string;
  readonly taxJurisdiction: string;
  readonly revenueCategory: string;
  readonly delivery: DeliveryDefaults;
}

export function deliveryTaxValues(
  line: QuoteLine | undefined,
  taxSeed: TaxSeed,
  shippingSeed: PostalAddress | undefined,
  echo: RowEcho | undefined,
): DeliveryTaxValues {
  const taxAndRevenue = taxAndRevenueDefaults(line, taxSeed, echo);
  return {
    taxStatus: taxAndRevenue.taxStatus,
    taxJurisdiction: taxAndRevenue.taxJurisdiction,
    revenueCategory: taxAndRevenue.revenueCategory,
    delivery: deliveryDefaults(line, shippingSeed, echo),
  };
}

/**
 * Step 3's values for a line on the Lines step, as hidden inputs, so saving the lines keeps them.
 * Tax is left out when the line asks for it in visible boxes instead (`lineAsksTax`), so the form
 * never posts the field twice.
 */
export function stepThreeHiddenValues(
  values: DeliveryTaxValues,
  omitTax: boolean,
): Record<string, string> {
  const fields: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(values.delivery).map(([field, value]) => [`delivery.${field}`, value]),
    ),
    ...(omitTax ? {} : { taxStatus: values.taxStatus, taxJurisdiction: values.taxJurisdiction }),
    revenueCategory: values.revenueCategory,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ''));
}

// A line asks for its tax on the Lines step when it has no treatment yet, or a treatment that needs a
// jurisdiction but has none, or when a new row was refused and must show what was posted.
export function lineAsksTax(
  rendered: { taxStatus: string; taxJurisdiction: string },
  refused: boolean,
): boolean {
  const washington: TaxStatus = 'wa_tax';
  return (
    refused ||
    rendered.taxStatus === '' ||
    (rendered.taxStatus === washington && rendered.taxJurisdiction === '')
  );
}

/**
 * A stored line as the form fields that would save it unchanged. The Lines step posts these for
 * folded lines, and the Delivery and tax step starts each line from them.
 */
export function storedLineValues(
  line: QuoteLine,

  grade: Grade | undefined,
): Record<string, string> {
  const core = coreDefaults(line, undefined);
  const custom = customWidthDefaults(line, undefined, grade);
  const freight = freightDefaults(line, undefined);
  const taxAndRevenue = taxAndRevenueDefaults(
    line,
    { taxStatus: '', taxJurisdiction: '' },
    undefined,
  );
  const delivery = deliveryDefaults(line, undefined, undefined);
  const values: Record<string, string> = {
    paper: paperValue(core.gradeId, core.footageVariant),
    rollWidthIn: core.rollWidthIn,
    ...(custom.customWidth ? { customWidth: 'on', customWidthIn: custom.customWidthIn } : {}),
    feetPerRollOverride: core.feetPerRollOverride,
    quantityRolls: core.quantityRolls,
    ...(core.overwrap ? { overwrap: 'on' } : {}),
    ...(core.printed ? { printed: 'on' } : {}),
    tierOverrideCode: core.tierOverrideCode,
    marginOverridePct: core.marginOverridePct,
    overridePricePerRoll: core.overridePricePerRoll,
    overridePricePerLb: core.overridePricePerLb,
    pricingBasis: core.pricingBasis,
    orderedWeightLb: core.orderedWeightLb,
    customerPartNumber: core.customerPartNumber,
    customerDescription: core.customerDescription,
    convertCostPerTon: core.convertCostPerTon,
    printCostPerTon: core.printCostPerTon,
    freightMode: core.freightMode,
    rateOverride: freight.rateOverride,
    carrierBid: freight.carrierBid,
    freightMarginPct: freight.freightMargin,
    revenueCategory: taxAndRevenue.revenueCategory,
    taxStatus: taxAndRevenue.taxStatus,
    taxJurisdiction: taxAndRevenue.taxJurisdiction,
    ...Object.fromEntries(
      Object.entries(delivery).map(([field, value]) => [`delivery.${field}`, value]),
    ),
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
}

export function summaryPricedAt(
  line: Pick<QuoteLine, 'tier' | 'marginPct' | 'marginOverridePct'>,
): string {
  if (line.marginOverridePct === undefined) {
    return `${line.tier.name} tier, ${formatRatePercent(line.marginPct)} margin`;
  }
  const words = marginEnteredWords(line.marginOverridePct);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export interface TypedPriceWords {
  readonly label: string;

  readonly inline: string;

  readonly tierPrice: string;
}

export function typedPriceWords(
  line: Pick<
    QuoteLine,
    | 'priceSource'
    | 'pricingBasis'
    | 'overridePricePerRoll'
    | 'overridePricePerLb'
    | 'basePricePerRoll'
    | 'basePricePerLb'
  >,
): TypedPriceWords | undefined {
  const tierPrice =
    line.pricingBasis === 'per_pound' && line.basePricePerLb !== undefined
      ? `${formatPricePerPound(line.basePricePerLb)} / lb`
      : formatMoney(line.basePricePerRoll);
  if (line.priceSource === 'agreed') {
    return { label: 'Customer’s agreed price', inline: 'customer’s agreed price', tierPrice };
  }
  if (line.overridePricePerRoll !== undefined || line.overridePricePerLb !== undefined) {
    return { label: 'Hand-set price', inline: 'hand-set', tierPrice };
  }
  return undefined;
}

export function deliveryWords(mode: ShippingMode, address: DeliveryAddress | undefined): string {
  const label = SHIPPING_MODE_LABELS[mode];
  return address === undefined ? label : `${label} · ${address.city}, ${address.state}`;
}

function moneyText(typed: string): string {
  return /^\d+(\.\d+)?$/.test(typed) ? formatMoney(typed) : typed;
}

function perPoundText(typed: string): string {
  return `$${typed}`;
}

function percentText(typed: string): string {
  return /^\d+(\.\d+)?$/.test(typed) ? `${typed}%` : typed;
}
