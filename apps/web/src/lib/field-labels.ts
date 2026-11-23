// Human labels for the field paths in an API validation error, used by apps/web/src/lib/api-error.ts.
// A name with no entry is split from camelCase, and a numeric segment becomes a row counted from one.
const FIELD_LABELS: Readonly<Record<string, string>> = {
  poNumber: 'PO number',

  requestedDate: 'Delivery date',
  confirmedLeadTimeDays: 'Lead time (days)',
  leadTimeDays: 'Lead time (days)',

  carrierBid: 'Carrier bid',
  rateOverride: 'Flat rate to the warehouse',
  freightMarginPct: 'Freight margin',

  netDays: 'Net days',

  quantityRolls: 'Rolls',
  basisWeightLb: 'Basis weight (lb)',
  reamAreaDivisor: 'Ream area divisor',
  paperCostPerTonne: 'Paper cost per tonne',
  minPallets: 'Minimum pallets',
  marginPct: 'Margin',
};

function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function fieldLabel(path: string): string {
  const exact = FIELD_LABELS[path];
  if (exact !== undefined) return exact;

  const segments = path.split('.');
  const labelled = segments.map((segment, index) => {
    if (/^\d+$/.test(segment)) return `row ${String(Number(segment) + 1)}`;
    const mapped = FIELD_LABELS[segment];
    if (mapped !== undefined) return mapped;
    const plain = words(segment);
    return index === 0 ? sentenceCase(plain) : plain;
  });

  return labelled.join(', ');
}
