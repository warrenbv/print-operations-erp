// Tests that every seeded grade, tier and pallet fit in the in-memory adapters has a well-formed
// id, and that the exported id maps name exactly the seeded rows.
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GRADE_IDS,
  DEFAULT_GRADES,
} from '../src/adapters/in-memory/in-memory-grade-repository';
import {
  DEFAULT_PRICING_TIER_IDS,
  DEFAULT_PRICING_TIERS,
  InMemoryPricingTierRepository,
} from '../src/adapters/in-memory/in-memory-pricing-tier-repository';
import {
  DEFAULT_PALLET_FITS,
  InMemoryPalletFitRepository,
} from '../src/adapters/in-memory/in-memory-pallet-fit-repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('seeded ids', () => {
  it('gives every default grade a uuid', () => {
    expect(DEFAULT_GRADES.length).toBe(5);
    for (const grade of DEFAULT_GRADES) {
      expect(grade.id, `${grade.productFamily} ${grade.code}`).toMatch(UUID);
    }
  });

  it('names every default grade in DEFAULT_GRADE_IDS, and nothing else', () => {
    expect([...DEFAULT_GRADES.map((g) => g.id)].sort()).toEqual(
      Object.values(DEFAULT_GRADE_IDS).sort(),
    );
  });

  it('gives every default pricing tier a uuid', () => {
    expect(DEFAULT_PRICING_TIERS.length).toBe(7);
    for (const tier of DEFAULT_PRICING_TIERS) {
      expect(tier.id, tier.code).toMatch(UUID);
    }
  });

  it('names every default pricing tier in DEFAULT_PRICING_TIER_IDS, and nothing else', () => {
    expect([...DEFAULT_PRICING_TIERS.map((t) => t.id)].sort()).toEqual(
      Object.values(DEFAULT_PRICING_TIER_IDS).sort(),
    );
  });

  it('gives a tier created in memory a uuid too', async () => {
    const tiers = new InMemoryPricingTierRepository();
    const created = await tiers.create(
      { code: 'seed_ids_test', name: 'Seed ids test', marginPct: '0.135000', minPallets: 99 },
      'dev-billing',
      new Date(0),
    );

    expect(created.id).toMatch(UUID);
  });

  it('gives every seeded pallet fit a uuid', async () => {
    const fits = new InMemoryPalletFitRepository();
    const kraft = await fits.list('kraft');

    expect(DEFAULT_PALLET_FITS.length).toBeGreaterThan(0);
    expect(kraft.length).toBeGreaterThan(0);
    for (const fit of kraft) {
      expect(fit.id, `kraft ${fit.rollWidthIn}"`).toMatch(UUID);
    }
  });
});
