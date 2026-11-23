// Tests for the goods description and roll codes built from a line's paper.
import { describe, expect, it } from 'vitest';

import {
  PRODUCT_FAMILIES,
  PRODUCT_FAMILY_CODE_LETTERS,
  describeGoods,
  linePaperOf,
  rollCode,
  rollCodeWeight,
  type Grade,
  type LinePaper,
} from '../src/grade';

const KRAFT_38: LinePaper = { productFamily: 'kraft', code: '38#', basisWeightLb: '38.0000' };
const SPEC = '24" × 1,250 ft (long)';
const ROLL = { rollWidthIn: 24, feetPerRoll: '1250.0000' };

describe('describeGoods', () => {
  it('leads with the roll code, then names the paper before the roll', () => {
    expect(describeGoods(SPEC, ROLL, KRAFT_38)).toBe(
      'DP/24x1250/K38 · Kraft — 38# · 24" × 1,250 ft (long)',
    );
  });

  it("puts our code ahead of the customer's own description, then the paper", () => {
    expect(
      describeGoods(SPEC, { ...ROLL, customerDescription: 'CEDAR CORE SHEET' }, KRAFT_38),
    ).toBe('DP/24x1250/K38 · CEDAR CORE SHEET · Kraft — 38# · 24" × 1,250 ft (long)');
  });

  it('names the paper and prints no code when the family has no letter yet', () => {
    const butcher: LinePaper = { productFamily: 'butcher', code: '44#', basisWeightLb: '44.0000' };
    expect(describeGoods(SPEC, ROLL, butcher)).toBe('Butcher — 44# · 24" × 1,250 ft (long)');
  });

  it('falls back to the roll description alone when the grade cannot be found', () => {
    expect(describeGoods(SPEC, ROLL, undefined)).toBe(SPEC);
    expect(
      describeGoods(SPEC, { ...ROLL, customerDescription: 'CEDAR CORE SHEET' }, undefined),
    ).toBe(`CEDAR CORE SHEET · ${SPEC}`);
  });
});

describe('rollCode', () => {
  it('is DP, the width by the feet, then the family letter and the poundage', () => {
    const kraft56: LinePaper = { productFamily: 'kraft', code: '56#', basisWeightLb: '56.0000' };
    expect(rollCode(kraft56, { rollWidthIn: 24, feetPerRoll: '1000.0000' })).toBe('DP/24x1000/K56');
  });

  it('prints the feet ungrouped and the custom figures the line carries', () => {
    expect(rollCode(KRAFT_38, { rollWidthIn: 17, feetPerRoll: '640.0000' })).toBe('DP/17x640/K38');
    expect(rollCode(KRAFT_38, { rollWidthIn: 24, feetPerRoll: '1372.5000' })).toBe(
      'DP/24x1372.5/K38',
    );
  });

  it('prints no code without feet, rather than a guessed length', () => {
    expect(rollCode(KRAFT_38, { rollWidthIn: 24 })).toBeUndefined();
  });

  it('prints no code for a family with no letter', () => {
    const lettered = PRODUCT_FAMILIES.filter((family) => PRODUCT_FAMILY_CODE_LETTERS[family]);
    expect(lettered).toEqual(['kraft', 'newsprint']);
    for (const family of ['butcher', 'digital_bond'] as const) {
      expect(rollCode({ ...KRAFT_38, productFamily: family }, ROLL)).toBeUndefined();
    }
  });
});

describe('rollCodeWeight', () => {
  it('is the poundage at the head of the code, never the basis weight', () => {
    expect(rollCodeWeight({ code: '32#', basisWeightLb: '29.3000' })).toBe('32');
    expect(rollCodeWeight({ code: '26.4# Newsprint', basisWeightLb: '26.4000' })).toBe('26.4');
    expect(rollCodeWeight({ code: '65# Cover', basisWeightLb: '65.0000' })).toBe('65');
  });

  it('falls back to the basis weight only when the code has no leading number', () => {
    expect(rollCodeWeight({ code: 'Jacket', basisWeightLb: '47.0000' })).toBe('47');
    expect(rollCodeWeight({ code: '#', basisWeightLb: '31.2000' })).toBe('31.2');
  });
});

describe('linePaperOf', () => {
  it('hands over the family, the code and the basis weight, and no feet', () => {
    const grade = {
      productFamily: 'kraft',
      code: '38#',
      basisWeightLb: '38.0000',
      footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1250.0000' }],
    } as unknown as Grade;
    expect(linePaperOf(grade)).toEqual(KRAFT_38);
    expect(JSON.stringify(linePaperOf(grade))).not.toContain('1250');
  });
});
