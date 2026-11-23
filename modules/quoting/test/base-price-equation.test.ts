// Tests that the base price on the price build-up page is the roll cost times the tier multiplier
// at display precision, across the synthetic cases in
// modules/quoting/test/fixtures/synthetic-pricing-cases.ts. The build-up is described in
// docs/product/requirements.md (R3).
import { formatMoney, toDecimal, toMoney } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { InMemoryGradeRepository } from '../src/adapters/in-memory/in-memory-grade-repository';
import { InMemoryPalletFitRepository } from '../src/adapters/in-memory/in-memory-pallet-fit-repository';
import { InMemoryPricingConfigRepository } from '../src/adapters/in-memory/in-memory-pricing-config-repository';
import { InMemoryPricingTierRepository } from '../src/adapters/in-memory/in-memory-pricing-tier-repository';
import { QuotePricingService } from '../src/services/quote-pricing-service';
import { RollCostService } from '../src/services/roll-cost-service';
import { SYNTHETIC_CASES, type SyntheticPricingCase } from './fixtures/synthetic-pricing-cases';

const ADD_ONS: readonly { convertCostPerTon?: string; printCostPerTon?: string }[] = [
  {},
  { convertCostPerTon: '38.2500', printCostPerTon: '81.7500' },
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

describe('the base price equation on the price build-up page', () => {
  it('holds at display precision on every per-roll synthetic case', async () => {
    const disagreements: string[] = [];
    let compared = 0;
    for (const c of SYNTHETIC_CASES) {
      const service = await pricer(c);
      const name = `${c.family} ${c.gradeCode} ${c.variantKey} ${String(c.rollWidthIn)}" x ${String(c.quantityRolls)}`;
      for (const addOns of ADD_ONS) {
        const priced = await service.priceLine({
          gradeId: 'g',
          footageVariant: c.variantKey,
          rollWidthIn: c.rollWidthIn,
          quantityRolls: c.quantityRolls,
          overwrap: false,
          pricingBasis: 'per_roll',
          freight: { mode: 'pickup' },
          ...addOns,
        });
        if (priced === null) {
          throw new Error(`${name} did not price`);
        }
        compared += 1;
        const fromStored = toMoney(
          toDecimal(priced.cost.totalCostPerRoll).div(
            toDecimal('1').minus(toDecimal(priced.tier.tier.marginPct)),
          ),
        );
        if (formatMoney(fromStored) !== formatMoney(priced.basePricePerRoll)) {
          disagreements.push(
            `${name} ${JSON.stringify(addOns)}: ${formatMoney(fromStored)} vs ${formatMoney(priced.basePricePerRoll)}`,
          );
        }
      }
    }

    expect(compared).toBe(SYNTHETIC_CASES.length * ADD_ONS.length);
    expect(disagreements).toEqual([]);
  }, 60_000);

  it('holds with a margin entered manually, overwrap or not', async () => {
    const MARGINS = ['0.227000', '0.418000', '0.583000', '0.950000'] as const;
    const disagreements: string[] = [];
    let compared = 0;
    for (const c of SYNTHETIC_CASES) {
      const service = await pricer(c);
      const name = `${c.family} ${c.gradeCode} ${c.variantKey} ${String(c.rollWidthIn)}" x ${String(c.quantityRolls)}`;
      for (const margin of MARGINS) {
        for (const overwrap of [false, true]) {
          const priced = await service.priceLine({
            gradeId: 'g',
            footageVariant: c.variantKey,
            rollWidthIn: c.rollWidthIn,
            quantityRolls: c.quantityRolls,
            overwrap,
            pricingBasis: 'per_roll',
            freight: { mode: 'pickup' },
            marginOverridePct: margin,
          });
          if (priced === null || priced.marginPricePerRoll === undefined) {
            throw new Error(`${name} at ${margin} did not price at the margin entered`);
          }
          compared += 1;
          const fromStored = toMoney(
            toDecimal(priced.cost.totalCostPerRoll).div(toDecimal('1').minus(toDecimal(margin))),
          );
          if (formatMoney(fromStored) !== formatMoney(priced.marginPricePerRoll)) {
            disagreements.push(
              `${name} at ${margin}, overwrap ${String(overwrap)}: ${formatMoney(fromStored)} vs ${formatMoney(priced.marginPricePerRoll)}`,
            );
          }
        }
      }
    }

    expect(compared).toBe(SYNTHETIC_CASES.length * 4 * 2);
    expect(disagreements).toEqual([]);
  }, 120_000);
});
