// Tests the pricing tiers form: its coverage of the request schema, the multiplier and margin it shows, and its change log.
import { describe, expect, it } from 'vitest';

import type { PricingTier, PricingTierChange } from '@erp/types';

import {
  TIER_FIELDS,
  asPercent,
  coversRequestSchema,
  lastChangedBy,
  multiplierOf,
  tierChangeLog,
  valueOf,
} from './fields';

const EPOCH = '1970-01-01T00:00:00.000Z';

function tier(overrides: Partial<PricingTier> = {}): PricingTier {
  return {
    id: '01988a00-0500-7000-8000-000000000005',
    code: 'volume_5',
    name: 'Volume 5',
    marginPct: '0.160000',
    minPallets: 28,
    isListTier: false,
    updatedBy: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function change(overrides: Partial<PricingTierChange> = {}): PricingTierChange {
  return {
    tierCode: 'volume_5',
    actor: 'dev-billing',
    at: '2026-08-28T17:00:00.000Z',
    name: 'Volume 5',
    marginPct: '0.160000',
    minPallets: 28,
    ...overrides,
  };
}

describe('the form covers the request schema', () => {
  it('lists exactly the fields the API accepts', () => {
    expect(coversRequestSchema()).toBe(true);
  });

  it('names each field once', () => {
    const names = TIER_FIELDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('sends the threshold as a count and the margin as a percent of a decimal', () => {
    expect(TIER_FIELDS.find((f) => f.name === 'marginPct')?.kind).toBe('percent');
    expect(TIER_FIELDS.find((f) => f.name === 'marginPct')?.maxExclusive).toBe('1');
    expect(TIER_FIELDS.find((f) => f.name === 'minPallets')?.kind).toBe('count');
  });
});

describe('the tier multiplier, 1 / (1 - margin)', () => {
  it('works out the multiplier at a high and a low margin', () => {
    expect(multiplierOf('0.550000')).toBe('2.2222');
    expect(multiplierOf('0.160000')).toBe('1.1905');
  });

  it('reads 1 at a zero margin', () => {
    expect(multiplierOf('0.000000')).toBe('1.0000');
  });

  it('answers a dash rather than throwing on an impossible margin', () => {
    expect(multiplierOf('1.000000')).toBe('—');
    expect(multiplierOf('1.250000')).toBe('—');
  });
});

describe('the margin as a reader states it', () => {
  it('prints a margin as a percent to one decimal place', () => {
    expect(asPercent('0.550000')).toBe('55.0%');
    expect(asPercent('0.160000')).toBe('16.0%');
    expect(asPercent('0.435000')).toBe('43.5%');
  });
});

describe('who last changed a tier', () => {
  it('names the seed rather than saying unknown', () => {
    expect(lastChangedBy(null)).toBe('the initial seed');
  });

  it('names a person, and a system actor as itself', () => {
    expect(lastChangedBy('dev-billing')).toBe('dev-billing');
    expect(lastChangedBy('system:edit')).toBe('system:edit');
  });
});

describe('what an input is prefilled with', () => {
  it('shows the margin as the percent the label asks for', () => {
    expect(valueOf(tier(), 'marginPct')).toBe('16');
  });

  it('is lossless, so re-saving an untouched box writes back what was stored', () => {
    expect(valueOf(tier({ marginPct: '0.263500' }), 'marginPct')).toBe('26.35');
  });

  it('renders the threshold and the name as they are stored', () => {
    expect(valueOf(tier(), 'minPallets')).toBe('28');
    expect(valueOf(tier(), 'name')).toBe('Volume 5');
  });
});

describe('the change log', () => {
  it('pairs the newest change against the live tier', () => {
    const log = tierChangeLog(
      [tier({ marginPct: '0.170000', updatedBy: 'dev-billing' })],
      [change({ marginPct: '0.160000' })],
    );
    expect(log).toEqual([
      {
        at: '2026-08-28T17:00:00.000Z',
        actor: 'dev-billing',
        tierCode: 'volume_5',
        tierName: 'Volume 5',
        movements: [{ label: 'Margin %', from: '16', to: '17' }],
      },
    ]);
  });

  it('drops the values that did not move', () => {
    const log = tierChangeLog(
      [tier({ marginPct: '0.170000' })],
      [change({ marginPct: '0.160000' })],
    );
    expect(log[0]?.movements.map((m) => m.label)).toEqual(['Margin %']);
  });

  it('reports every value a single change moved', () => {
    const log = tierChangeLog(
      [tier({ name: 'Volume 5 revised', marginPct: '0.170000', minPallets: 30 })],
      [change()],
    );
    expect(log[0]?.movements).toEqual([
      { label: 'Name', from: 'Volume 5', to: 'Volume 5 revised' },
      { label: 'Margin %', from: '16', to: '17' },
      { label: 'From pallets', from: '28', to: '30' },
    ]);
  });

  it('chains a tier against its own previous change, not the list order', () => {
    const log = tierChangeLog(
      [
        tier({
          code: 'volume_4',
          id: '01988a00-0500-7000-8000-000000000004',
          name: 'Volume 4',
          marginPct: '0.210000',
          minPallets: 20,
        }),
        tier({ marginPct: '0.340000' }),
      ],
      [
        change({ tierCode: 'volume_5', marginPct: '0.170000', at: '2026-08-28T19:00:00.000Z' }),
        change({
          tierCode: 'volume_4',
          name: 'Volume 4',
          marginPct: '0.310000',
          minPallets: 20,
          at: '2026-08-28T18:00:00.000Z',
        }),
        change({ tierCode: 'volume_5', marginPct: '0.160000', at: '2026-08-28T17:00:00.000Z' }),
      ],
    );

    expect(log.map((c) => c.tierCode)).toEqual(['volume_5', 'volume_4', 'volume_5']);

    expect(log[0]?.movements).toEqual([{ label: 'Margin %', from: '17', to: '34' }]);

    expect(log[1]?.movements).toEqual([{ label: 'Margin %', from: '31', to: '21' }]);

    expect(log[2]?.movements).toEqual([{ label: 'Margin %', from: '16', to: '17' }]);
  });

  it('names the tier by its current name, so a renamed band is still findable', () => {
    const log = tierChangeLog(
      [tier({ name: 'Volume 5 revised', marginPct: '0.170000' })],
      [change({ name: 'Volume 5' })],
    );
    expect(log[0]?.tierName).toBe('Volume 5 revised');
  });

  it('prints a change that moved nothing rather than hiding it', () => {
    const log = tierChangeLog([tier()], [change()]);
    expect(log[0]?.movements).toEqual([]);
  });

  it('survives a change naming a tier the table no longer carries', () => {
    const log = tierChangeLog([tier({ code: 'volume_4', name: 'Volume 4' })], [change()]);
    expect(log[0]).toMatchObject({ tierCode: 'volume_5', tierName: 'Volume 5', movements: [] });
  });

  it('is empty when nothing has changed', () => {
    expect(tierChangeLog([tier()], [])).toEqual([]);
  });
});
