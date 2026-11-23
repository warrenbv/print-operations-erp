// The rows of the price build-up page: each line's cost, tier, margin, floor and freight: docs/product/requirements.md (R3).
// Every figure is the one stored on the line. Nothing is priced again here: docs/decisions/004-server-first-web-ui.md.
import {
  formatMeasure,
  formatMoney,
  formatRatePercent,
  freightKnowledge,
  gradeLabel,
  PALLETS_NOT_COUNTED,
  type Grade,
  type QuoteLine,
} from '@erp/types';

import { formatEstimatedPounds, formatFeet, formatWidth } from '../../../../../lib/measures';
import { formatPricePerPound } from '../../../../../lib/price-per-pound';
import { SHIPPING_MODE_LABELS, freightCaveat } from '../../../format';

interface BuildUpRow {
  readonly label: string;
  readonly value: string;
  readonly note?: string;

  readonly strong?: boolean;
}

export interface BuildUpGroup {
  readonly title: string;
  readonly rows: readonly BuildUpRow[];

  readonly after?: string;
}

export const HALF_CENT_SENTENCE =
  'The total is rounded once, so the figures above can differ from it by half a cent.';

const PALLET_COST_LEFT_OUT = 'not counted for this width, left out';

const TIER_WITHOUT_PALLET_COUNT = 'pallet count not known, priced as one pallet';

export const NOT_RECORDED_SENTENCE =
  'Not recorded on the line: the tier multiplier, the overwrap rate, the floor percentage a ' +
  'passing line cleared, and the rates behind the cost figures.';

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

const rolls = (count: number): string => `${String(count)} roll${count === 1 ? '' : 's'}`;

function freightFigure(line: QuoteLine, value: string): string {
  switch (freightKnowledge(line.freightResult)) {
    case 'known':
      return formatMoney(value);
    case 'unknown':
      return 'pending';
    case 'partial':
      return `${formatMoney(value)} plus the bid to come`;
  }
}

export function buildUpHeading(line: QuoteLine, grade: Grade | undefined): string {
  const paper = grade === undefined ? line.gradeId : gradeLabel(grade);
  return `Line ${String(line.lineNumber)} · ${paper} · ${formatWidth(line)} × ${formatFeet(
    line.cost.feetPerRoll,
  )} ft · ${rolls(line.quantityRolls)}`;
}

export function buildUpOf(line: QuoteLine, grade: Grade | undefined): readonly BuildUpGroup[] {
  const perPound = line.pricingBasis === 'per_pound';
  const caveat = freightCaveat(freightKnowledge(line.freightResult)) ?? '';

  const asked: BuildUpRow[] = [
    { label: 'Paper', value: grade === undefined ? line.gradeId : gradeLabel(grade) },
    {
      label: 'Footage',
      value: `${formatFeet(line.cost.feetPerRoll)} ft (${line.footageVariant})`,
      ...(line.feetPerRollOverride === undefined ? {} : { note: 'a custom length' }),
    },
    { label: 'Width', value: formatWidth(line) },
    { label: 'Quantity', value: rolls(line.quantityRolls) },
    ...(perPound && line.orderedWeightLb !== undefined
      ? [{ label: 'Pounds ordered', value: `${formatMeasure(line.orderedWeightLb)} lb` }]
      : []),
    { label: 'Priced', value: perPound ? 'per pound' : 'per roll' },
    { label: 'Printed', value: yesNo(line.printed) },
    { label: 'Overwrap', value: yesNo(line.overwrap) },
    ...(line.convertCostPerTon === undefined
      ? []
      : [{ label: 'Converting cost / ton', value: formatMoney(line.convertCostPerTon) }]),
    ...(line.printCostPerTon === undefined
      ? []
      : [{ label: 'Print cost / ton', value: formatMoney(line.printCostPerTon) }]),
  ];

  const uncounted = line.pallets === null;

  const cost: BuildUpRow[] = [
    { label: 'Est. roll weight', value: `${formatMeasure(line.cost.rollWeightLb)} lb` },
    { label: 'Paper cost / lb', value: formatMoney(line.cost.paperCostPerLb) },
    { label: 'Paper / roll', value: formatMoney(line.cost.paperCostPerRoll) },
    { label: 'Hardware / roll', value: formatMoney(line.cost.hardwareCostPerRoll) },

    ...(uncounted ? [{ label: 'Pallet cost', value: PALLET_COST_LEFT_OUT }] : []),
    { label: 'Add-ons / roll', value: formatMoney(line.cost.addOnCostPerRoll) },
    { label: 'Total cost / roll', value: formatMoney(line.cost.totalCostPerRoll), strong: true },
    {
      label: 'Footage used',
      value:
        line.cost.rollsPerPallet === null
          ? `${formatFeet(line.cost.feetPerRoll)} ft`
          : `${formatFeet(line.cost.feetPerRoll)} ft · ${String(line.cost.rollsPerPallet)} / pallet`,
    },
  ];

  const tierNote =
    line.tier.source === 'override'
      ? 'tier hand-picked'
      : uncounted
        ? TIER_WITHOUT_PALLET_COUNT
        : 'chosen by the pallet count';
  const price: BuildUpRow[] = [
    line.pallets === null
      ? { label: 'Pallets', value: PALLETS_NOT_COUNTED }
      : {
          label: 'Pallets',
          value: String(line.pallets),
          note: 'the rolls over the rolls per pallet',
        },
    {
      label: 'Tier',
      value: `${line.tier.name} at ${formatRatePercent(line.tier.marginPct)}`,
      note: tierNote,
    },
    ...basePriceRows(line),
    { label: 'Margin as priced', value: formatRatePercent(line.marginPct) },
    line.floor.status === 'below_floor'
      ? {
          label: 'Floor',
          value: `BREACHED at ${formatRatePercent(line.floor.floorPct)}`,
          note: `minimum ${formatMoney(line.floor.minimumPricePerRoll)} / roll`,
        }
      : { label: 'Floor', value: 'met' },
    ...(perPound ? perPoundRows(line) : []),
    {
      label: perPound ? 'Per-roll equivalent' : 'Price / roll',
      value: formatMoney(line.pricePerRoll),
      note: priceNote(line, perPound),
      strong: !perPound,
    },
  ];

  const { freight } = line;
  const freightRows: BuildUpRow[] = [
    { label: 'Shipping', value: SHIPPING_MODE_LABELS[freight.mode] },
    ...((freight.mode === 'our_vehicle' || freight.mode === 'pass_through') &&
    freight.rateOverride !== undefined
      ? [{ label: 'Rate override', value: formatMoney(freight.rateOverride) }]
      : []),
    ...(freight.mode === 'pass_through' || freight.mode === 'carrier'
      ? [
          {
            label: 'Carrier bid',
            value: freight.carrierBid === undefined ? 'pending' : formatMoney(freight.carrierBid),
          },
        ]
      : []),
    ...(freight.mode === 'carrier' && freight.freightMarginPct !== undefined
      ? [{ label: 'Freight margin %', value: formatRatePercent(freight.freightMarginPct) }]
      : []),
    { label: 'Freight cost', value: freightFigure(line, line.freightResult.cost) },
    { label: 'Freight margin', value: freightFigure(line, line.freightResult.margin) },
    {
      label: 'Freight on the invoice',
      value: freightFigure(line, line.freightResult.invoiceTotal),
      strong: true,
    },
  ];

  const extended: BuildUpRow[] = [
    {
      label: 'Delivered / roll',
      value: `${formatMoney(line.deliveredPricePerRoll)}${caveat}`,
      note: 'the price per roll plus its share of freight',
    },
    {
      label: 'Extended price',
      value: `${formatMoney(line.extendedPrice)}${caveat}`,
      ...(perPound ? { note: 'an estimate: the price per pound times the pounds ordered' } : {}),
      strong: true,
    },
    { label: 'Extended cost', value: formatMoney(line.extendedCost) },
    { label: 'Extended margin', value: formatMoney(line.extendedMargin) },
  ];

  return [
    { title: 'What the line asks for', rows: asked },
    { title: 'Cost build-up', rows: cost, after: HALF_CENT_SENTENCE },
    { title: 'Price', rows: price },
    { title: 'Freight', rows: freightRows },
    { title: 'Delivered and extended', rows: extended },
  ];
}

