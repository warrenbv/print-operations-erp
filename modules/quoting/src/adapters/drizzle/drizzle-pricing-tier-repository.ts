// The PostgreSQL adapter for `PricingTierRepository`. Each update writes the tier's previous values
// to pricing_tier_changes in the same transaction. Contract:
// modules/quoting/test/contracts/pricing-tier-repository.contract.ts.
import { isUniqueViolation, newId } from '@erp/db';
import type {
  CreatePricingTierRequest,
  PricingTier,
  PricingTierChange,
  UpdatePricingTierRequest,
} from '@erp/types';
import { asc, desc, eq } from 'drizzle-orm';

import type { QuotingDb } from '../../data/quoting-db';
import { pricingTierChanges, pricingTiers } from '../../data/schema';
import {
  DuplicateTierCodeError,
  DuplicateTierThresholdError,
  pricingConfigActor,
  type PricingTierRepository,
} from '../../ports';

type Row = typeof pricingTiers.$inferSelect;
type ChangeRow = typeof pricingTierChanges.$inferSelect;

function toTier(row: Row): PricingTier {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    marginPct: row.marginPct,
    minPallets: row.minPallets,
    isListTier: row.isListTier,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toChange(row: ChangeRow): PricingTierChange {
  return {
    tierCode: row.tierCode,
    actor: row.actor,
    at: row.at.toISOString(),
    name: row.previousName,
    marginPct: row.previousMarginPct,
    minPallets: row.previousMinPallets,
  };
}

export class DrizzlePricingTierRepository implements PricingTierRepository {
  readonly #db: QuotingDb;

  constructor(db: QuotingDb) {
    this.#db = db;
  }

  async list(): Promise<readonly PricingTier[]> {
    const rows = await this.#db.select().from(pricingTiers).orderBy(asc(pricingTiers.minPallets));
    return rows.map(toTier);
  }

  async findByCode(code: string): Promise<PricingTier | null> {
    const [row] = await this.#db
      .select()
      .from(pricingTiers)
      .where(eq(pricingTiers.code, code))
      .limit(1);
    return row === undefined ? null : toTier(row);
  }

  async create(
    request: CreatePricingTierRequest,
    createdBy: string,
    at: Date,
  ): Promise<PricingTier> {
    try {
      const [row] = await this.#db
        .insert(pricingTiers)
        .values({
          id: newId(),
          code: request.code,
          name: request.name,
          marginPct: request.marginPct,
          minPallets: request.minPallets,

          isListTier: false,
          updatedBy: createdBy,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      if (row === undefined) {
        throw new Error('insert into quoting.pricing_tiers returned no row');
      }
      return toTier(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Two unique indexes can fail here. A code still free means the threshold clashed.
        throw (await this.findByCode(request.code)) === null
          ? new DuplicateTierThresholdError(request.minPallets)
          : new DuplicateTierCodeError(request.code);
      }
      throw err;
    }
  }

  async update(
    code: string,
    patch: UpdatePricingTierRequest,
    updatedAt: Date,
    updatedBy: string,
  ): Promise<PricingTier | null> {
    const hasChange =
      patch.name !== undefined || patch.marginPct !== undefined || patch.minPallets !== undefined;
    if (!hasChange) {
      return this.findByCode(code);
    }

    try {
      return await this.#db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(pricingTiers)
          .where(eq(pricingTiers.code, code))
          .limit(1);
        if (before === undefined) {
          return null;
        }

        const [row] = await tx
          .update(pricingTiers)
          .set({
            ...(patch.name === undefined ? {} : { name: patch.name }),
            ...(patch.marginPct === undefined ? {} : { marginPct: patch.marginPct }),
            ...(patch.minPallets === undefined ? {} : { minPallets: patch.minPallets }),
            updatedBy,
            updatedAt,
          })
          .where(eq(pricingTiers.code, code))
          .returning();
        if (row === undefined) {
          return null;
        }

        await tx.insert(pricingTierChanges).values({
          id: newId(),
          tierCode: before.code,
          actor: pricingConfigActor(updatedBy),

          at: updatedAt,
          previousName: before.name,
          previousMarginPct: before.marginPct,
          previousMinPallets: before.minPallets,
        });

        return toTier(row);
      });
    } catch (err) {
      if (isUniqueViolation(err) && patch.minPallets !== undefined) {
        throw new DuplicateTierThresholdError(patch.minPallets);
      }
      throw err;
    }
  }

  async history(limit: number): Promise<readonly PricingTierChange[]> {
    const rows = await this.#db
      .select()
      .from(pricingTierChanges)
      .orderBy(desc(pricingTierChanges.at))
      .limit(limit);
    return rows.map(toChange);
  }
}
