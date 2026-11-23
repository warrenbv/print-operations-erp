// The contract for `PricingTierRepository` in modules/quoting/src/ports.ts. One set of assertions,
// run against the in-memory and the Drizzle adapter by
// modules/quoting/test/repository-contracts.test.ts. It pins down tiers in threshold order, unique
// codes and thresholds, updates and their change log. A failure means one adapter breaks a promise
// the other keeps: docs/process/verifying-agent-written-code.md.
import { describe, expect, it } from 'vitest';

import {
  DuplicateTierCodeError,
  DuplicateTierThresholdError,
  type PricingTierRepository,
} from '../../src/ports';

export function pricingTierRepositoryContract(
  makeRepo: () => Promise<PricingTierRepository>,
): void {
  const ACTOR = 'dev-billing';
  const NOW = new Date('2026-08-06T09:00:00.000Z');
  const LATER = new Date('2026-08-06T09:01:00.000Z');

  describe('list', () => {
    it('returns the seven seeded tiers ordered by threshold', async () => {
      const tiers = await (await makeRepo()).list();
      expect(tiers.map((t) => t.code)).toEqual([
        'retail',
        'small_batch',
        'volume_1',
        'list',
        'volume_3',
        'volume_4',
        'volume_5',
      ]);
      expect(tiers.map((t) => t.minPallets)).toEqual([0, 1, 5, 10, 15, 20, 30]);
    });

    it('carries the seeded margins exactly', async () => {
      const tiers = await (await makeRepo()).list();
      expect(tiers.map((t) => t.marginPct)).toEqual([
        '0.550000',
        '0.380000',
        '0.320000',
        '0.280000',
        '0.240000',
        '0.210000',
        '0.170000',
      ]);
    });

    it('marks exactly one tier as the published list tier', async () => {
      const tiers = await (await makeRepo()).list();
      expect(tiers.filter((t) => t.isListTier).map((t) => t.code)).toEqual(['list']);
    });
  });

  describe('findByCode', () => {
    it('finds a seeded tier', async () => {
      expect((await (await makeRepo()).findByCode('list'))?.minPallets).toBe(10);
    });

    it('returns null for an unknown code', async () => {
      expect(await (await makeRepo()).findByCode('platinum')).toBeNull();
    });
  });

  describe('update', () => {
    it('returns null for an unknown code, rather than throwing', async () => {
      expect(
        await (await makeRepo()).update('platinum', { minPallets: 3 }, LATER, ACTOR),
      ).toBeNull();
    });

    it('patches a field and stamps updatedAt', async () => {
      const repo = await makeRepo();
      const updated = await repo.update('volume_3', { marginPct: '0.292000' }, LATER, ACTOR);
      expect(updated?.marginPct).toBe('0.292000');
      expect(updated?.updatedAt).toBe(LATER.toISOString());
    });

    it('leaves the other tiers untouched', async () => {
      const repo = await makeRepo();
      await repo.update('volume_3', { marginPct: '0.292000' }, LATER, ACTOR);
      expect((await repo.findByCode('volume_4'))?.marginPct).toBe('0.210000');
    });

    it('re-sorts the table when a threshold moves', async () => {
      const repo = await makeRepo();
      await repo.update('volume_5', { minPallets: 2 }, LATER, ACTOR);
      expect((await repo.list()).map((t) => t.code)).toEqual([
        'retail',
        'small_batch',
        'volume_5',
        'volume_1',
        'list',
        'volume_3',
        'volume_4',
      ]);
    });

    it('refuses to give two tiers the same threshold', async () => {
      const repo = await makeRepo();
      await expect(repo.update('volume_5', { minPallets: 1 }, LATER, ACTOR)).rejects.toBeInstanceOf(
        DuplicateTierThresholdError,
      );
    });

    it('accepts setting a threshold to the value it already holds', async () => {
      const repo = await makeRepo();
      expect((await repo.update('volume_5', { minPallets: 30 }, LATER, ACTOR))?.minPallets).toBe(
        30,
      );
    });

    it('treats an empty patch as a no-op, including updatedAt', async () => {
      const repo = await makeRepo();
      const before = await repo.findByCode('volume_3');
      expect(await repo.update('volume_3', {}, NOW, ACTOR)).toEqual(before);
    });

    it('records who changed it', async () => {
      const repo = await makeRepo();
      const updated = await repo.update('volume_3', { marginPct: '0.292000' }, LATER, ACTOR);
      expect(updated?.updatedBy).toBe(ACTOR);
    });

    it('leaves a seeded tier nobody has touched with a null updatedBy', async () => {
      const repo = await makeRepo();
      await repo.update('volume_3', { marginPct: '0.292000' }, LATER, ACTOR);
      expect((await repo.findByCode('volume_4'))?.updatedBy).toBeNull();
    });
  });

  describe('create', () => {
    const NEW_TIER = {
      code: 'volume_6',
      name: 'Volume 6',
      marginPct: '0.136000',
      minPallets: 40,
    } as const;

    it('adds a tier, placed in the table by threshold', async () => {
      const repo = await makeRepo();
      const created = await repo.create(NEW_TIER, ACTOR, NOW);
      expect(created).toMatchObject({
        code: 'volume_6',
        name: 'Volume 6',
        marginPct: '0.136000',
        minPallets: 40,
      });
      expect((await repo.list()).map((t) => t.code).at(-1)).toBe('volume_6');
    });

    it('stamps both timestamps and the creator', async () => {
      const repo = await makeRepo();
      const created = await repo.create(NEW_TIER, ACTOR, NOW);
      expect(created.createdAt).toBe(NOW.toISOString());
      expect(created.updatedAt).toBe(NOW.toISOString());
      expect(created.updatedBy).toBe(ACTOR);
    });

    it('never marks the new tier as the published list tier', async () => {
      const repo = await makeRepo();
      expect((await repo.create(NEW_TIER, ACTOR, NOW)).isListTier).toBe(false);
      expect((await repo.list()).filter((t) => t.isListTier).map((t) => t.code)).toEqual(['list']);
    });

    it('refuses a code that already exists', async () => {
      const repo = await makeRepo();
      await expect(
        repo.create({ ...NEW_TIER, code: 'volume_5' }, ACTOR, NOW),
      ).rejects.toBeInstanceOf(DuplicateTierCodeError);
    });

    it('refuses a threshold another tier already starts at', async () => {
      const repo = await makeRepo();
      await expect(repo.create({ ...NEW_TIER, minPallets: 30 }, ACTOR, NOW)).rejects.toBeInstanceOf(
        DuplicateTierThresholdError,
      );
    });

    it('writes no history row, because a create has no before', async () => {
      const repo = await makeRepo();
      await repo.create(NEW_TIER, ACTOR, NOW);
      expect(await repo.history(50)).toEqual([]);
    });
  });

  describe('history', () => {
    it('holds the values the change replaced, not the new ones', async () => {
      const repo = await makeRepo();
      await repo.update('volume_5', { marginPct: '0.118000' }, LATER, ACTOR);
      expect(await repo.history(50)).toEqual([
        {
          tierCode: 'volume_5',
          actor: ACTOR,
          at: LATER.toISOString(),
          name: 'Volume 5',
          marginPct: '0.170000',
          minPallets: 30,
        },
      ]);
    });

    it('stamps the change at the same instant as the tier it describes', async () => {
      const repo = await makeRepo();
      const updated = await repo.update('volume_5', { marginPct: '0.118000' }, LATER, ACTOR);
      expect((await repo.history(50))[0]?.at).toBe(updated?.updatedAt);
    });

    it('returns changes newest first', async () => {
      const repo = await makeRepo();
      await repo.update('volume_5', { marginPct: '0.118000' }, NOW, ACTOR);
      await repo.update('volume_4', { marginPct: '0.248000' }, LATER, ACTOR);
      expect((await repo.history(50)).map((c) => c.tierCode)).toEqual(['volume_4', 'volume_5']);
    });

    it('writes nothing for an empty patch', async () => {
      const repo = await makeRepo();
      await repo.update('volume_5', {}, LATER, ACTOR);
      expect(await repo.history(50)).toEqual([]);
    });

    it('honours the limit', async () => {
      const repo = await makeRepo();
      await repo.update('volume_5', { marginPct: '0.118000' }, NOW, ACTOR);
      await repo.update('volume_4', { marginPct: '0.248000' }, LATER, ACTOR);
      expect(await repo.history(1)).toHaveLength(1);
    });

    it('falls back to a visible placeholder rather than inventing a name', async () => {
      const repo = await makeRepo();
      await repo.update('volume_5', { marginPct: '0.118000' }, LATER, '');
      expect((await repo.history(50))[0]?.actor).toBe('unknown');
    });
  });
}
