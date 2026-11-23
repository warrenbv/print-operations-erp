// Tests the pricing tier service: listing, updates, history, selection, and the rule that a tier
// starting at zero pallets always remains. Subject:
// modules/quoting/src/services/pricing-tier-service.ts.
import { describe, expect, it } from 'vitest';

import { InMemoryPricingTierRepository } from '../src/adapters/in-memory/in-memory-pricing-tier-repository';
import {
  DuplicateTierCodeError,
  DuplicateTierThresholdError,
  NoTierForVolumeError,
  NoZeroThresholdTierError,
  UnknownTierCodeError,
} from '../src/ports';
import { PricingTierService } from '../src/services/pricing-tier-service';
import { tierMultiplier } from '../src/tier-selection';
import { MutableClock } from './fixtures';

function newService(): { service: PricingTierService; clock: MutableClock } {
  const clock = new MutableClock();
  const service = new PricingTierService({ tiers: new InMemoryPricingTierRepository(), clock });
  return { service, clock };
}

describe('PricingTierService.list', () => {
  it('returns the seven seeded tiers ordered by threshold', async () => {
    const { service } = newService();
    const tiers = await service.list();
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

  it('marks exactly one tier as the published list tier', async () => {
    const { service } = newService();
    const listTiers = (await service.list()).filter((t) => t.isListTier);
    expect(listTiers.map((t) => t.code)).toEqual(['list']);
  });

  it('reports the seeded tiers as changed by nobody', async () => {
    const { service } = newService();
    expect((await service.list()).every((t) => t.updatedBy === null)).toBe(true);
  });
});

describe('PricingTierService.update', () => {
  it('changes a threshold and re-sorts the table', async () => {
    const { service } = newService();
    await service.update('volume_5', { minPallets: 2 }, 'dev-billing');
    const tiers = await service.list();

    expect(tiers.map((t) => t.code)).toEqual([
      'retail',
      'small_batch',
      'volume_5',
      'volume_1',
      'list',
      'volume_3',
      'volume_4',
    ]);
  });

  it('reprices subsequent selections — config, not history', async () => {
    const { service } = newService();
    expect((await service.select({ pallets: 30 })).tier.code).toBe('volume_5');
    await service.update('volume_5', { minPallets: 100 }, 'dev-billing');
    expect((await service.select({ pallets: 30 })).tier.code).toBe('volume_4');
  });

  it('stamps updatedAt from the clock', async () => {
    const { service, clock } = newService();
    clock.advance(60_000);
    const updated = await service.update('volume_3', { marginPct: '0.292000' }, 'dev-billing');
    expect(updated?.marginPct).toBe('0.292000');
    expect(updated?.updatedAt).toBe(clock.now().toISOString());
  });

  it('records who changed it', async () => {
    const { service } = newService();
    const updated = await service.update('volume_3', { marginPct: '0.292000' }, 'dev-billing');
    expect(updated?.updatedBy).toBe('dev-billing');
  });

  it('refuses to give two tiers the same threshold', async () => {
    const { service } = newService();
    await expect(
      service.update('volume_5', { minPallets: 1 }, 'dev-billing'),
    ).rejects.toBeInstanceOf(DuplicateTierThresholdError);
  });

  it('allows setting a threshold to the value it already holds', async () => {
    const { service } = newService();
    expect((await service.update('volume_5', { minPallets: 30 }, 'dev-billing'))?.minPallets).toBe(
      30,
    );
  });

  it('returns null for an unknown code so the edge can 404', async () => {
    const { service } = newService();
    expect(await service.update('platinum', { minPallets: 5 }, 'dev-billing')).toBeNull();
  });
});

describe('PricingTierService.update keeps a tier at zero pallets', () => {
  it('refuses to move the zero-threshold tier off zero', async () => {
    const { service } = newService();
    await expect(service.update('retail', { minPallets: 3 }, 'dev-billing')).rejects.toBeInstanceOf(
      NoZeroThresholdTierError,
    );
  });

  it('leaves the table untouched when it refuses', async () => {
    const { service } = newService();
    await expect(service.update('retail', { minPallets: 3 }, 'dev-billing')).rejects.toBeInstanceOf(
      NoZeroThresholdTierError,
    );
    expect((await service.list())[0]?.minPallets).toBe(0);
    expect(await service.history()).toEqual([]);
  });

  it('prevents a real failure, demonstrated by reaching past it', async () => {
    const tiers = new InMemoryPricingTierRepository();
    const clock = new MutableClock();
    await tiers.update('retail', { minPallets: 3 }, clock.now(), 'dev-billing');
    const service = new PricingTierService({ tiers, clock });

    await expect(service.select({ pallets: 0 })).rejects.toBeInstanceOf(NoTierForVolumeError);
  });

  it('still allows the zero tier to change its margin and name', async () => {
    const { service } = newService();
    const updated = await service.update(
      'retail',
      { marginPct: '0.500000', name: 'Updated demo retail' },
      'dev-billing',
    );
    expect(updated?.marginPct).toBe('0.500000');
    expect(updated?.name).toBe('Updated demo retail');
  });

  it('guards the resulting table, not one named row', async () => {
    const { service } = newService();
    expect((await service.update('volume_4', { minPallets: 19 }, 'dev-billing'))?.minPallets).toBe(
      19,
    );
    expect(
      (await service.update('small_batch', { minPallets: 3 }, 'dev-billing'))?.minPallets,
    ).toBe(3);
    expect((await service.list()).some((t) => t.minPallets === 0)).toBe(true);
  });

  it('does not fire for an unknown code, so the edge still answers 404', async () => {
    const { service } = newService();
    expect(await service.update('platinum', { minPallets: 9 }, 'dev-billing')).toBeNull();
  });
});

describe('PricingTierService.create', () => {
  const NEW_TIER = {
    code: 'volume_6',
    name: 'Volume 6',
    marginPct: '0.136000',
    minPallets: 40,
  } as const;

  it('adds a tier and places it by threshold', async () => {
    const { service } = newService();
    const created = await service.create(NEW_TIER, 'dev-billing');
    expect(created.code).toBe('volume_6');
    expect((await service.list()).map((t) => t.code)).toEqual([
      'retail',
      'small_batch',
      'volume_1',
      'list',
      'volume_3',
      'volume_4',
      'volume_5',
      'volume_6',
    ]);
  });

  it('is immediately selectable by volume', async () => {
    const { service } = newService();
    expect((await service.select({ pallets: 40 })).tier.code).toBe('volume_5');
    await service.create(NEW_TIER, 'dev-billing');
    expect((await service.select({ pallets: 40 })).tier.code).toBe('volume_6');
  });

  it('records who added it, and stamps both timestamps from the clock', async () => {
    const { service, clock } = newService();
    clock.advance(60_000);
    const created = await service.create(NEW_TIER, 'dev-billing');
    expect(created.updatedBy).toBe('dev-billing');
    expect(created.createdAt).toBe(clock.now().toISOString());
    expect(created.updatedAt).toBe(clock.now().toISOString());
  });

  it('never makes the new tier the published list tier', async () => {
    const { service } = newService();
    const created = await service.create(NEW_TIER, 'dev-billing');
    expect(created.isListTier).toBe(false);
    expect((await service.list()).filter((t) => t.isListTier).map((t) => t.code)).toEqual(['list']);
  });

  it('refuses a code that is taken', async () => {
    const { service } = newService();
    await expect(
      service.create({ ...NEW_TIER, code: 'volume_5' }, 'dev-billing'),
    ).rejects.toBeInstanceOf(DuplicateTierCodeError);
  });

  it('refuses a threshold another tier already starts at', async () => {
    const { service } = newService();
    await expect(
      service.create({ ...NEW_TIER, minPallets: 30 }, 'dev-billing'),
    ).rejects.toBeInstanceOf(DuplicateTierThresholdError);
  });

  it('writes no history row, because a create has no before', async () => {
    const { service } = newService();
    await service.create(NEW_TIER, 'dev-billing');
    expect(await service.history()).toEqual([]);
  });
});

describe('PricingTierService.history', () => {
  it('records the values the change replaced, not the new ones', async () => {
    const { service, clock } = newService();
    clock.advance(60_000);
    await service.update('volume_5', { marginPct: '0.118000' }, 'dev-billing');

    const [entry] = await service.history();
    expect(entry).toMatchObject({
      tierCode: 'volume_5',
      actor: 'dev-billing',

      marginPct: '0.170000',
      minPallets: 30,
      name: 'Volume 5',
      at: clock.now().toISOString(),
    });
  });

  it('returns changes newest first', async () => {
    const { service, clock } = newService();
    await service.update('volume_5', { marginPct: '0.118000' }, 'dev-billing');
    clock.advance(60_000);
    await service.update('volume_4', { marginPct: '0.248000' }, 'dev-admin');

    expect((await service.history()).map((c) => c.tierCode)).toEqual(['volume_4', 'volume_5']);
  });

  it('writes nothing for an empty patch', async () => {
    const { service } = newService();
    await service.update('volume_5', {}, 'dev-billing');
    expect(await service.history()).toEqual([]);
  });

  it('caps what it returns', async () => {
    const { service, clock } = newService();
    for (let i = 0; i < 5; i += 1) {
      clock.advance(1_000);
      await service.update('volume_5', { marginPct: '0.11800' + String(i) }, 'dev-billing');
    }
    expect(await service.history(2)).toHaveLength(2);
  });
});

describe('PricingTierService.select', () => {
  it('auto-selects against the live table, not a stale copy', async () => {
    const { service } = newService();
    expect((await service.select({ pallets: 10 })).tier.code).toBe('list');
  });

  it('applies an override and surfaces an unknown one', async () => {
    const { service } = newService();
    expect((await service.select({ pallets: 10, overrideCode: 'retail' })).source).toBe('override');
    await expect(service.select({ pallets: 10, overrideCode: 'nope' })).rejects.toBeInstanceOf(
      UnknownTierCodeError,
    );
  });
});

describe('tierMultiplier on a served tier', () => {
  it('derives the multiplier from the current margin', async () => {
    const { service } = newService();
    const [retail] = await service.list();
    expect(tierMultiplier(retail!).toFixed(4)).toBe('2.2222');
  });
});
