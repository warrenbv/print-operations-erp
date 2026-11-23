// The PostgreSQL adapter for `PricingConfigRepository`. The single row is seeded by
// infra/db/migrations/quoting/0000_baseline.sql, and each update writes the previous values to
// pricing_config_changes in the same transaction.
// Contract: modules/quoting/test/contracts/pricing-config-repository.contract.ts.
import { newId } from '@erp/db';
import type { PricingConfig, PricingConfigChange } from '@erp/types';
import { desc, eq } from 'drizzle-orm';

import type { QuotingDb } from '../../data/quoting-db';
import { pricingConfig, pricingConfigChanges } from '../../data/schema';
import { pricingConfigActor, type PricingConfigRepository } from '../../ports';

type Row = typeof pricingConfig.$inferSelect;
type ChangeRow = typeof pricingConfigChanges.$inferSelect;

function toPreviousColumns(row: Row) {
  return {
    previousPoundsPerTonne: row.poundsPerTonne,
    previousWastePct: row.wastePct,
    previousCoreCostPerCore: row.coreCostPerCore,
    previousCoreReferenceLengthIn: row.coreReferenceLengthIn,
    previousPlugCostPerPlug: row.plugCostPerPlug,
    previousPlugsPerRoll: row.plugsPerRoll,
    previousPalletCost: row.palletCost,
    previousMarginFloorPct: row.marginFloorPct,
    previousOverwrapSurchargePct: row.overwrapSurchargePct,
    previousOurVehicleFreightRate: row.ourVehicleFreightRate,
  };
}

function toChange(row: ChangeRow): PricingConfigChange {
  return {
    at: row.at.toISOString(),
    actor: row.actor,
    poundsPerTonne: row.previousPoundsPerTonne,
    wastePct: row.previousWastePct,
    coreCostPerCore: row.previousCoreCostPerCore,
    coreReferenceLengthIn: row.previousCoreReferenceLengthIn,
    plugCostPerPlug: row.previousPlugCostPerPlug,
    plugsPerRoll: row.previousPlugsPerRoll,
    palletCost: row.previousPalletCost,
    marginFloorPct: row.previousMarginFloorPct,
    overwrapSurchargePct: row.previousOverwrapSurchargePct,
    ourVehicleFreightRate: row.previousOurVehicleFreightRate,
  };
}

function toConfig(row: Row): PricingConfig {
  return {
    poundsPerTonne: row.poundsPerTonne,
    wastePct: row.wastePct,
    coreCostPerCore: row.coreCostPerCore,
    coreReferenceLengthIn: row.coreReferenceLengthIn,
    plugCostPerPlug: row.plugCostPerPlug,
    plugsPerRoll: row.plugsPerRoll,
    palletCost: row.palletCost,
    marginFloorPct: row.marginFloorPct,
    overwrapSurchargePct: row.overwrapSurchargePct,
    ourVehicleFreightRate: row.ourVehicleFreightRate,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export class DrizzlePricingConfigRepository implements PricingConfigRepository {
  readonly #db: QuotingDb;

  constructor(db: QuotingDb) {
    this.#db = db;
  }

  async get(): Promise<PricingConfig> {
    const [row] = await this.#db
      .select()
      .from(pricingConfig)
      .where(eq(pricingConfig.isSingleton, true))
      .limit(1);
    if (row === undefined) {
      throw new Error('quoting.pricing_config has no row — the 0000 migration seed did not run');
    }
    return toConfig(row);
  }

  async update(
    patch: Partial<Omit<PricingConfig, 'updatedAt'>>,
    updatedAt: Date,
  ): Promise<PricingConfig> {
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(changes).length === 0) {
      return this.get();
    }

    return this.#db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(pricingConfig)
        .where(eq(pricingConfig.isSingleton, true))
        .limit(1);
      if (before === undefined) {
        throw new Error('quoting.pricing_config has no row — the 0000 migration seed did not run');
      }

      const [row] = await tx
        .update(pricingConfig)
        .set({ ...changes, updatedAt })
        .where(eq(pricingConfig.isSingleton, true))
        .returning();
      if (row === undefined) {
        throw new Error('quoting.pricing_config has no row — the 0000 migration seed did not run');
      }

      await tx.insert(pricingConfigChanges).values({
        id: newId(),

        actor: pricingConfigActor(changes['updatedBy']),

        at: updatedAt,
        ...toPreviousColumns(before),
      });

      return toConfig(row);
    });
  }

  async history(limit: number): Promise<readonly PricingConfigChange[]> {
    const rows = await this.#db
      .select()
      .from(pricingConfigChanges)
      .orderBy(desc(pricingConfigChanges.at))
      .limit(limit);
    return rows.map(toChange);
  }
}
