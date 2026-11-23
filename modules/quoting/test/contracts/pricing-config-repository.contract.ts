// The contract for `PricingConfigRepository` in modules/quoting/src/ports.ts. One set of
// assertions, run against the in-memory and the Drizzle adapter by
// modules/quoting/test/repository-contracts.test.ts. It pins down the single configuration row,
// partial updates, and a change log of previous values. A failure means one adapter breaks a
// promise the other keeps: docs/process/verifying-agent-written-code.md.
import { describe, expect, it } from 'vitest';

import type { PricingConfigRepository } from '../../src/ports';

export function pricingConfigRepositoryContract(
  makeRepo: () => Promise<PricingConfigRepository>,
): void {
  const NOW = new Date('2026-08-06T09:00:00.000Z');

  describe('get', () => {
    it('returns the seeded constants', async () => {
      const config = await (await makeRepo()).get();

      expect(config.poundsPerTonne).toBe('2204.62262185');
      expect(config.wastePct).toBe('0.020000');
    });

    it('returns the hardware costs at their column scales', async () => {
      const config = await (await makeRepo()).get();

      expect(config.coreCostPerCore).toBe('2.0000');
      expect(config.coreReferenceLengthIn).toBe('48.0000');

      expect(config.plugCostPerPlug).toBe('0.05000000');
      expect(config.plugsPerRoll).toBe(2);
      expect(config.palletCost).toBe('10.0000');
      expect(config.marginFloorPct).toBe('0.120000');
      expect(config.overwrapSurchargePct).toBe('0.040000');
    });
  });

  describe('update', () => {
    it('applies a single field and leaves the rest alone', async () => {
      const repo = await makeRepo();
      const updated = await repo.update({ wastePct: '0.039000' }, NOW);

      expect(updated.wastePct).toBe('0.039000');
      expect(updated.poundsPerTonne).toBe('2204.62262185');
      expect(updated.palletCost).toBe('10.0000');
      expect(updated.updatedAt).toBe(NOW.toISOString());
    });

    it('applies a hardware field', async () => {
      const repo = await makeRepo();
      const updated = await repo.update({ palletCost: '11.7500' }, NOW);

      expect(updated.palletCost).toBe('11.7500');
      expect((await repo.get()).palletCost).toBe('11.7500');
    });

    it('applies several fields at once', async () => {
      const repo = await makeRepo();
      const updated = await repo.update(
        { coreCostPerCore: '2.6500', plugsPerRoll: 4, wastePct: '0.028000' },
        NOW,
      );

      expect(updated.coreCostPerCore).toBe('2.6500');
      expect(updated.plugsPerRoll).toBe(4);
      expect(updated.wastePct).toBe('0.028000');
    });

    it('treats an empty patch as a no-op that does not stamp updatedAt', async () => {
      const repo = await makeRepo();
      const before = await repo.get();
      const after = await repo.update({}, NOW);

      expect(after.updatedAt).toBe(before.updatedAt);
      expect(after).toEqual(before);
    });

    it('persists the change for the next reader', async () => {
      const repo = await makeRepo();
      await repo.update({ wastePct: '0.052000' }, NOW);

      expect((await repo.get()).wastePct).toBe('0.052000');
    });
  });

  describe('history', () => {
    const LATER = new Date('2026-08-07T09:00:00.000Z');

    it('is empty until something changes', async () => {
      expect(await (await makeRepo()).history(10)).toEqual([]);
    });

    it('records the values a change replaced, not the ones it set', async () => {
      const repo = await makeRepo();
      await repo.update({ marginFloorPct: '0.147000', updatedBy: 'dev-billing' }, NOW);

      const [entry] = await repo.history(10);

      expect(entry?.marginFloorPct).toBe('0.120000');
      expect((await repo.get()).marginFloorPct).toBe('0.147000');
      expect(entry?.actor).toBe('dev-billing');
      expect(entry?.at).toBe(NOW.toISOString());
    });

    it('stamps the change with the update time, not with now', async () => {
      const repo = await makeRepo();
      await repo.update({ wastePct: '0.058000', updatedBy: 'dev-billing' }, NOW);

      expect((await repo.history(10))[0]?.at).toBe((await repo.get()).updatedAt);
    });

    it('carries every constant, not only the ones that moved', async () => {
      const repo = await makeRepo();
      await repo.update({ wastePct: '0.058000', updatedBy: 'dev-billing' }, NOW);

      const [entry] = await repo.history(10);

      expect(entry?.poundsPerTonne).toBe('2204.62262185');
      expect(entry?.plugsPerRoll).toBe(2);
      expect(entry?.ourVehicleFreightRate).toBe('30.0000');
    });

    it('returns newest first', async () => {
      const repo = await makeRepo();
      await repo.update({ wastePct: '0.058000', updatedBy: 'first' }, NOW);
      await repo.update({ wastePct: '0.031000', updatedBy: 'second' }, LATER);

      const entries = await repo.history(10);
      expect(entries.map((e) => e.actor)).toEqual(['second', 'first']);

      expect(entries[0]?.wastePct).toBe('0.058000');
      expect(entries[1]?.wastePct).toBe('0.020000');
    });

    it('writes no row for an empty patch', async () => {
      const repo = await makeRepo();
      await repo.update({}, NOW);

      expect(await repo.history(10)).toEqual([]);
    });

    it('honours the limit', async () => {
      const repo = await makeRepo();
      await repo.update({ wastePct: '0.058000', updatedBy: 'first' }, NOW);
      await repo.update({ wastePct: '0.031000', updatedBy: 'second' }, LATER);

      expect((await repo.history(1)).map((e) => e.actor)).toEqual(['second']);
    });
  });
}
