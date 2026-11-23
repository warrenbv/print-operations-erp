// The contract for `PalletFitRepository` in modules/quoting/src/ports.ts. One set of assertions,
// run against the in-memory and the Drizzle adapter by
// modules/quoting/test/repository-contracts.test.ts. It pins down fits listed by product family in
// width order, and the seeded rows as served. A failure means one adapter breaks a promise the
// other keeps: docs/process/verifying-agent-written-code.md.
import { describe, expect, it } from 'vitest';

import type { PalletFitRepository } from '../../src/ports';

export function palletFitRepositoryContract(makeRepo: () => Promise<PalletFitRepository>): void {
  describe('list', () => {
    it("returns Kraft's ten widths ordered ascending", async () => {
      const fits = await (await makeRepo()).list('kraft');
      expect(fits.map((f) => f.rollWidthIn)).toEqual([8, 10, 12, 16, 18, 24, 28, 36, 42, 54]);
      expect(fits.map((f) => f.rollsPerPallet)).toEqual([108, 86, 72, 54, 48, 36, 30, 24, 20, 16]);
    });

    it("returns Butcher's own table, which is not Kraft's", async () => {
      const fits = await (await makeRepo()).list('butcher');

      expect(fits.map((f) => f.rollWidthIn)).toEqual([10, 12, 18, 24, 26, 32, 36, 44, 50, 66]);
      expect(fits.find((f) => f.rollWidthIn === 10)?.rollsPerPallet).toBe(76);
      expect(fits.find((f) => f.rollWidthIn === 26)?.rollsPerPallet).toBe(29);
    });

    it('returns Newsprint with its own widths', async () => {
      const fits = await (await makeRepo()).list('newsprint');
      expect(fits.map((f) => f.rollWidthIn)).toEqual([8, 12, 17, 22, 24, 28, 34, 36, 42, 54]);
    });

    it('returns Digital Bond, the narrowest range', async () => {
      const fits = await (await makeRepo()).list('digital_bond');
      expect(fits.map((f) => f.rollWidthIn)).toEqual([8, 11, 12, 17, 22, 24, 28]);
    });

    it('never mixes families', async () => {
      const repo = await makeRepo();
      for (const family of ['kraft', 'butcher', 'newsprint', 'digital_bond'] as const) {
        const fits = await repo.list(family);
        expect(fits.every((f) => f.productFamily === family)).toBe(true);
      }
    });

    it('gives every row in a family a distinct width', async () => {
      const fits = await (await makeRepo()).list('kraft');
      expect(new Set(fits.map((f) => f.rollWidthIn)).size).toBe(fits.length);
    });
  });

  describe('the seeded widths, as list serves them', () => {
    const at = async (family: 'kraft' | 'butcher', width: number) =>
      (await (await makeRepo()).list(family)).find((fit) => fit.rollWidthIn === width) ?? null;

    it('finds a seeded width in the family asked for', async () => {
      const fit = await at('kraft', 24);
      expect(fit?.rollsPerPallet).toBe(36);
      expect(fit?.productFamily).toBe('kraft');
    });

    it('answers differently for the same width in a different family', async () => {
      expect((await at('kraft', 12))?.rollsPerPallet).toBe(72);
      expect((await at('butcher', 12))?.rollsPerPallet).toBe(64);
    });

    it('lists no width the family does not carry', async () => {
      expect(await at('butcher', 8)).toBeNull();
      expect(await at('kraft', 72)).toBeNull();
    });

    it('lists no width that is not a listed step', async () => {
      expect(await at('kraft', 26)).toBeNull();
    });
  });
}