function basePriceRows(line: QuoteLine): BuildUpRow[] {
  const cost = formatMoney(line.cost.totalCostPerRoll);
  if (line.marginOverridePct === undefined || line.marginPricePerRoll === undefined) {
    return [
      {
        label: 'Base price / roll',
        value: `${cost} ÷ (1 − ${formatRatePercent(line.tier.marginPct)}) = ${formatMoney(
          line.basePricePerRoll,
        )}`,
      },
    ];
  }
  return [
    {
      label: 'Margin entered manually',
      value: formatRatePercent(line.marginOverridePct),
      note: 'replaces the tier',
    },
    {
      label: 'Base price / roll',
      value: `${cost} ÷ (1 − ${formatRatePercent(line.marginOverridePct)}) = ${formatMoney(
        line.marginPricePerRoll,
      )}`,
    },
    {
      label: 'Tier price / roll',
      value: formatMoney(line.basePricePerRoll),
      note: 'what the tier would have charged',
    },
  ];
}

function perPoundRows(line: QuoteLine): BuildUpRow[] {
  return [
    ...(line.basePricePerLb === undefined
      ? []
      : [
          {
            label: line.priceSource === 'margin' ? 'Tier price / lb' : 'Engine price / lb',
            value: formatPricePerPound(line.basePricePerLb),
          },
        ]),

    ...(line.overridePricePerLb === undefined
      ? []
      : [
          {
            label:
              line.priceSource === 'agreed'
                ? 'Customer’s agreed price / lb'
                : 'Hand-set price / lb',
            value: formatPricePerPound(line.overridePricePerLb),
          },
        ]),
    ...(line.productPricePerLb === undefined
      ? []
      : [
          {
            label: 'Price per Pound',
            value: formatPricePerPound(line.productPricePerLb),
            note: 'product only, before freight',
            strong: true,
          },
        ]),
    {
      label: 'Estimated weight',
      value: `${formatEstimatedPounds(line.estimatedWeightLb)} lb`,
      note: 'from roll geometry, never billed',
    },
  ];
}

function priceNote(line: QuoteLine, perPound: boolean): string {
  if (perPound) {
    return `the price per pound times ${formatMeasure(line.cost.rollWeightLb)} lb, and what the floor is judged on`;
  }
  if (line.priceSource === 'manual') {
    return `hand-set, tier price ${formatMoney(line.basePricePerRoll)}`;
  }
  if (line.priceSource === 'agreed') {
    return `customer’s agreed price, tier price ${formatMoney(line.basePricePerRoll)}`;
  }
  return line.overwrap ? 'the base price with overwrap' : 'the base price';
}
