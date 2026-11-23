// Tier selection by pallet count and the tier's cost multiplier. Pure functions that touch no
// storage. The tier is part of the price build-up in docs/product/requirements.md (R3). The service
// that loads the tier table: modules/quoting/src/services/quote-pricing-service.ts.
import type { PricingTier, TierSelection } from '@erp/types';
import { toDecimal, type Decimal } from '@erp/types';

import { NoTierForVolumeError, UnknownTierCodeError } from './ports';

/**
 * The factor a tier applies to cost, 1 / (1 - margin). Returns an unrounded Decimal:
 * docs/decisions/003-decimal-arithmetic.md.
 */
export function tierMultiplier(tier: Pick<PricingTier, 'marginPct'>): Decimal {
  const margin = toDecimal(tier.marginPct);

  // The tier schema keeps a margin below 1. This function also prices a margin entered on a line,
  // so the check makes a bad input fail loudly instead of dividing by zero.
  const divisor = toDecimal('1').minus(margin);
  if (divisor.lte(toDecimal('0'))) {
    throw new RangeError(
      `tier margin ${tier.marginPct} must be less than 1 — 1/(1 - margin) is undefined`,
    );
  }
  return toDecimal('1').div(divisor);
}

/** The tier with the highest threshold at or below the pallet count, or null when none applies. */
export function selectTierByVolume(
  tiers: readonly PricingTier[],
  pallets: number,
): PricingTier | null {
  let best: PricingTier | null = null;
  for (const tier of tiers) {
    if (tier.minPallets <= pallets && (best === null || tier.minPallets > best.minPallets)) {
      best = tier;
    }
  }
  return best;
}

/**
 * A tier forced by code wins over selection by volume. An unknown code raises UnknownTierCodeError,
 * and a pallet count no tier covers raises NoTierForVolumeError.
 */
export function resolveTier(
  tiers: readonly PricingTier[],
  pallets: number,
  overrideCode?: string,
): TierSelection {
  if (overrideCode !== undefined) {
    const chosen = tiers.find((t) => t.code === overrideCode);
    if (chosen === undefined) {
      throw new UnknownTierCodeError(overrideCode);
    }
    return { tier: chosen, source: 'override' };
  }

  const auto = selectTierByVolume(tiers, pallets);
  if (auto === null) {
    throw new NoTierForVolumeError(pallets);
  }
  return { tier: auto, source: 'auto' };
}
