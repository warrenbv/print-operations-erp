// Synthetic pricing cases with fictional grade figures, one per product family, width and quantity.
// Used by the base price and delivered price tests.
import type { ProductFamily } from '@erp/types';

export interface SyntheticPricingCase {
  family: ProductFamily;
  gradeCode: string;
  basisWeightLb: string;
  reamAreaDivisor: string;
  paperCostPerTonne: string;
  variantKey: string;
  feetPerRoll: string;
  rollWidthIn: number;
  quantityRolls: number;
}

export const SYNTHETIC_CASES: readonly SyntheticPricingCase[] = (
  ['kraft', 'butcher', 'newsprint', 'digital_bond'] as const
).flatMap((family, index) =>
  [12, 24].flatMap((rollWidthIn) =>
    [7, 80].map((quantityRolls) => ({
      family,
      gradeCode: `DEMO-${index + 1}`,
      basisWeightLb: ['30.0000', '40.0000', '28.0000', '20.0000'][index]!,
      reamAreaDivisor: family === 'digital_bond' ? '187.0000' : '432.0000',
      paperCostPerTonne: ['1200.0000', '1500.0000', '1100.0000', '1800.0000'][index]!,
      variantKey: 'demo',
      feetPerRoll: '1000.0000',
      rollWidthIn,
      quantityRolls,
    })),
  ),
);
