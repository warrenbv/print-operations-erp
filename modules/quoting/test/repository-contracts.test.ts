// Runs the repository contracts in modules/quoting/test/contracts/, all but the tax rate one,
// against both adapters: the in-memory adapter always, and the Drizzle adapter against a migrated
// PostgreSQL database under `pnpm test:db`. One set of assertions for both keeps the two adapters
// from disagreeing: docs/process/verifying-agent-written-code.md. A failure means an adapter breaks
// a promise of its port in modules/quoting/src/ports.ts.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@erp/db';

import { DrizzleGradeRepository } from '../src/adapters/drizzle/drizzle-grade-repository';
import { DrizzlePalletFitRepository } from '../src/adapters/drizzle/drizzle-pallet-fit-repository';
import { DrizzlePricingConfigRepository } from '../src/adapters/drizzle/drizzle-pricing-config-repository';
import { DrizzlePricingTierRepository } from '../src/adapters/drizzle/drizzle-pricing-tier-repository';
import { DrizzleQuoteApprovalRepository } from '../src/adapters/drizzle/drizzle-quote-approval-repository';
import { DrizzleQuoteRepository } from '../src/adapters/drizzle/drizzle-quote-repository';
import { InMemoryGradeRepository } from '../src/adapters/in-memory/in-memory-grade-repository';
import {
  DEFAULT_PALLET_FITS,
  InMemoryPalletFitRepository,
} from '../src/adapters/in-memory/in-memory-pallet-fit-repository';
import {
  DEFAULT_PRICING_CONFIG,
  InMemoryPricingConfigRepository,
} from '../src/adapters/in-memory/in-memory-pricing-config-repository';
import {
  DEFAULT_PRICING_TIERS,
  InMemoryPricingTierRepository,
} from '../src/adapters/in-memory/in-memory-pricing-tier-repository';
import { InMemoryQuoteApprovalRepository } from '../src/adapters/in-memory/in-memory-quote-approval-repository';
import { InMemoryQuoteRepository } from '../src/adapters/in-memory/in-memory-quote-repository';
import { createQuotingDb } from '../src/data/quoting-db';
import type {
  GradeRepository,
  PalletFitRepository,
  PricingConfigRepository,
  PricingTierRepository,
  QuoteRepository,
} from '../src/ports';
import { gradeRepositoryContract } from './contracts/grade-repository.contract';
import { palletFitRepositoryContract } from './contracts/pallet-fit-repository.contract';
import { pricingConfigRepositoryContract } from './contracts/pricing-config-repository.contract';
import { pricingTierRepositoryContract } from './contracts/pricing-tier-repository.contract';
import { quoteRepositoryContract } from './contracts/quote-repository.contract';
import { quoteApprovalRepositoryContract } from './contracts/quote-approval-repository.contract';

const db = moduleTestDatabase({
  moduleName: 'quoting',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/quoting'),

  isolationKey: 'contract',
});

const describeDb = db.enabled ? describe : describe.skip;

describe('InMemoryGradeRepository', () => {
  gradeRepositoryContract(async (): Promise<GradeRepository> => new InMemoryGradeRepository());
});

describe('InMemoryPricingTierRepository', () => {
  pricingTierRepositoryContract(
    async (): Promise<PricingTierRepository> => new InMemoryPricingTierRepository(),
  );
});

describe('InMemoryPalletFitRepository', () => {
  palletFitRepositoryContract(
    async (): Promise<PalletFitRepository> => new InMemoryPalletFitRepository(),
  );
});

describe('InMemoryPricingConfigRepository', () => {
  pricingConfigRepositoryContract(
    async (): Promise<PricingConfigRepository> => new InMemoryPricingConfigRepository(),
  );
});

function newQuoteRow(customerId: string) {
  const id = newId();
  return {
    id,
    customerId,
    status: 'draft' as const,
    rootQuoteId: id,
    versionNumber: 1,
    createdAt: new Date('2026-08-19T19:00:00.000Z'),
    updatedAt: new Date('2026-08-19T19:00:00.000Z'),
  };
}

describe('InMemoryQuoteRepository', () => {
  quoteRepositoryContract(async (): Promise<QuoteRepository> => new InMemoryQuoteRepository());
});

describe('InMemoryQuoteApprovalRepository', () => {
  quoteApprovalRepositoryContract(async () => {
    const approvals = new InMemoryQuoteApprovalRepository();
    return { approvals, quotes: new InMemoryQuoteRepository(approvals), newQuoteRow };
  });
});

