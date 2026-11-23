// The Our figures fold: cost, margin and weight in one line, the tiers used and the pallet count.
import { formatMoney, palletsText, toDecimal, type QuoteLine, type QuoteTotals } from '@erp/types';

import { formatEstimatedPounds } from '../../../../../lib/measures';
import { marginEnteredWords } from '../../../format';

export function marginShare(totals: Pick<QuoteTotals, 'extendedPrice' | 'extendedMargin'>): string {
  const price = toDecimal(totals.extendedPrice);
  if (price.eq(0)) {
    return '';
  }
  return `${toDecimal(totals.extendedMargin).div(price).times(100).toFixed(1)}%`;
}

export function ourFiguresSum(totals: QuoteTotals): string {
  const share = marginShare(totals);
  return (
    `cost ${formatMoney(totals.extendedCost)} · margin ${formatMoney(totals.extendedMargin)}` +
    `${share === '' ? '' : ` (${share})`} · ${formatEstimatedPounds(totals.estimatedWeightLb)} lb`
  );
}

export function tierWords(
  lines: readonly Pick<QuoteLine, 'lineNumber' | 'tier' | 'marginOverridePct'>[],
): string {
  const whole = (line: (typeof lines)[number]): string =>
    line.marginOverridePct === undefined
      ? `${line.tier.name} tier`
      : marginEnteredWords(line.marginOverridePct);
  const names = new Set(lines.map(whole));
  const only = [...names][0];
  if (names.size === 1 && only !== undefined) {
    if (lines.length === 1) return only;
    return `${only} on ${lines.length === 2 ? 'both' : 'all'} lines`;
  }
  return lines
    .map(
      (line) =>
        `line ${String(line.lineNumber)} ${
          line.marginOverridePct === undefined
            ? line.tier.name
            : marginEnteredWords(line.marginOverridePct)
        }`,
    )
    .join(', ');
}

export function palletWords(lines: readonly Pick<QuoteLine, 'pallets'>[]): string {
  let total = 0;
  let uncounted = 0;
  for (const line of lines) {
    if (line.pallets === null) {
      uncounted += 1;
    } else {
      total += line.pallets;
    }
  }
  if (uncounted > 0 && uncounted === lines.length) {
    return palletsText(null);
  }
  const counted = palletsText(total);
  return uncounted === 0
    ? counted
    : `${counted}, ${String(uncounted)} line${uncounted === 1 ? '' : 's'} not counted`;
}
