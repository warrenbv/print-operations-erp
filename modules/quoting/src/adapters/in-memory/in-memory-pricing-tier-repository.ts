// The in-memory adapter for `PricingTierRepository`. Contract:
// modules/quoting/test/contracts/pricing-tier-repository.contract.ts.
import { newId } from '@erp/db';

import type {
  CreatePricingTierRequest,
  PricingTier,
  PricingTierChange,
  UpdatePricingTierRequest,
} from '@erp/types';

import {
  DuplicateTierCodeError,
  DuplicateTierThresholdError,
  pricingConfigActor,
  type PricingTierRepository,
} from '../../ports';

export const DEFAULT_PRICING_TIER_IDS = {
  retail: '01988a00-0006-7000-8000-000000000001',
  small_batch: '01988a00-0006-7000-8000-000000000002',
  volume_1: '01988a00-0006-7000-8000-000000000003',
  list: '01988a00-0006-7000-8000-000000000004',
  volume_3: '01988a00-0006-7000-8000-000000000005',
  volume_4: '01988a00-0006-7000-8000-000000000006',
  volume_5: '01988a00-0006-7000-8000-000000000007',
} as const;

// Fictional reference rows. They equal the pricing_tiers rows seeded by
// infra/db/migrations/quoting/0000_baseline.sql, ids included.
export const DEFAULT_PRICING_TIERS: readonly Omit<PricingTier, 'createdAt' | 'updatedAt'>[] = [
  {
    id: DEFAULT_PRICING_TIER_IDS.retail,
    code: 'retail',
    name: 'Retail',
    marginPct: '0.550000',
    minPallets: 0,
    isListTier: false,
    updatedBy: null,
  },
  {
    id: DEFAULT_PRICING_TIER_IDS.small_batch,
    code: 'small_batch',
    name: 'Small batch',
    marginPct: '0.380000',
    minPallets: 1,
    isListTier: false,
    updatedBy: null,
  },
  {
    id: DEFAULT_PRICING_TIER_IDS.volume_1,
    code: 'volume_1',
    name: 'Volume 1',
    marginPct: '0.320000',
    minPallets: 5,
    isListTier: false,
    updatedBy: null,
  },
  {
    id: DEFAULT_PRICING_TIER_IDS.list,
    code: 'list',
    name: 'List',
    marginPct: '0.280000',
    minPallets: 10,
    isListTier: true,
    updatedBy: null,
  },
  {
    id: DEFAULT_PRICING_TIER_IDS.volume_3,
    code: 'volume_3',
    name: 'Volume 3',
    marginPct: '0.240000',
    minPallets: 15,
    isListTier: false,
    updatedBy: null,
  },
  {
    id: DEFAULT_PRICING_TIER_IDS.volume_4,
    code: 'volume_4',
    name: 'Volume 4',
    marginPct: '0.210000',
    minPallets: 20,
    isListTier: false,
    updatedBy: null,
  },
  {
    id: DEFAULT_PRICING_TIER_IDS.volume_5,
    code: 'volume_5',
    name: 'Volume 5',
    marginPct: '0.170000',
    minPallets: 30,
    isListTier: false,
    updatedBy: null,
  },
];

const EPOCH = new Date(0).toISOString();

export class InMemoryPricingTierRepository implements PricingTierRepository {
  readonly #byCode = new Map<string, PricingTier>();

  readonly #changes: PricingTierChange[] = [];

  constructor(
    seed: readonly PricingTier[] = DEFAULT_PRICING_TIERS.map((t) => ({
      ...t,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    })),
  ) {
    for (const tier of seed) {
      this.#byCode.set(tier.code, tier);
    }
  }

  async list(): Promise<readonly PricingTier[]> {
    return [...this.#byCode.values()].sort((a, b) => a.minPallets - b.minPallets);
  }

  async findByCode(code: string): Promise<PricingTier | null> {
    return this.#byCode.get(code) ?? null;
  }

  async create(
    request: CreatePricingTierRequest,
    createdBy: string,
    at: Date,
  ): Promise<PricingTier> {
    if (this.#byCode.has(request.code)) {
      throw new DuplicateTierCodeError(request.code);
    }
    for (const other of this.#byCode.values()) {
      if (other.minPallets === request.minPallets) {
        throw new DuplicateTierThresholdError(request.minPallets);
      }
    }
    const tier: PricingTier = {
      id: newId(),
      code: request.code,
      name: request.name,
      marginPct: request.marginPct,
      minPallets: request.minPallets,

      isListTier: false,
      updatedBy: createdBy,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    };
    this.#byCode.set(tier.code, tier);

    return tier;
  }

  async update(
    code: string,
    patch: UpdatePricingTierRequest,
    updatedAt: Date,
    updatedBy: string,
  ): Promise<PricingTier | null> {
    const existing = this.#byCode.get(code);
    if (existing === undefined) {
      return null;
    }

    const hasChange =
      patch.name !== undefined || patch.marginPct !== undefined || patch.minPallets !== undefined;
    if (!hasChange) {
      return existing;
    }
    if (patch.minPallets !== undefined && patch.minPallets !== existing.minPallets) {
      for (const [otherCode, other] of this.#byCode) {
        if (otherCode !== code && other.minPallets === patch.minPallets) {
          throw new DuplicateTierThresholdError(patch.minPallets);
        }
      }
    }
    const next: PricingTier = {
      ...existing,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.marginPct === undefined ? {} : { marginPct: patch.marginPct }),
      ...(patch.minPallets === undefined ? {} : { minPallets: patch.minPallets }),
      updatedBy,
      updatedAt: updatedAt.toISOString(),
    };
    this.#byCode.set(code, next);

    this.#changes.push({
      tierCode: existing.code,
      actor: pricingConfigActor(updatedBy),
      at: updatedAt.toISOString(),
      name: existing.name,
      marginPct: existing.marginPct,
      minPallets: existing.minPallets,
    });
    return next;
  }

  async history(limit: number): Promise<readonly PricingTierChange[]> {
    return [...this.#changes].reverse().slice(0, limit);
  }
}
