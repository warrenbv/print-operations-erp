// Tests the price build-up rows for tier, margin entered manually, hand-set, per pound and freight lines.
import { describe, expect, it } from 'vitest';

import type { Grade, QuoteLine } from '@erp/types';

import { HALF_CENT_SENTENCE, buildUpHeading, buildUpOf, type BuildUpGroup } from './build-up';

const GRADE = {
  id: 'grade-1',
  productFamily: 'kraft',
  code: '35#',
  basisWeightLb: '35.0000',
} as unknown as Grade;

const perRoll = (over: Partial<QuoteLine> = {}): QuoteLine =>
  ({
    id: 'line-1',
    quoteId: 'quote-1',
    lineNumber: 1,
    gradeId: 'grade-1',
    footageVariant: 'short',
    rollWidthIn: 24,
    quantityRolls: 1135,
    overwrap: false,
    printed: false,
    pricingBasis: 'per_roll',
    freight: { mode: 'pickup' },
    freightResult: {
      mode: 'pickup',
      cost: '0.0000',
      margin: '0.0000',
      invoiceTotal: '0.0000',
      pending: false,
    },
    cost: {
      rollWeightLb: '18.7250',
      paperCostPerLb: '0.46266422',
      paperCostPerRoll: '8.6634',
      hardwareCostPerRoll: '1.8865',
      addOnCostPerRoll: '0.0000',
      totalCostPerRoll: '10.5499',
      rollsPerPallet: 50,
      feetPerRoll: '1000.0000',
    },
    tier: {
      id: 'tier-volume-4',
      code: 'volume_4',
      name: 'Volume 4',
      marginPct: '0.210000',
      source: 'auto',
    },
    pallets: 23,
    basePricePerRoll: '13.3543',
    pricePerRoll: '13.3543',
    priceSource: 'tier',
    deliveredPricePerRoll: '13.3543',
    marginPct: '0.210000',
    floor: { status: 'ok' },
    extendedPrice: '15157.1305',
    extendedCost: '11974.1365',
    extendedMargin: '3182.9940',
    estimatedWeightLb: '21252.8750',
    pricePerLb: '0.7132',
    effectivePricePerLb: '0.7132',
    ...over,
  }) as QuoteLine;

const groupOf = (groups: readonly BuildUpGroup[], title: string): BuildUpGroup => {
  const found = groups.find((group) => group.title === title);
  if (found === undefined) throw new Error(`no group ${title}`);
  return found;
};

const row = (groups: readonly BuildUpGroup[], title: string, label: string) =>
  groupOf(groups, title).rows.find((r) => r.label === label);

