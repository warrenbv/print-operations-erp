// Shows a stored freight margin ratio as a percent, or null when the customer has none.
import { ratioToPercent } from '../../../../lib/percent';

export function freightMarginPercent(freightMarginPct: string | undefined): string | null {
  return freightMarginPct === undefined ? null : ratioToPercent(freightMarginPct);
}
