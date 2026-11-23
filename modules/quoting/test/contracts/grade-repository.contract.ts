// The contract for `GradeRepository` in modules/quoting/src/ports.ts. One set of assertions, run
// against the in-memory and the Drizzle adapter by
// modules/quoting/test/repository-contracts.test.ts. It pins down creating, listing and updating
// grades with their footages and widths, refusing a duplicate code, and the `lockVersion` guard of
// docs/decisions/006-optimistic-concurrency.md. A failure means one adapter breaks a promise the
// other keeps: docs/process/verifying-agent-written-code.md.
import { describe, expect, it } from 'vitest';

import {
  DuplicateGradeCodeError,
  type GradeRepository,
  StaleAggregateError,
} from '../../src/ports';
import { newGradeInput } from '../fixtures';

export function gradeRepositoryContract(makeRepo: () => Promise<GradeRepository>): void {
  const ID_1 = '01988a00-0003-7000-8000-000000000001';
  const ID_2 = '01988a00-0003-7000-8000-000000000002';
  const ID_3 = '01988a00-0003-7000-8000-000000000003';
  const MISSING = '01988a00-0003-7000-8000-0000000000ff';
  const NOW = new Date('2026-08-06T09:00:00.000Z');
  const LATER = new Date('2026-08-06T09:01:00.000Z');

  describe('create', () => {
    it('round-trips a grade with its footage variants, in a stable order', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.code).toBe('35#');
      expect(created.basisWeightLb).toBe('35.0000');
      expect(created.footages.map((f) => f.variant)).toEqual(['long', 'short']);
    });

    it('accepts the same code in two families', async () => {
      const repo = await makeRepo();
      const kraft = await repo.create(
        newGradeInput({
          id: ID_1,
          productFamily: 'kraft',
          code: '40#',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      const butcher = await repo.create(
        newGradeInput({
          id: ID_2,
          productFamily: 'butcher',
          code: '40#',
          paperCostPerTonne: '1940.0000',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      expect(kraft.paperCostPerTonne).toBe('900.0000');
      expect(butcher.paperCostPerTonne).toBe('1940.0000');
    });

    it('raises the typed error on a duplicate code within one family', async () => {
      const repo = await makeRepo();
      await repo.create(newGradeInput({ id: ID_1, code: '40#', createdAt: NOW, updatedAt: NOW }));
      await expect(
        repo.create(newGradeInput({ id: ID_2, code: '40#', createdAt: NOW, updatedAt: NOW })),
      ).rejects.toBeInstanceOf(DuplicateGradeCodeError);
    });

    it('accepts a grade with no footage variants yet', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, footages: [], createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.footages).toEqual([]);
    });

    it('round-trips the stock widths, narrowest first', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({
          id: ID_1,
          widths: [
            { rollWidthIn: 24, rollsPerPallet: 40 },
            { rollWidthIn: 9, rollsPerPallet: 90 },
          ],
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      const expected = [
        { rollWidthIn: 9, rollsPerPallet: 90 },
        { rollWidthIn: 24, rollsPerPallet: 40 },
      ];
      expect(created.widths).toEqual(expected);
      expect((await repo.findById(ID_1))?.widths).toEqual(expected);
      expect((await repo.list({}))[0]?.widths).toEqual(expected);
    });

    it('round-trips a width with no rolls-per-pallet count as null', async () => {
      const repo = await makeRepo();
      const widths = [
        { rollWidthIn: 5, rollsPerPallet: 1 },
        { rollWidthIn: 9, rollsPerPallet: null },
        { rollWidthIn: 11, rollsPerPallet: 10_000 },
      ];
      const created = await repo.create(
        newGradeInput({ id: ID_1, widths, createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.widths).toEqual(widths);
      expect((await repo.findById(ID_1))?.widths).toEqual(widths);
      expect((await repo.list({}))[0]?.widths).toEqual(widths);
    });

    it('stores no stock widths when given none', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, widths: [], createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.widths).toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns null for an unknown id', async () => {
      expect(await (await makeRepo()).findById(MISSING)).toBeNull();
    });

    it('returns exactly what create returned', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      expect(await repo.findById(created.id)).toEqual(created);
    });
  });

  describe('list', () => {
    async function seeded(): Promise<GradeRepository> {
      const repo = await makeRepo();
      await repo.create(
        newGradeInput({
          id: ID_1,
          productFamily: 'kraft',
          code: '50#',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      await repo.create(
        newGradeInput({
          id: ID_2,
          productFamily: 'kraft',
          code: '35#',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      await repo.create(
        newGradeInput({
          id: ID_3,
          productFamily: 'butcher',
          code: '40#',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      return repo;
    }

    it('orders by family then code', async () => {
      const all = await (await seeded()).list({});
      expect(all.map((g) => `${g.productFamily}/${g.code}`)).toEqual([
        'butcher/40#',
        'kraft/35#',
        'kraft/50#',
      ]);
    });

    it('filters by family', async () => {
      const only = await (await seeded()).list({ productFamily: 'butcher' });
      expect(only.map((g) => g.code)).toEqual(['40#']);
    });

    it('carries every grade its own footages', async () => {
      const all = await (await seeded()).list({});
      expect(all.every((g) => g.footages.length === 2)).toBe(true);
    });

    it('returns an empty list rather than throwing when there is nothing', async () => {
      expect(await (await makeRepo()).list({})).toEqual([]);
    });
  });

  describe('update', () => {
    it('takes a count for an uncounted width, leaving a counted one unchanged', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({
          id: ID_1,
          widths: [
            { rollWidthIn: 9, rollsPerPallet: null },
            { rollWidthIn: 24, rollsPerPallet: 50 },
          ],
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      const counted = await repo.update(
        created.id,
        {
          widths: [
            { rollWidthIn: 9, rollsPerPallet: 120 },
            { rollWidthIn: 24, rollsPerPallet: 50 },
          ],
        },
        LATER,
        created.lockVersion,
      );
      expect(counted?.widths).toEqual([
        { rollWidthIn: 9, rollsPerPallet: 120 },
        { rollWidthIn: 24, rollsPerPallet: 50 },
      ]);
    });

    it('replaces the stock widths wholesale and moves the token', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({
          id: ID_1,
          widths: [{ rollWidthIn: 12, rollsPerPallet: 75 }],
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      const patched = await repo.update(
        created.id,
        { widths: [{ rollWidthIn: 17, rollsPerPallet: 60 }] },
        LATER,
        created.lockVersion,
      );
      expect(patched?.widths).toEqual([{ rollWidthIn: 17, rollsPerPallet: 60 }]);
      expect(patched?.lockVersion).toBe(created.lockVersion + 1);

      expect(patched?.footages).toEqual(created.footages);
    });

    it('returns null for an unknown id', async () => {
      expect(await (await makeRepo()).update(MISSING, { code: 'x' }, LATER)).toBeNull();
    });

    it('applies a scalar patch and stamps updatedAt, leaving createdAt alone', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      const patched = await repo.update(created.id, { paperCostPerTonne: '965.0000' }, LATER);
      expect(patched?.paperCostPerTonne).toBe('965.0000');
      expect(patched?.updatedAt).toBe(LATER.toISOString());
      expect(patched?.createdAt).toBe(NOW.toISOString());
    });

    it('applies a divisor-only patch — it is a scalar like any other', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      const patched = await repo.update(created.id, { reamAreaDivisor: '187.0000' }, LATER);
      expect(patched?.reamAreaDivisor).toBe('187.0000');
      expect(patched?.updatedAt).toBe(LATER.toISOString());
      expect((await repo.findById(created.id))?.reamAreaDivisor).toBe('187.0000');
    });

    it('replaces the footage set wholesale, so a variant can be removed', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      const patched = await repo.update(
        created.id,
        { footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1640.0000' }] },
        LATER,
      );
      expect(patched?.footages.map((f) => f.variant)).toEqual(['long']);
    });

    it('leaves footages alone when the patch omits them', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      const patched = await repo.update(created.id, { basisWeightLb: '43.0000' }, LATER);
      expect(patched?.footages).toEqual(created.footages);
    });

    it('bumps updatedAt for a footage-only patch — the aggregate changed', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      const patched = await repo.update(created.id, { footages: [] }, LATER);
      expect(patched?.updatedAt).toBe(LATER.toISOString());
    });

    it('treats an empty patch as a no-op, including updatedAt', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      expect(await repo.update(created.id, {}, LATER)).toEqual(created);
    });

    it('raises the typed error when a rename collides within the family', async () => {
      const repo = await makeRepo();
      await repo.create(newGradeInput({ id: ID_1, code: '35#', createdAt: NOW, updatedAt: NOW }));
      const other = await repo.create(
        newGradeInput({ id: ID_2, code: '40#', createdAt: NOW, updatedAt: NOW }),
      );
      await expect(repo.update(other.id, { code: '35#' }, LATER)).rejects.toBeInstanceOf(
        DuplicateGradeCodeError,
      );
    });

    it('accepts renaming a grade to the code it already holds', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, code: '35#', createdAt: NOW, updatedAt: NOW }),
      );
      expect((await repo.update(created.id, { code: '35#' }, LATER))?.code).toBe('35#');
    });
  });

  describe('lockVersion', () => {
    it('starts at 1 on a new grade', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      expect(created.lockVersion).toBe(1);
    });

    it('moves on a scalar patch', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      const patched = await repo.update(created.id, { paperCostPerTonne: '965.0000' }, LATER);
      expect(patched?.lockVersion).toBe(2);
    });

    it('moves when the FOOTAGES change, not just the scalars', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      const patched = await repo.update(
        created.id,
        { footages: [{ variant: 'long', label: 'Long roll', feetPerRoll: '1385.0000' }] },
        LATER,
      );
      expect(patched?.lockVersion).toBeGreaterThan(created.lockVersion);
    });

    it('applies a guarded update at the expected generation', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      const applied = await repo.update(
        created.id,
        { paperCostPerTonne: '900.0000' },
        LATER,
        created.lockVersion,
      );
      expect(applied?.paperCostPerTonne).toBe('900.0000');
      expect(applied?.lockVersion).toBe(created.lockVersion + 1);
    });

    it('refuses a guarded update at a stale generation, and writes nothing', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, paperCostPerTonne: '1000.0000', createdAt: NOW, updatedAt: NOW }),
      );
      const staleToken = created.lockVersion;

      await repo.update(created.id, { paperCostPerTonne: '1318.0000' }, LATER);

      await expect(
        repo.update(
          created.id,
          { paperCostPerTonne: '1000.0000', footages: [] },
          LATER,
          staleToken,
        ),
      ).rejects.toBeInstanceOf(StaleAggregateError);

      const after = await repo.findById(created.id);
      expect(after?.paperCostPerTonne).toBe('1318.0000');
      expect(after?.footages).not.toEqual([]);
    });

    it('still answers null for an unknown grade rather than raising staleness', async () => {
      const repo = await makeRepo();
      expect(await repo.update(MISSING, { code: 'x' }, LATER, 1)).toBeNull();
    });

    it('leaves the token alone for a patch that changes nothing', async () => {
      const repo = await makeRepo();
      const created = await repo.create(
        newGradeInput({ id: ID_1, createdAt: NOW, updatedAt: NOW }),
      );
      const unchanged = await repo.update(created.id, {}, LATER, 999);
      expect(unchanged?.lockVersion).toBe(created.lockVersion);
      expect(unchanged?.updatedAt).toBe(NOW.toISOString());
    });
  });
}