describe('buildUpOf', () => {
  it('orders the groups inputs, cost, price, freight, delivered and extended', () => {
    expect(buildUpOf(perRoll(), GRADE).map((group) => group.title)).toEqual([
      'What the line asks for',
      'Cost build-up',
      'Price',
      'Freight',
      'Delivered and extended',
    ]);
  });

  it('names the line by its paper, width, feet and rolls', () => {
    expect(buildUpHeading(perRoll(), GRADE)).toBe(
      'Line 1 · Kraft — 35# · 24" × 1,000 ft · 1135 rolls',
    );
  });

  it("prints the cost limbs in the Approvals card's words, with its half-cent sentence", () => {
    const cost = groupOf(buildUpOf(perRoll(), GRADE), 'Cost build-up');
    expect(cost.rows.map((r) => [r.label, r.value])).toEqual([
      ['Est. roll weight', '18.725 lb'],
      ['Paper cost / lb', '$0.46'],
      ['Paper / roll', '$8.66'],
      ['Hardware / roll', '$1.89'],
      ['Add-ons / roll', '$0.00'],
      ['Total cost / roll', '$10.55'],
      ['Footage used', '1,000 ft · 50 / pallet'],
    ]);
    expect(cost.after).toBe(HALF_CENT_SENTENCE);
  });

  it('prints the base price as the equation of the stored figures', () => {
    expect(row(buildUpOf(perRoll(), GRADE), 'Price', 'Base price / roll')?.value).toBe(
      '$10.55 ÷ (1 − 21%) = $13.35',
    );
  });

  it('says whether volume or a person chose the tier', () => {
    expect(row(buildUpOf(perRoll(), GRADE), 'Price', 'Tier')).toMatchObject({
      value: 'Volume 4 at 21%',
      note: 'chosen by the pallet count',
    });
    const picked = perRoll({ tier: { ...perRoll().tier, source: 'override' } });
    expect(row(buildUpOf(picked, GRADE), 'Price', 'Tier')?.note).toBe('tier hand-picked');
  });

  it('prints a breached floor with the minimum, and a met one without inventing its percent', () => {
    expect(row(buildUpOf(perRoll(), GRADE), 'Price', 'Floor')).toEqual({
      label: 'Floor',
      value: 'met',
    });
    const below = perRoll({
      floor: { status: 'below_floor', floorPct: '0.120000', minimumPricePerRoll: '11.9885' },
    });
    expect(row(buildUpOf(below, GRADE), 'Price', 'Floor')).toMatchObject({
      value: 'BREACHED at 12%',
      note: 'minimum $11.99 / roll',
    });
  });

  it('names a hand-set price and the tier price it replaced', () => {
    const handSet = perRoll({
      priceSource: 'manual',
      overridePricePerRoll: '15.5000',
      pricePerRoll: '15.5000',
    });
    expect(row(buildUpOf(handSet, GRADE), 'Price', 'Price / roll')).toMatchObject({
      value: '$15.50',
      note: 'hand-set, tier price $13.35',
    });
  });

  it('names a line at the customer agreed price, per roll and per pound', () => {
    const perRollAgreed = perRoll({
      priceSource: 'agreed',
      overridePricePerRoll: '16.2500',
      pricePerRoll: '16.2500',
    });
    expect(row(buildUpOf(perRollAgreed, GRADE), 'Price', 'Price / roll')).toMatchObject({
      value: '$16.25',
      note: 'customer’s agreed price, tier price $13.35',
    });

    const perPoundAgreed = perRoll({
      priceSource: 'agreed',
      pricingBasis: 'per_pound',
      orderedWeightLb: '1000.0000',
      overridePricePerLb: '0.6900',
      productPricePerLb: '0.6900',
      basePricePerLb: '0.5842',
      pricePerRoll: '12.9203',
    });
    expect(
      row(buildUpOf(perPoundAgreed, GRADE), 'Price', 'Customer’s agreed price / lb')?.value,
    ).toBe('$0.6900');
    expect(row(buildUpOf(perPoundAgreed, GRADE), 'Price', 'Hand-set price / lb')).toBeUndefined();
  });

  it('prints a carrier line waiting on its bid as pending, never $0.00', () => {
    const pending = perRoll({
      freight: { mode: 'carrier' },
      freightResult: {
        mode: 'carrier',
        cost: '0.0000',
        margin: '0.0000',
        invoiceTotal: '0.0000',
        pending: true,
      },
    });
    const freight = groupOf(buildUpOf(pending, GRADE), 'Freight');
    expect(freight.rows.map((r) => [r.label, r.value])).toEqual([
      ['Shipping', 'Freight'],
      ['Carrier bid', 'pending'],
      ['Freight cost', 'pending'],
      ['Freight margin', 'pending'],
      ['Freight on the invoice', 'pending'],
    ]);
    expect(
      row(buildUpOf(pending, GRADE), 'Delivered and extended', 'Delivered / roll')?.value,
    ).toBe('$13.35 (excl. freight TBD)');
  });

  it('splits a known carrier freight into cost, margin and the invoice figure', () => {
    const carrier = perRoll({
      freight: { mode: 'carrier', carrierBid: '300.0000', freightMarginPct: '0.120000' },
      freightResult: {
        mode: 'carrier',
        cost: '300.0000',
        margin: '40.9091',
        invoiceTotal: '340.9091',
        pending: false,
      },
    });
    const freight = groupOf(buildUpOf(carrier, GRADE), 'Freight');
    expect(freight.rows.map((r) => [r.label, r.value])).toEqual([
      ['Shipping', 'Freight'],
      ['Carrier bid', '$300.00'],
      ['Freight margin %', '12%'],
      ['Freight cost', '$300.00'],
      ['Freight margin', '$40.91'],
      ['Freight on the invoice', '$340.91'],
    ]);
  });

  it('adds the price per pound figures on a per-pound line, and leaves the delivered ones out', () => {
    const perPound = perRoll({
      pricingBasis: 'per_pound',
      orderedWeightLb: '1000.0000',
      productPricePerLb: '0.6385',
      basePricePerLb: '0.6385',
      pricePerRoll: '11.9559',
    });
    const groups = buildUpOf(perPound, GRADE);
    const price = groupOf(groups, 'Price');
    expect(price.rows.map((r) => r.label)).toEqual([
      'Pallets',
      'Tier',
      'Base price / roll',
      'Margin as priced',
      'Floor',
      'Engine price / lb',
      'Price per Pound',
      'Estimated weight',
      'Per-roll equivalent',
    ]);
    expect(row(groups, 'Price', 'Price per Pound')?.value).toBe('$0.6385');
    expect(row(groups, 'What the line asks for', 'Pounds ordered')?.value).toBe('1,000 lb');

    expect(JSON.stringify(groups)).not.toContain('0.7132');
  });

  const uncounted = (over: Partial<QuoteLine> = {}): QuoteLine =>
    perRoll({
      cost: { ...perRoll().cost, hardwareCostPerRoll: '1.7865', rollsPerPallet: null },
      tier: {
        id: 'tier-small-batch',
        code: 'small_batch',
        name: 'Small batch',
        marginPct: '0.380000',
        source: 'auto',
      },
      pallets: null,
      ...over,
    });

  it('keeps a counted line exactly as it was: no Pallet cost row, the count and its note', () => {
    const groups = buildUpOf(perRoll(), GRADE);
    expect(groupOf(groups, 'Cost build-up').rows.map((r) => r.label)).not.toContain('Pallet cost');
    expect(row(groups, 'Price', 'Pallets')).toEqual({
      label: 'Pallets',
      value: '23',
      note: 'the rolls over the rolls per pallet',
    });
  });

  it('says on an uncounted line that the pallet cost was left out, and why the tier', () => {
    const groups = buildUpOf(uncounted(), GRADE);
    expect(groupOf(groups, 'Cost build-up').rows.map((r) => [r.label, r.value])).toEqual([
      ['Est. roll weight', '18.725 lb'],
      ['Paper cost / lb', '$0.46'],
      ['Paper / roll', '$8.66'],
      ['Hardware / roll', '$1.79'],
      ['Pallet cost', 'not counted for this width, left out'],
      ['Add-ons / roll', '$0.00'],
      ['Total cost / roll', '$10.55'],
      ['Footage used', '1,000 ft'],
    ]);
    expect(row(groups, 'Price', 'Pallets')).toEqual({ label: 'Pallets', value: 'not counted' });
    expect(row(groups, 'Price', 'Tier')).toMatchObject({
      value: 'Small batch at 38%',
      note: 'pallet count not known, priced as one pallet',
    });
    expect(JSON.stringify(groups)).not.toContain('null');
  });

  it('keeps a hand-picked tier hand-picked on an uncounted line', () => {
    const picked = uncounted({ tier: { ...uncounted().tier, source: 'override' } });
    expect(row(buildUpOf(picked, GRADE), 'Price', 'Tier')?.note).toBe('tier hand-picked');
  });

  describe('a margin entered manually', () => {
    const entered = (over: Partial<QuoteLine> = {}): QuoteLine =>
      perRoll({
        priceSource: 'margin',
        marginOverridePct: '0.420000',
        marginPricePerRoll: '18.1895',
        pricePerRoll: '18.1895',
        marginPct: '0.420000',
        ...over,
      });

    it('keeps the Tier row, then says the margin entered replaces it', () => {
      const groups = buildUpOf(entered(), GRADE);
      expect(row(groups, 'Price', 'Tier')).toMatchObject({
        value: 'Volume 4 at 21%',
        note: 'chosen by the pallet count',
      });
      expect(row(groups, 'Price', 'Margin entered manually')).toEqual({
        label: 'Margin entered manually',
        value: '42%',
        note: 'replaces the tier',
      });
    });

    it('prints the equation with the margin entered, from its stored price', () => {
      expect(row(buildUpOf(entered(), GRADE), 'Price', 'Base price / roll')?.value).toBe(
        '$10.55 ÷ (1 − 42%) = $18.19',
      );
    });

    it('prints the same equation on a line with overwrap, from the price before it', () => {
      const wrapped = entered({ overwrap: true, pricePerRoll: '18.9171' });
      expect(row(buildUpOf(wrapped, GRADE), 'Price', 'Base price / roll')?.value).toBe(
        '$10.55 ÷ (1 − 42%) = $18.19',
      );
      expect(row(buildUpOf(wrapped, GRADE), 'Price', 'Price / roll')).toMatchObject({
        value: '$18.92',
        note: 'the base price with overwrap',
      });
    });

    it('names what the tier would have charged, so how far off list is on the page', () => {
      expect(row(buildUpOf(entered(), GRADE), 'Price', 'Tier price / roll')).toEqual({
        label: 'Tier price / roll',
        value: '$13.35',
        note: 'what the tier would have charged',
      });
      expect(row(buildUpOf(perRoll(), GRADE), 'Price', 'Tier price / roll')).toBeUndefined();
    });

    it('lays the price rows out in order, the margin as priced included', () => {
      const price = groupOf(buildUpOf(entered(), GRADE), 'Price');
      expect(price.rows.map((r) => r.label)).toEqual([
        'Pallets',
        'Tier',
        'Margin entered manually',
        'Base price / roll',
        'Tier price / roll',
        'Margin as priced',
        'Floor',
        'Price / roll',
      ]);
      expect(row(buildUpOf(entered(), GRADE), 'Price', 'Margin as priced')?.value).toBe('42%');
    });

    it("names the tier's own price per pound for the tier on a per-pound line", () => {
      const perPound = entered({
        pricingBasis: 'per_pound',
        orderedWeightLb: '1000.0000',
        basePricePerLb: '0.6025',
        productPricePerLb: '0.7431',
      });
      const labels = groupOf(buildUpOf(perPound, GRADE), 'Price').rows.map((r) => r.label);
      expect(labels).toContain('Tier price / lb');
      expect(labels).not.toContain('Engine price / lb');
    });
  });

  it('reads every figure from the line, so the line that changes is the page that changes', () => {
    const moved = perRoll({ extendedCost: '18375.0000', extendedMargin: '3871.6200' });
    expect(row(buildUpOf(moved, GRADE), 'Delivered and extended', 'Extended cost')?.value).toBe(
      '$18,375.00',
    );
  });
});
