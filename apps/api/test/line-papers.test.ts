// Tests `linePapers` in apps/api/src/quoting/line-papers.ts.
import { describe, expect, it } from 'vitest';

import type { Grade } from '@erp/types';

import { linePapers } from '../src/quoting/line-papers';

const kraft = {
  id: 'grade-kraft',
  productFamily: 'kraft',
  code: '37#',
  basisWeightLb: '37.0000',
  footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1250.0000' }],
} as unknown as Grade;

describe('linePapers', () => {
  it("hands over each grade's family, code and basis weight, and no feet", async () => {
    const papers = await linePapers(['grade-kraft'], async (id) =>
      id === kraft.id ? kraft : null,
    );

    expect(papers.get('grade-kraft')).toEqual({
      productFamily: 'kraft',
      code: '37#',
      basisWeightLb: '37.0000',
    });

    expect(JSON.stringify(papers.get('grade-kraft'))).not.toContain('1250');
  });

  it('reads each grade once however many lines are on it', async () => {
    const asked: string[] = [];
    await linePapers(['grade-kraft', 'grade-kraft', 'grade-kraft'], async (id) => {
      asked.push(id);
      return kraft;
    });

    expect(asked).toEqual(['grade-kraft']);
  });

  it('leaves a grade that is gone out of the map, so the line prints without it', async () => {
    const papers = await linePapers(['grade-gone'], async () => null);

    expect(papers.has('grade-gone')).toBe(false);
  });
});
