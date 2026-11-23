// Tests that the delivered price per roll printed for a customer, computed in packages/types,
// agrees with the pricing engine's figure for every freight mode across the synthetic cases.
import { deliveredPricePerRollOf, formatMoney, type FreightInput } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { InMemoryGradeRepository } from '../src/adapters/in-memory/in-memory-grade-repository';
import { InMemoryPalletFitRepository } from '../src/adapters/in-memory/in-memory-pallet-fit-repository';
import { InMemoryPricingConfigRepository } from '../src/adapters/in-memory/in-memory-pricing-config-repository';
import { InMemoryPricingTierRepository } from '../src/adapters/in-memory/in-memory-pricing-tier-repository';
import { QuotePricingService } from '../src/services/quote-pricing-service';
import { RollCostService } from '../src/services/roll-cost-service';
import { SYNTHETIC_CASES, type SyntheticPricingCase } from './fixtures/synthetic-pricing-cases';

const FREIGHTS: readonly FreightInput[] = [
  { mode: 'pickup' },
  { mode: 'our_vehicle' },
  { mode: 'our_vehicle', rateOverride: '41.6200' },
  { mode: 'pass_through', carrierBid: '52.3100' },
  { mode: 'carrier', carrierBid: '280.0000' },
  { mode: 'carrier', carrierBid: '167.3800', freightMarginPct: '0.140000' },
];

async function pricer(c: SyntheticPricingCase) {
  const grades = new InMemoryGradeRepository();
  await grades.create({
    id: 'g',
    productFamily: c.family,
    code: c.gradeCode,
    basisWeightLb: c.basisWeightLb,
    reamAreaDivisor: c.reamAreaDivisor,
    paperCostPerTonne: c.paperCostPerTonne,
    footages: [{ variant: c.variantKey, label: c.variantKey, feetPerRoll: c.feetPerRoll }],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  const config = new InMemoryPricingConfigRepository();
  return new QuotePricingService({
    rollCost: new RollCostService({
      grades,
      config,
      palletFits: new InMemoryPalletFitRepository(),
    }),
    tiers: new InMemoryPricingTierRepository(),
    config,
  });
}

describe("the printed delivered price per roll, against the engine's", () => {
  it('agrees to the cent on every synthetic case under every shipping mode', async () => {
    const disagreements: string[] = [];
    let compared = 0;
    for (const c of SYNTHETIC_CASES) {
      const service = await pricer(c);
      const name = `${c.family} ${c.gradeCode} ${c.variantKey} ${String(c.rollWidthIn)}" x ${String(c.quantityRolls)}`;
      for (const freight of FREIGHTS) {
        const priced = await service.priceLine({
          gradeId: 'g',
          footageVariant: c.variantKey,
          rollWidthIn: c.rollWidthIn,
          quantityRolls: c.quantityRolls,
          overwrap: false,
          pricingBasis: 'per_roll',
          freight,
        });
        if (priced === null) {
          throw new Error(`${name} did not price`);
        }
        compared += 1;
        const printed = formatMoney(deliveredPricePerRollOf(priced));
        const stored = formatMoney(priced.deliveredPricePerRoll);
        if (printed !== stored) {
          disagreements.push(`${name} ${freight.mode}: printed ${printed}, stored ${stored}`);
        }
      }
    }

    expect(compared).toBe(SYNTHETIC_CASES.length * FREIGHTS.length);
    expect(disagreements).toEqual([]);
  }, 60_000);

  it('is the extended price over the rolls, so the column still adds up', () => {
    expect(deliveredPricePerRollOf({ extendedPrice: '764.1880', quantityRolls: 40 })).toBe(
      '19.1047',
    );
  });
});