describeDb('Drizzle adapters', () => {
  beforeAll(async () => {
    await db.setup();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe('DrizzleGradeRepository', () => {
    beforeEach(async () => {
      await db.truncate(['quoting.grades']);
    });

    gradeRepositoryContract(
      async (): Promise<GradeRepository> => new DrizzleGradeRepository(createQuotingDb(db.pool)),
    );
  });

  describe('DrizzlePricingTierRepository', () => {
    beforeEach(async () => {
      await db.truncate(['quoting.pricing_tiers', 'quoting.pricing_tier_changes']);
      for (const tier of DEFAULT_PRICING_TIERS) {
        await db.pool.query(
          `insert into quoting.pricing_tiers
             (id, code, name, margin_pct, min_pallets, is_list_tier, updated_by)
           values ($1, $2, $3, $4, $5, $6, null)`,
          [tier.id, tier.code, tier.name, tier.marginPct, tier.minPallets, tier.isListTier],
        );
      }
    });

    pricingTierRepositoryContract(
      async (): Promise<PricingTierRepository> =>
        new DrizzlePricingTierRepository(createQuotingDb(db.pool)),
    );
  });

  describe('DrizzlePalletFitRepository', () => {
    beforeEach(async () => {
      for (const fit of DEFAULT_PALLET_FITS) {
        await db.pool.query(
          `update quoting.pallet_fits set rolls_per_pallet = $3
            where product_family = $1 and roll_width_in = $2`,
          [fit.productFamily, fit.rollWidthIn, fit.rollsPerPallet],
        );
      }
    });

    palletFitRepositoryContract(
      async (): Promise<PalletFitRepository> =>
        new DrizzlePalletFitRepository(createQuotingDb(db.pool)),
    );
  });

  describe('DrizzlePricingConfigRepository', () => {
    beforeEach(async () => {
      const config = DEFAULT_PRICING_CONFIG;
      await db.pool.query(
        `update quoting.pricing_config set
           pounds_per_tonne = $1, waste_pct = $2, core_cost_per_core = $3,
           core_reference_length_in = $4, plug_cost_per_plug = $5, plugs_per_roll = $6,
           pallet_cost = $7, margin_floor_pct = $8, overwrap_surcharge_pct = $9,
           our_vehicle_freight_rate = $10,
           updated_at = '2026-01-01T00:00:00.000Z',
           updated_by = null
         where is_singleton = true`,
        [
          config.poundsPerTonne,
          config.wastePct,
          config.coreCostPerCore,
          config.coreReferenceLengthIn,
          config.plugCostPerPlug,
          config.plugsPerRoll,
          config.palletCost,
          config.marginFloorPct,
          config.overwrapSurchargePct,
          config.ourVehicleFreightRate,
        ],
      );

      await db.truncate(['quoting.pricing_config_changes']);
    });

    pricingConfigRepositoryContract(
      async (): Promise<PricingConfigRepository> =>
        new DrizzlePricingConfigRepository(createQuotingDb(db.pool)),
    );
  });

  describe('DrizzleQuoteRepository', () => {
    const gradeId = newId();

    beforeEach(async () => {
      await db.truncate(['quoting.quote_lines', 'quoting.quotes', 'quoting.grades']);
      await db.pool.query(
        `insert into quoting.grades
           (id, product_family, code, basis_weight_lb, ream_area_divisor, paper_cost_per_tonne)
         values ($1, 'kraft', 'CONTRACT-50', 50, 432, 1215)`,
        [gradeId],
      );
    });

    quoteRepositoryContract(
      async (): Promise<QuoteRepository> => new DrizzleQuoteRepository(createQuotingDb(db.pool)),
      gradeId,
    );

    // A second connection holds an uncommitted approval while a line save starts. The save queues
    // behind it on the row lock, or, were the lock lost, on the UPDATE, whose version predicate
    // then matches no row. Either way it fails and the approval stands. The test waits for the
    // save to be blocked by polling pg_stat_activity, not for a length of time.
    it('refuses a line save that queues behind an approval another connection commits', async () => {
      const repo = new DrizzleQuoteRepository(createQuotingDb(db.pool));
      const input = newQuoteRow(newId());
      await repo.create(input);
      const read = (await repo.findById(input.id))!;

      const other = await db.pool.connect();
      try {
        await other.query('begin');
        await other.query(
          `update quoting.quotes
              set override_approved_by = 'dev-billing', override_approved_at = now(),
                  lock_version = lock_version + 1
            where id = $1`,
          [input.id],
        );

        const at = new Date('2026-08-19T20:00:00.000Z');
        const entry = { id: newId(), actor: 'system:edit', reason: 'edited', at: at.toISOString() };
        const save = repo
          .replaceLines(input.id, [], at, read.lockVersion, undefined, {
            price: entry,
            floor: { ...entry, id: newId() },
          })
          .then(
            () => 'saved',
            (err: unknown) => err,
          );

        let blocked = false;
        for (let tries = 0; !blocked && tries < 10_000; tries += 1) {
          const { rows } = await db.pool.query<{ waiting: number }>(
            `select count(*)::int as waiting from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock'`,
          );
          blocked = (rows[0]?.waiting ?? 0) > 0;
        }
        expect(blocked).toBe(true);

        await other.query('commit');
        expect(await save).toBeInstanceOf(Error);
      } finally {
        other.release();
      }

      const stored = await repo.findById(input.id);
      expect(stored?.overrideApprovedBy).toBe('dev-billing');
      expect(stored?.lockVersion).toBe(read.lockVersion + 1);
    });
  });

  describe('DrizzleQuoteApprovalRepository', () => {
    beforeEach(async () => {
      await db.truncate(['quoting.quote_approvals', 'quoting.quote_lines', 'quoting.quotes']);
    });

    quoteApprovalRepositoryContract(async () => {
      const qdb = createQuotingDb(db.pool);
      return {
        approvals: new DrizzleQuoteApprovalRepository(qdb),
        quotes: new DrizzleQuoteRepository(qdb),
        newQuoteRow,
      };
    });
  });
});
