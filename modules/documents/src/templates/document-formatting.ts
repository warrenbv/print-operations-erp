// Cell and label wording shared by the quote and the order confirmation, so both documents describe
// a line, its price and its freight the same way.
import {
  deliveredPricePerRollOf,
  describeGoods,
  freightKnowledge,
  formatEstimatedPounds,
  formatMeasure,
  formatMoney,
  formatPricePerPound,
  formatWidthIn,
  type FreightResult,
  type LinePaper,
  type PricingBasis,
} from '@erp/types';
import type { LineItemsBlock } from '../document-model';

export const FREIGHT_TBD = 'TBD';

/**
 * Freight waiting on a carrier bid prints the `FREIGHT_TBD` marker, never a figure:
 * docs/product/requirements.md (R4). A partial result prints the known part plus the marker.
 */
export function freightText(result: FreightResult): string {
  switch (freightKnowledge(result)) {
    case 'known':
      return formatMoney(result.invoiceTotal);
    case 'unknown':
      return FREIGHT_TBD;
    case 'partial':
      return `${formatMoney(result.invoiceTotal)} + ${FREIGHT_TBD}`;
  }
}

export function rollSpec(line: RollSpecLine): string {
  return `${rollWidth(line)} × ${rollLength(line)}`;
}

function rollLength(line: Pick<RollSpecLine, 'footageVariant' | 'feetPerRoll'>): string {
  return line.feetPerRoll === undefined
    ? line.footageVariant
    : `${formatMeasure(line.feetPerRoll)} ft (${line.footageVariant})`;
}

export function rollSpecForCustomer(line: RollSpecLine): string {
  return line.feetPerRoll === undefined
    ? rollSpec(line)
    : `${rollWidth(line)} × ${formatMeasure(line.feetPerRoll)} ft`;
}

interface RollSpecLine {
  rollWidthIn: number;

  customWidth?: boolean;
  footageVariant: string;
  feetPerRoll?: string;
}

function rollWidth(line: Pick<RollSpecLine, 'rollWidthIn' | 'customWidth'>): string {
  return `${formatWidthIn(line.rollWidthIn)}${line.customWidth === true ? ' custom' : ''}`;
}

const CUSTOMER_PART_LABEL = 'Part';

export function describeLine(
  spec: string,
  line: {
    customerPartNumber?: string | undefined;
    customerDescription?: string | undefined;
    rollWidthIn: number;
    feetPerRoll?: string | undefined;
  },
  paper: LinePaper | undefined,
): string {
  return withPartNumber(describeGoods(spec, line, paper), line);
}

function withPartNumber(
  described: string,
  line: { customerPartNumber?: string | undefined },
): string {
  return line.customerPartNumber === undefined
    ? described
    : `${described} · ${CUSTOMER_PART_LABEL} ${line.customerPartNumber}`;
}

const ESTIMATE_MARK = 'est.';

export const PER_POUND_NOTICE =
  'Lines priced by the pound show the pounds ordered. ' +
  'They are invoiced at the weight measured when the order ships.';

interface PricedLine {
  quantityRolls: number;
  pricePerRoll: string;
  extendedPrice: string;
  pricingBasis: PricingBasis;
  productPricePerLb?: string | undefined;

  orderedWeightLb?: string | undefined;
  estimatedWeightLb: string;

  freightResult: FreightResult;
}

export function isPricedPerPound(
  line: Pick<PricedLine, 'pricingBasis' | 'productPricePerLb'>,
): line is Pick<PricedLine, 'pricingBasis'> & { productPricePerLb: string } {
  return line.pricingBasis === 'per_pound' && line.productPricePerLb !== undefined;
}

export function priceColumnLabels(
  unitNeutral: boolean,
  freightIncluded = false,
): { quantity: string; unitPrice: string } {
  if (freightIncluded) {
    return { quantity: 'Rolls', unitPrice: FREIGHT_INCLUDED_UNIT_PRICE };
  }
  return unitNeutral
    ? { quantity: 'Qty', unitPrice: 'Unit price' }
    : { quantity: 'Rolls', unitPrice: 'Price / roll' };
}

const FREIGHT_INCLUDED_UNIT_PRICE = 'Price / roll incl. freight';

export const FREIGHT_INCLUDED_NOTICE = "Freight is included in each line's price.";

function freightIncludedPrice(line: PricedLine): string {
  const price = formatMoney(deliveredPricePerRollOf(line));
  return freightKnowledge(line.freightResult) === 'known' ? price : `${price} + ${FREIGHT_TBD}`;
}

export function withoutFreightColumn(table: LineItemsBlock): LineItemsBlock {
  return {
    ...table,
    columns: table.columns.filter((column) => column.key !== 'freight'),
    rows: table.rows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'freight')),
    ),
  };
}

function rollCount(quantityRolls: number): string {
  return `${String(quantityRolls)} ${quantityRolls === 1 ? 'roll' : 'rolls'}`;
}

/**
 * The quantity, unit price and extended cells for one line. A per-pound line shows pounds and a price
 * per pound, with the extended price marked as an estimate. `unitNeutral` is set when any line on the
 * document is priced per pound, so every cell then names its unit.
 */
export function pricedLineCells(
  line: PricedLine,
  unitNeutral: boolean,
  freightIncluded = false,
): { quantity: string; unitPrice: string; extended: string; descriptionSuffix: string } {
  if (isPricedPerPound(line)) {
    return {
      quantity:
        line.orderedWeightLb === undefined
          ? `${formatEstimatedPounds(line.estimatedWeightLb)} lb ${ESTIMATE_MARK}`
          : `${formatMeasure(line.orderedWeightLb)} lb`,
      unitPrice: `${formatPricePerPound(line.productPricePerLb)} / lb`,
      extended: `${formatMoney(line.extendedPrice)} ${ESTIMATE_MARK}`,
      descriptionSuffix: ` · ${rollCount(line.quantityRolls)}`,
    };
  }
  if (freightIncluded) {
    return {
      quantity: String(line.quantityRolls),
      unitPrice: freightIncludedPrice(line),
      extended: formatMoney(line.extendedPrice),
      descriptionSuffix: '',
    };
  }
  return unitNeutral
    ? {
        quantity: rollCount(line.quantityRolls),
        unitPrice: `${formatMoney(line.pricePerRoll)} / roll`,
        extended: formatMoney(line.extendedPrice),
        descriptionSuffix: '',
      }
    : {
        quantity: String(line.quantityRolls),
        unitPrice: formatMoney(line.pricePerRoll),
        extended: formatMoney(line.extendedPrice),
        descriptionSuffix: '',
      };
}

export function totalLabel(freightPending: boolean, estimated: boolean): string {
  if (estimated && freightPending) return 'Total (estimated, freight not final)';
  if (estimated) return 'Total (estimated)';
  if (freightPending) return 'Total (freight not final)';
  return 'Total';
}
