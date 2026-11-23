// Tests the quoting schema against PostgreSQL: the hand-written CHECK constraints, column scales,
// unique indexes and seeded rows in infra/db/migrations/quoting/0000_baseline.sql.
// It runs only under `pnpm test:db` and is skipped when no test database is configured.
import { resolve } from 'node:path';

import { moduleTestDatabase, newId } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DrizzleGradeRepository } from '../src/adapters/drizzle/drizzle-grade-repository';
import { DrizzlePricingConfigRepository } from '../src/adapters/drizzle/drizzle-pricing-config-repository';
import { DrizzlePricingTierRepository } from '../src/adapters/drizzle/drizzle-pricing-tier-repository';
import { DEFAULT_PALLET_FITS } from '../src/adapters/in-memory/in-memory-pallet-fit-repository';
import { DEFAULT_PRICING_CONFIG } from '../src/adapters/in-memory/in-memory-pricing-config-repository';
import { DEFAULT_PRICING_TIERS } from '../src/adapters/in-memory/in-memory-pricing-tier-repository';
import { createQuotingDb, type QuotingDb } from '../src/data/quoting-db';
import { NOW, newGradeInput } from './fixtures';

const db = moduleTestDatabase({
  moduleName: 'quoting',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/quoting'),
  isolationKey: 'db',
});

const describeDb = db.enabled ? describe : describe.skip;

let quoting: QuotingDb;

describeDb('quoting database', () => {
  beforeAll(async () => {
    await db.setup();
    quoting = createQuotingDb(db.pool);
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.truncate(['quoting.grades']);
  });

  describe('freight on a quote line', () => {
    let gradeSeq = 0;

    const insertLine = async (freight: {
      mode: string;
      carrierBid?: string;
      cost: string;
      margin: string;
      invoiceTotal: string;
      pending: boolean;
    }): Promise<string> => {
      gradeSeq += 1;
      const grade = await new DrizzleGradeRepository(quoting).create(
        newGradeInput({ id: newId(), code: `35#-${gradeSeq}` }),
      );
      const { rows } = await db.pool.query<{ id: string }>(
        `with fresh as (select gen_random_uuid() as id),
         q as (
           insert into quoting.quotes (id, customer_id, status, root_quote_id, version_number)
           select id, gen_random_uuid(), 'draft', id, 1 from fresh
           returning id
         )
         insert into quoting.quote_lines (
           id, quote_id, grade_id, line_number, footage_variant, roll_width_in,
           quantity_rolls, overwrap,
           revenue_category, tax_status, printed,
           freight_mode, freight_carrier_bid, freight_cost, freight_margin,
           freight_invoice_total, freight_pending,
           roll_weight_lb, paper_cost_per_lb, paper_cost_per_roll,
           hardware_cost_per_roll, add_on_cost_per_roll, total_cost_per_roll,
           rolls_per_pallet, feet_per_roll,
           tier_id, tier_code, tier_name, tier_margin_pct, tier_source,
           pallets, price_source, base_price_per_roll, price_per_roll,
           delivered_price_per_roll, margin_pct, floor_status,
           extended_price, extended_cost, extended_margin,
           estimated_weight_lb, price_per_lb, effective_price_per_lb
         )
         select
           gen_random_uuid(), q.id, $1, 1, 'short', 24,
           1150, false,
           'print', 'non_tax', false,
           $2, $3, $4, $5,
           $6, $7,
           '18.7250', '0.46266422', '8.6634',
           '1.8865', '0.0000', '10.5499',
           50, '1000.0000',
           gen_random_uuid(), 'volume_4', 'Volume 4', '0.210000', 'auto',
           23, 'tier', '13.3543', '13.3543',
           '13.3543', '0.210000', 'ok',
           '15357.4450', '12132.3850', '3225.0600',
           '21533.7500', '0.7132', '0.7132'
         from q
         returning id`,
        [
          grade.id,
          freight.mode,
          freight.carrierBid ?? null,
          freight.cost,
          freight.margin,
          freight.invoiceTotal,
          freight.pending,
        ],
      );
      return rows[0]!.id;
    };

    const PARTIAL = {
      mode: 'pass_through',
      cost: '19.2500',
      margin: '0.0000',
      invoiceTotal: '19.2500',
      pending: true,
    } as const;

    it('accepts a pending pass_through line with no bid, carrying its flat leg', async () => {
      const id = await insertLine(PARTIAL);
      const { rows } = await db.pool.query(
        `select freight_carrier_bid, freight_cost, freight_invoice_total, freight_pending
           from quoting.quote_lines where id = $1`,
        [id],
      );

      expect(rows[0]).toMatchObject({
        freight_carrier_bid: null,
        freight_cost: '19.2500',
        freight_invoice_total: '19.2500',
        freight_pending: true,
      });
    });

    it('refuses a carrier bid on a line whose freight is pending', async () => {
      const passThrough = await insertLine(PARTIAL);
      await expect(
        db.pool.query('update quoting.quote_lines set freight_carrier_bid = 67 where id = $1', [
          passThrough,
        ]),
      ).rejects.toMatchObject({ code: '23514' });

      const carrier = await insertLine({
        mode: 'carrier',
        cost: '0.0000',
        margin: '0.0000',
        invoiceTotal: '0.0000',
        pending: true,
      });
      await expect(
        db.pool.query('update quoting.quote_lines set freight_carrier_bid = 395 where id = $1', [
          carrier,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a freight margin on a pending pass_through line', async () => {
      const id = await insertLine(PARTIAL);
      await expect(
        db.pool.query(
          `update quoting.quote_lines
             set freight_margin = 5, freight_invoice_total = 30 where id = $1`,
          [id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('holds a pending carrier line to zero cost, margin and total', async () => {
      const id = await insertLine({
        mode: 'carrier',
        cost: '0.0000',
        margin: '0.0000',
        invoiceTotal: '0.0000',
        pending: true,
      });
      await expect(
        db.pool.query(
          `update quoting.quote_lines
             set freight_cost = 25, freight_invoice_total = 25 where id = $1`,
          [id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a carrier bid on a mode with no third party', async () => {
      await expect(
        insertLine({
          mode: 'pickup',
          carrierBid: '67.0000',
          cost: '0.0000',
          margin: '0.0000',
          invoiceTotal: '0.0000',
          pending: false,
        }),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('pricing config', () => {
    it('seeds exactly one row with the default constants', async () => {
      const { rows } = await db.pool.query('select count(*)::int as n from quoting.pricing_config');
      expect(rows[0]?.n).toBe(1);
      const config = await new DrizzlePricingConfigRepository(quoting).get();
      expect(config).toMatchObject({ ...DEFAULT_PRICING_CONFIG, updatedBy: null });
    });

    const fullConfigRow = (id: string, isSingleton: boolean) =>
      `insert into quoting.pricing_config
         (id, is_singleton, pounds_per_tonne, waste_pct,
          core_cost_per_core, core_reference_length_in, plug_cost_per_plug,
          plugs_per_roll, pallet_cost, margin_floor_pct, overwrap_surcharge_pct,
          our_vehicle_freight_rate)
       values ('${id}', ${isSingleton}, 2204.62262185, 0.02,
               2.00, 48, 0.05000000, 2, 10, 0.12, 0.04,
               30)`;

    it('refuses a second config row', async () => {
      await expect(
        db.pool.query(fullConfigRow('01988a00-0000-7000-8000-0000000000ff', true)),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('refuses a row that opts out of the singleton flag', async () => {
      await expect(
        db.pool.query(fullConfigRow('01988a00-0000-7000-8000-0000000000fe', false)),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('patches one constant without disturbing the others', async () => {
      const repo = new DrizzlePricingConfigRepository(quoting);
      const updated = await repo.update({ wastePct: '0.049000' }, NOW);
      expect(updated.wastePct).toBe('0.049000');
      expect(updated.poundsPerTonne).toBe('2204.62262185');
      await repo.update({ wastePct: DEFAULT_PRICING_CONFIG.wastePct }, NOW);
    });
  });

  describe('column scales', () => {
    it('stores measurements without overflowing', async () => {
      const repo = new DrizzleGradeRepository(quoting);
      const grade = await repo.create(
        newGradeInput({
          id: '01988a00-0000-7000-8000-000000000101',
          basisWeightLb: '35.4000',
          footages: [{ variant: 'short', label: 'Short roll', feetPerRoll: '1180.0000' }],
        }),
      );
      expect(grade.footages[0]?.feetPerRoll).toBe('1180.0000');
      expect(grade.basisWeightLb).toBe('35.4000');
      const config = await new DrizzlePricingConfigRepository(quoting).get();
      expect(config.poundsPerTonne).toBe('2204.62262185');
    });
  });

  describe('grade aggregate integrity', () => {
    it('leaves no orphaned grade when the footage insert fails', async () => {
      const repo = new DrizzleGradeRepository(quoting);
      await expect(
        repo.create(
          newGradeInput({
            id: '01988a00-0000-7000-8000-000000000401',
            footages: [
              { variant: 'long', label: 'Long roll', feetPerRoll: '1500.0000' },
              { variant: 'long', label: 'Duplicate', feetPerRoll: '1100.0000' },
            ],
          }),
        ),
      ).rejects.toBeTruthy();
      const { rows } = await db.pool.query('select count(*)::int as n from quoting.grades');
      expect(rows[0]?.n).toBe(0);
    });

    it('cascades footage rows when the grade is deleted', async () => {
      const repo = new DrizzleGradeRepository(quoting);
      const created = await repo.create(
        newGradeInput({ id: '01988a00-0000-7000-8000-000000000601' }),
      );
      await db.pool.query('delete from quoting.grades where id = $1', [created.id]);
      const { rows } = await db.pool.query('select count(*)::int as n from quoting.grade_footages');
      expect(rows[0]?.n).toBe(0);
    });
  });

  describe('pricing tiers', () => {
    it('seeds the seven default tiers the in-memory store starts with', async () => {
      const tiers = await new DrizzlePricingTierRepository(quoting).list();
      expect(
        tiers.map(({ id, code, name, marginPct, minPallets, isListTier, updatedBy }) => ({
          id,
          code,
          name,
          marginPct,
          minPallets,
          isListTier,
          updatedBy,
        })),
      ).toEqual(DEFAULT_PRICING_TIERS);
    });

    it('allows only one published list tier', async () => {
      await expect(
        db.pool.query(
          "update quoting.pricing_tiers set is_list_tier = true where code = 'volume_3'",
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('refuses a margin of 1 or more, which would break 1/(1 - margin)', async () => {
      await expect(
        db.pool.query("update quoting.pricing_tiers set margin_pct = 1 where code = 'volume_3'"),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.pool.query("update quoting.pricing_tiers set margin_pct = -0.8 where code = 'volume_3'"),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a negative threshold', async () => {
      await expect(
        db.pool.query("update quoting.pricing_tiers set min_pallets = -1 where code = 'volume_3'"),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('pricing config bounds', () => {
    it('stores the plug cost at eight places, not at cents', async () => {
      await db.pool.query(
        'update quoting.pricing_config set plug_cost_per_plug = 0.05000000 where is_singleton = true',
      );
      const { rows } = await db.pool.query('select plug_cost_per_plug from quoting.pricing_config');
      expect(rows[0]?.plug_cost_per_plug).toBe('0.05000000');
    });

    it('refuses a zero core reference length, which would break $/inch', async () => {
      await expect(
        db.pool.query('update quoting.pricing_config set core_reference_length_in = 0'),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a waste of 1 or more, which would break the gross-up', async () => {
      await expect(
        db.pool.query('update quoting.pricing_config set waste_pct = 1'),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses negative hardware costs', async () => {
      await expect(
        db.pool.query('update quoting.pricing_config set pallet_cost = -1'),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a floor of 1 or more, which no price could satisfy', async () => {
      await expect(
        db.pool.query('update quoting.pricing_config set margin_floor_pct = 1'),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.pool.query('update quoting.pricing_config set margin_floor_pct = -0.7'),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a negative overwrap surcharge', async () => {
      await expect(
        db.pool.query('update quoting.pricing_config set overwrap_surcharge_pct = -0.09'),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('pallet fits', () => {
    it('seeds the same fits the in-memory store starts with', async () => {
      const { rows } = await db.pool.query<{
        product_family: string;
        roll_width_in: string;
        rolls_per_pallet: number;
      }>('select product_family, roll_width_in, rolls_per_pallet from quoting.pallet_fits');
      const key = (family: string, width: number) => `${family}:${width}`;
      expect(
        new Map(
          rows.map((r) => [key(r.product_family, Number(r.roll_width_in)), r.rolls_per_pallet]),
        ),
      ).toEqual(
        new Map(
          DEFAULT_PALLET_FITS.map((f) => [key(f.productFamily, f.rollWidthIn), f.rollsPerPallet]),
        ),
      );
    });

    it('seeds all four families, not one global table', async () => {
      const { rows } = await db.pool.query(
        `select product_family, count(*)::int as n
         from quoting.pallet_fits group by product_family order by product_family`,
      );

      expect(rows).toEqual([
        { product_family: 'butcher', n: 10 },
        { product_family: 'digital_bond', n: 7 },
        { product_family: 'kraft', n: 10 },
        { product_family: 'newsprint', n: 10 },
      ]);
    });

    it("seeds Kraft's widths", async () => {
      const { rows } = await db.pool.query(
        `select roll_width_in, rolls_per_pallet from quoting.pallet_fits
         where product_family = 'kraft' order by roll_width_in`,
      );

      expect(rows.map((r) => Number(r.roll_width_in))).toEqual([
        8, 10, 12, 16, 18, 24, 28, 36, 42, 54,
      ]);
      expect(rows.map((r) => r.rolls_per_pallet)).toEqual([
        108, 86, 72, 54, 48, 36, 30, 24, 20, 16,
      ]);
    });

    it('seeds Butcher differently from Kraft at the same width', async () => {
      const { rows } = await db.pool.query(
        `select product_family, rolls_per_pallet from quoting.pallet_fits
         where roll_width_in = 12 and product_family in ('kraft', 'butcher')
         order by product_family`,
      );

      expect(rows).toEqual([
        { product_family: 'butcher', rolls_per_pallet: 64 },
        { product_family: 'kraft', rolls_per_pallet: 72 },
      ]);
    });

    it('gives Butcher and Newsprint widths that Kraft lacks', async () => {
      const { rows } = await db.pool.query(
        `select product_family, roll_width_in from quoting.pallet_fits
         where roll_width_in in (26, 34, 66) order by roll_width_in`,
      );

      expect(rows).toEqual([
        { product_family: 'butcher', roll_width_in: '26.0000' },
        { product_family: 'newsprint', roll_width_in: '34.0000' },
        { product_family: 'butcher', roll_width_in: '66.0000' },
      ]);
    });

    it('refuses a duplicate width within a family', async () => {
      await expect(
        db.pool.query(
          `update quoting.pallet_fits set roll_width_in = 24
           where roll_width_in = 28 and product_family = 'kraft'`,
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('allows the same width in different families', async () => {
      const { rows } = await db.pool.query(
        'select count(*)::int as n from quoting.pallet_fits where roll_width_in = 24',
      );
      expect(rows[0]?.n).toBe(4);
    });

    it('refuses an unknown product family', async () => {
      await expect(
        db.pool.query(
          `update quoting.pallet_fits set product_family = 'cardboard' where roll_width_in = 54`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a zero or negative pallet fit, which would divide by zero', async () => {
      await expect(
        db.pool.query(
          `update quoting.pallet_fits set rolls_per_pallet = 0
           where roll_width_in = 24 and product_family = 'kraft'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.pool.query(
          `update quoting.pallet_fits set roll_width_in = 0
           where roll_width_in = 24 and product_family = 'kraft'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('delivery address on a quote line', () => {
    let gradeSeq = 0;

    const insertLine = async (address: {
      name?: string | null;
      line1?: string | null;
      line2?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
    }): Promise<string> => {
      gradeSeq += 1;
      const grade = await new DrizzleGradeRepository(quoting).create(
        newGradeInput({ id: newId(), code: `addr-${gradeSeq}` }),
      );
      const { rows } = await db.pool.query<{ id: string }>(
        `with fresh as (select gen_random_uuid() as id),
         q as (
           insert into quoting.quotes (id, customer_id, status, root_quote_id, version_number)
           select id, gen_random_uuid(), 'draft', id, 1 from fresh
           returning id
         )
         insert into quoting.quote_lines (
           id, quote_id, grade_id, line_number, footage_variant, roll_width_in,
           quantity_rolls, overwrap,
           revenue_category, tax_status, printed,
           delivery_name, delivery_line1, delivery_line2,
           delivery_city, delivery_state, delivery_postal_code,
           freight_mode, freight_cost, freight_margin,
           freight_invoice_total, freight_pending,
           roll_weight_lb, paper_cost_per_lb, paper_cost_per_roll,
           hardware_cost_per_roll, add_on_cost_per_roll, total_cost_per_roll,
           rolls_per_pallet, feet_per_roll,
           tier_id, tier_code, tier_name, tier_margin_pct, tier_source,
           pallets, price_source, base_price_per_roll, price_per_roll,
           delivered_price_per_roll, margin_pct, floor_status,
           extended_price, extended_cost, extended_margin,
           estimated_weight_lb, price_per_lb, effective_price_per_lb
         )
         select
           gen_random_uuid(), q.id, $1, 1, 'short', 24,
           1150, false,
           'print', 'non_tax', false,
           $2, $3, $4,
           $5, $6, $7,
           'pickup', '0.0000', '0.0000',
           '0.0000', false,
           '18.7250', '0.46266422', '8.6634',
           '1.8865', '0.0000', '10.5499',
           50, '1000.0000',
           gen_random_uuid(), 'volume_4', 'Volume 4', '0.210000', 'auto',
           23, 'tier', '13.3543', '13.3543',
           '13.3543', '0.210000', 'ok',
           '15357.4450', '12132.3850', '3225.0600',
           '21533.7500', '0.7132', '0.7132'
         from q
         returning id`,
        [
          grade.id,
          address.name ?? null,
          address.line1 ?? null,
          address.line2 ?? null,
          address.city ?? null,
          address.state ?? null,
          address.postalCode ?? null,
        ],
      );
      return rows[0]!.id;
    };

    const FULL = {
      name: 'Harbor Receiving',
      line1: '200 Example Way',
      line2: 'Dock 3',
      city: 'Sample Harbor',
      state: 'WA',
      postalCode: '98000-4170',
    };

    it('accepts a line with no address at all', async () => {
      const id = await insertLine({});
      const { rows } = await db.pool.query(
        `select delivery_line1, delivery_city from quoting.quote_lines where id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({ delivery_line1: null, delivery_city: null });
    });

    it('accepts a full address, optional parts and all', async () => {
      const id = await insertLine(FULL);
      const { rows } = await db.pool.query(
        `select delivery_name, delivery_line1, delivery_line2,
                delivery_city, delivery_state, delivery_postal_code
           from quoting.quote_lines where id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        delivery_name: 'Harbor Receiving',
        delivery_line1: '200 Example Way',
        delivery_line2: 'Dock 3',
        delivery_city: 'Sample Harbor',
        delivery_state: 'WA',
        delivery_postal_code: '98000-4170',
      });
    });

    it('refuses a partial address, which is the state worth forbidding', async () => {
      for (const missing of ['line1', 'city', 'state', 'postalCode'] as const) {
        const partial: Record<string, string | null> = { ...FULL };
        partial[missing] = null;
        await expect(insertLine(partial), `missing ${missing}`).rejects.toMatchObject({
          code: '23514',
        });
      }
    });

    it('refuses a suite number attached to no street', async () => {
      await expect(insertLine({ line2: 'Dock 3' })).rejects.toMatchObject({ code: '23514' });
      await expect(insertLine({ name: 'Harbor Receiving' })).rejects.toMatchObject({
        code: '23514',
      });
    });

    it('refuses a state that is not a two-letter code', async () => {
      await expect(insertLine({ ...FULL, state: 'Wash.' })).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertLine({ ...FULL, state: 'wa' })).rejects.toMatchObject({ code: '23514' });
    });

    it('accepts a state outside WA and ID', async () => {
      const id = await insertLine({ ...FULL, state: 'OR' });
      const { rows } = await db.pool.query(
        `select delivery_state from quoting.quote_lines where id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({ delivery_state: 'OR' });
    });

    it('accepts ZIP and ZIP+4 but refuses malformed codes', async () => {
      await insertLine({ ...FULL, postalCode: '98000' });
      await insertLine({ ...FULL, postalCode: '98000-4170' });

      await expect(insertLine({ ...FULL, postalCode: '9800' })).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertLine({ ...FULL, postalCode: '980004170' })).rejects.toMatchObject({
        code: '23514',
      });
    });
  });

  describe('pricing basis and price source on a quote line', () => {
    let gradeSeq = 0;

    const insertLine = async (pair: {
      basis?: string;
      productPricePerLb?: string | null;

      basePricePerLb?: string | null;

      orderedWeightLb?: string | null;
    }): Promise<string> => {
      gradeSeq += 1;
      const ordered =
        pair.orderedWeightLb !== undefined
          ? pair.orderedWeightLb
          : pair.basis === 'per_pound'
            ? '21533.7500'
            : null;
      const grade = await new DrizzleGradeRepository(quoting).create(
        newGradeInput({ id: newId(), code: `basis-${gradeSeq}` }),
      );
      const statesBasis = pair.basis !== undefined;
      const { rows } = await db.pool.query<{ id: string }>(
        `with fresh as (select gen_random_uuid() as id),
         q as (
           insert into quoting.quotes (id, customer_id, status, root_quote_id, version_number)
           select id, gen_random_uuid(), 'draft', id, 1 from fresh
           returning id
         )
         insert into quoting.quote_lines (
           id, quote_id, grade_id, line_number, footage_variant, roll_width_in,
           quantity_rolls, overwrap,
           revenue_category, tax_status, printed,
           freight_mode, freight_cost, freight_margin,
           freight_invoice_total, freight_pending,
           roll_weight_lb, paper_cost_per_lb, paper_cost_per_roll,
           hardware_cost_per_roll, add_on_cost_per_roll, total_cost_per_roll,
           rolls_per_pallet, feet_per_roll,
           tier_id, tier_code, tier_name, tier_margin_pct, tier_source,
           pallets, price_source, base_price_per_roll, price_per_roll,
           delivered_price_per_roll, margin_pct, floor_status,
           extended_price, extended_cost, extended_margin,
           estimated_weight_lb, price_per_lb, effective_price_per_lb,
           product_price_per_lb, base_price_per_lb, ordered_weight_lb${
             statesBasis ? ', pricing_basis' : ''
           }
         )
         select
           gen_random_uuid(), q.id, $1, 1, 'short', 24,
           1150, false,
           'print', 'non_tax', false,
           'pickup', '0.0000', '0.0000',
           '0.0000', false,
           '18.7250', '0.46266422', '8.6634',
           '1.8865', '0.0000', '10.5499',
           50, '1000.0000',
           gen_random_uuid(), 'volume_4', 'Volume 4', '0.210000', 'auto',
           23, 'tier', '13.3543', '13.3543',
           '13.3543', '0.210000', 'ok',
           '15357.4450', '12132.3850', '3225.0600',
           '21533.7500', '0.7132', '0.7132',
           $2, $3, $4${statesBasis ? ', $5' : ''}
         from q
         returning id`,
        statesBasis
          ? [
              grade.id,
              pair.productPricePerLb ?? null,
              pair.basePricePerLb ?? null,
              ordered,
              pair.basis,
            ]
          : [grade.id, pair.productPricePerLb ?? null, pair.basePricePerLb ?? null, ordered],
      );
      return rows[0]?.id ?? '';
    };

    it('defaults a line that does not state a basis to per_roll', async () => {
      const id = await insertLine({});
      const { rows } = await db.pool.query(
        `select pricing_basis, product_price_per_lb from quoting.quote_lines where id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({ pricing_basis: 'per_roll', product_price_per_lb: null });
    });

    it('keeps the column default in place', async () => {
      const { rows } = await db.pool.query(
        `select column_default from information_schema.columns
         where table_schema = 'quoting' and table_name = 'quote_lines'
           and column_name = 'pricing_basis'`,
      );
      expect(rows[0]?.column_default).toContain('per_roll');
    });

    it('accepts the two bases and refuses anything else', async () => {
      await insertLine({ basis: 'per_roll' });
      await insertLine({
        basis: 'per_pound',
        productPricePerLb: '0.5873',
        basePricePerLb: '0.5873',
      });

      await expect(insertLine({ basis: 'per_ton' })).rejects.toMatchObject({ code: '23514' });
      await expect(insertLine({ basis: 'PER_POUND' })).rejects.toMatchObject({ code: '23514' });
    });

    it('ties the price per pound to the basis in both directions', async () => {
      await expect(
        insertLine({ basis: 'per_roll', productPricePerLb: '0.5873' }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        insertLine({ basis: 'per_pound', basePricePerLb: '0.5873' }),
      ).rejects.toMatchObject({ code: '23514' });
    });

    const perPoundPrices = { productPricePerLb: '0.5873', basePricePerLb: '0.5873' };

    it('ties the pounds ordered to the basis in both directions', async () => {
      await expect(
        insertLine({ basis: 'per_pound', ...perPoundPrices, orderedWeightLb: null }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'quote_lines_ordered_weight_check' });
      await expect(
        insertLine({ basis: 'per_roll', orderedWeightLb: '1000.0000' }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'quote_lines_ordered_weight_check' });

      const id = await insertLine({
        basis: 'per_pound',
        ...perPoundPrices,
        orderedWeightLb: '1000.0000',
      });
      const { rows } = await db.pool.query(
        `select ordered_weight_lb from quoting.quote_lines where id = $1`,
        [id],
      );
      expect(rows[0]?.ordered_weight_lb).toBe('1000.0000');
    });

    it('refuses pounds ordered of zero or less', async () => {
      for (const orderedWeightLb of ['0.0000', '-6.3500']) {
        await expect(
          insertLine({ basis: 'per_pound', ...perPoundPrices, orderedWeightLb }),
        ).rejects.toMatchObject({ code: '23514', constraint: 'quote_lines_ordered_weight_check' });
      }
    });

    it("bounds and trims the customer's part number and description, each optional", async () => {
      const id = await insertLine({ basis: 'per_roll' });
      const refuse = async (column: string, value: string) =>
        expect(
          db.pool.query(`UPDATE quoting.quote_lines SET ${column} = $2 WHERE id = $1`, [id, value]),
        ).rejects.toMatchObject({ code: '23514', constraint: `quote_lines_${column}_check` });

      await refuse('customer_part_number', 'X'.repeat(41));
      await refuse('customer_part_number', '');
      await refuse('customer_part_number', ' LN-870');
      await refuse('customer_description', 'X'.repeat(121));
      await refuse('customer_description', 'CEDAR CORE SHEET ');

      await db.pool.query(
        `UPDATE quoting.quote_lines
            SET customer_part_number = $2, customer_description = $3
          WHERE id = $1`,
        [id, 'X'.repeat(40), 'X'.repeat(120)],
      );
      const { rows } = await db.pool.query(
        `SELECT customer_part_number FROM quoting.quote_lines WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.customer_part_number).toBe('X'.repeat(40));
    });

    const setPricing = (
      id: string,
      values: {
        source: string;
        margin?: string | null;
        marginPrice?: string | null;
        overrideRoll?: string | null;
        overrideLb?: string | null;
        tierOverride?: string | null;
      },
    ) =>
      db.pool.query(
        `UPDATE quoting.quote_lines
            SET price_source = $2, margin_override_pct = $3, margin_price_per_roll = $4,
                override_price_per_roll = $5, tier_override_code = $6, override_price_per_lb = $7
          WHERE id = $1`,
        [
          id,
          values.source,
          values.margin ?? null,
          values.marginPrice ?? null,
          values.overrideRoll ?? null,
          values.tierOverride ?? null,
          values.overrideLb ?? null,
        ],
      );

    it('takes the tier, manual and margin price sources, and nothing unknown', async () => {
      const id = await insertLine({ basis: 'per_roll' });

      await setPricing(id, { source: 'tier' });
      await setPricing(id, { source: 'manual', overrideRoll: '12.8500' });
      await setPricing(id, { source: 'margin', margin: '0.437000', marginPrice: '18.7387' });
      const { rows } = await db.pool.query(
        `SELECT price_source, margin_override_pct, margin_price_per_roll
           FROM quoting.quote_lines WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({
        price_source: 'margin',
        margin_override_pct: '0.437000',
        margin_price_per_roll: '18.7387',
      });

      await expect(setPricing(id, { source: 'typed' })).rejects.toMatchObject({ code: '23514' });
      const { rows: checks } = await db.pool.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'quote_lines_price_source_check'`,
      );
      expect(checks[0]?.def).toContain("'margin'");
    });

    it('takes agreed with a hand-set price, and refuses it without one', async () => {
      const id = await insertLine({ basis: 'per_roll' });
      const agrees = { code: '23514', constraint: 'quote_lines_override_price_agrees_check' };

      await setPricing(id, { source: 'agreed', overrideRoll: '12.8500' });
      const { rows } = await db.pool.query(
        `SELECT price_source, override_price_per_roll FROM quoting.quote_lines WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ price_source: 'agreed', override_price_per_roll: '12.8500' });

      await expect(setPricing(id, { source: 'agreed' })).rejects.toMatchObject(agrees);
      await expect(
        setPricing(id, {
          source: 'agreed',
          overrideRoll: '12.8500',
          margin: '0.437000',
          marginPrice: '18.7387',
        }),
      ).rejects.toMatchObject({ code: '23514' });
      const { rows: checks } = await db.pool.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'quote_lines_price_source_check'`,
      );
      expect(checks[0]?.def).toContain("'agreed'");
    });

    it('ties the margin and its price to a margin line, both ways', async () => {
      const id = await insertLine({ basis: 'per_roll' });
      const agrees = { code: '23514', constraint: 'quote_lines_margin_override_agrees_check' };

      await expect(setPricing(id, { source: 'margin' })).rejects.toMatchObject(agrees);
      await expect(setPricing(id, { source: 'margin', margin: '0.437000' })).rejects.toMatchObject(
        agrees,
      );
      await expect(
        setPricing(id, { source: 'tier', margin: '0.437000', marginPrice: '18.7387' }),
      ).rejects.toMatchObject(agrees);
      await expect(
        setPricing(id, { source: 'tier', marginPrice: '18.7387' }),
      ).rejects.toMatchObject(agrees);
    });

    it('keeps a hand-set price off a margin line', async () => {
      const id = await insertLine({ basis: 'per_roll' });

      await expect(
        setPricing(id, {
          source: 'margin',
          margin: '0.437000',
          marginPrice: '18.7387',
          overrideRoll: '12.8500',
        }),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_lines_override_price_agrees_check',
      });
    });

    it('bounds the margin to more than 0 and at most 95%', async () => {
      const id = await insertLine({ basis: 'per_roll' });
      const bounds = { code: '23514', constraint: 'quote_lines_margin_override_bounds_check' };

      await setPricing(id, { source: 'margin', margin: '0.950000', marginPrice: '210.9980' });
      for (const margin of ['0.000000', '-0.230000', '0.950001', '1.000000']) {
        await expect(
          setPricing(id, { source: 'margin', margin, marginPrice: '18.7387' }),
        ).rejects.toMatchObject(bounds);
      }
    });

    it('keeps a forced tier off a margin line', async () => {
      const id = await insertLine({ basis: 'per_roll' });

      await expect(
        setPricing(id, {
          source: 'margin',
          margin: '0.437000',
          marginPrice: '18.7387',
          tierOverride: 'volume_5',
        }),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_lines_margin_override_tier_check',
      });
    });

    const perPoundLine = () =>
      insertLine({ basis: 'per_pound', productPricePerLb: '0.6850', basePricePerLb: '0.5873' });

    it('ties a hand-set price to the basis it is written in, both ways', async () => {
      const perRoll = await insertLine({ basis: 'per_roll' });
      const perPound = await perPoundLine();

      await expect(
        setPricing(perRoll, { source: 'manual', overrideLb: '0.6850' }),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_lines_hand_set_pound_price_check',
      });
      await expect(
        setPricing(perPound, { source: 'manual', overrideRoll: '12.5000' }),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_lines_hand_set_roll_price_check',
      });

      await setPricing(perPound, { source: 'manual', overrideLb: '0.6850' });
      await setPricing(perRoll, { source: 'manual', overrideRoll: '12.5000' });
      const { rows } = await db.pool.query(
        `SELECT id, override_price_per_roll, override_price_per_lb
           FROM quoting.quote_lines WHERE id = ANY($1)`,
        [[perRoll, perPound]],
      );
      expect(Object.fromEntries(rows.map((row) => [row.id, row]))).toEqual({
        [perRoll]: { id: perRoll, override_price_per_roll: '12.5000', override_price_per_lb: null },
        [perPound]: {
          id: perPound,
          override_price_per_roll: null,
          override_price_per_lb: '0.6850',
        },
      });
    });

    it('refuses a manual line with no typed price, and a tier line with one', async () => {
      const agrees = { code: '23514', constraint: 'quote_lines_override_price_agrees_check' };
      const perRoll = await insertLine({ basis: 'per_roll' });
      const perPound = await perPoundLine();

      await expect(setPricing(perRoll, { source: 'manual' })).rejects.toMatchObject(agrees);
      await expect(
        setPricing(perPound, { source: 'tier', overrideLb: '0.6850' }),
      ).rejects.toMatchObject(agrees);
    });

    it('refuses a negative hand-set price per pound', async () => {
      const id = await perPoundLine();
      await expect(
        setPricing(id, { source: 'manual', overrideLb: '-0.6850' }),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_lines_override_price_per_lb_nonneg_check',
      });
    });

    it('ties the base price per pound to the basis in both directions', async () => {
      const base = { code: '23514', constraint: 'quote_lines_base_price_per_lb_check' };
      await expect(
        insertLine({ basis: 'per_pound', productPricePerLb: '0.6850', basePricePerLb: null }),
      ).rejects.toMatchObject(base);
      await expect(
        insertLine({ basis: 'per_roll', basePricePerLb: '0.5873' }),
      ).rejects.toMatchObject(base);
    });

    it('ties the pallet count to the rolls per pallet it came from', async () => {
      const id = await insertLine({ basis: 'per_roll' });
      const set = (assignments: string) =>
        db.pool.query(`UPDATE quoting.quote_lines SET ${assignments} WHERE id = $1`, [id]);

      await expect(set('pallets = NULL')).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_lines_pallets_counted_check',
      });
      await expect(set('rolls_per_pallet = NULL')).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_lines_pallets_counted_check',
      });

      await set('pallets = NULL, rolls_per_pallet = NULL');
      const { rows } = await db.pool.query(
        `SELECT pallets, rolls_per_pallet FROM quoting.quote_lines WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ pallets: null, rolls_per_pallet: null });

      await expect(set('custom_width = true')).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_lines_custom_width_counted_check',
      });

      await expect(set('pallets = 1, rolls_per_pallet = 0')).rejects.toMatchObject({
        code: '23514',
      });
    });

    it('keeps a line width in sixteenths, and a custom width whole', async () => {
      const id = await insertLine({ basis: 'per_roll' });
      const set = (assignments: string) =>
        db.pool.query(`UPDATE quoting.quote_lines SET ${assignments} WHERE id = $1`, [id]);

      await set('roll_width_in = 11.3125');
      await expect(set('roll_width_in = 13.7')).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_lines_roll_width_sixteenths_check',
      });
      await expect(set('custom_width = true')).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_lines_custom_width_whole_check',
      });
      await set('roll_width_in = 23, custom_width = true');
      const { rows } = await db.pool.query(
        `SELECT roll_width_in FROM quoting.quote_lines WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.roll_width_in).toBe('23.0000');
    });
  });

  describe('grade widths', () => {
    it('accepts a width with no count, and bounds a count it is given', async () => {
      const grade = await new DrizzleGradeRepository(quoting).create(
        newGradeInput({ id: newId(), code: 'uncounted' }),
      );
      const insert = (width: number, rolls: number | null) =>
        db.pool.query(
          `INSERT INTO quoting.grade_widths (id, grade_id, roll_width_in, rolls_per_pallet)
           VALUES (gen_random_uuid(), $1, $2, $3)`,
          [grade.id, width, rolls],
        );

      await insert(214, null);
      await insert(227, 1);
      await insert(238, 10_000);
      for (const [width, rolls] of [
        [241, 0],
        [256, -5],
        [263, 10_001],
      ] as const) {
        await expect(insert(width, rolls)).rejects.toMatchObject({
          code: '23514',
          constraint: 'grade_widths_rolls_per_pallet_check',
        });
      }
      const { rows } = await db.pool.query(
        `SELECT roll_width_in, rolls_per_pallet FROM quoting.grade_widths
          WHERE grade_id = $1 AND roll_width_in > 100 ORDER BY roll_width_in`,
        [grade.id],
      );

      expect(rows).toEqual([
        { roll_width_in: '214.0000', rolls_per_pallet: null },
        { roll_width_in: '227.0000', rolls_per_pallet: 1 },
        { roll_width_in: '238.0000', rolls_per_pallet: 10_000 },
      ]);
    });
  });

  describe('roll widths in sixteenths', () => {
    it('stores a stock width in sixteenths, and refuses one that is not', async () => {
      const grade = await new DrizzleGradeRepository(quoting).create(
        newGradeInput({ id: newId(), code: 'wrap', productFamily: 'digital_bond', widths: [] }),
      );
      const insert = (width: string) =>
        db.pool.query(
          `INSERT INTO quoting.grade_widths (id, grade_id, roll_width_in, rolls_per_pallet)
           VALUES (gen_random_uuid(), $1, $2, NULL)`,
          [grade.id, width],
        );

      await insert('11.3125');
      await insert('9.75');
      await insert('4.625');
      for (const width of ['13.7', '6.3', '0.5']) {
        await expect(insert(width)).rejects.toMatchObject({ code: '23514' });
      }
      await expect(insert('13.7')).rejects.toMatchObject({
        constraint: 'grade_widths_roll_width_sixteenths_check',
      });

      const stored = await new DrizzleGradeRepository(quoting).findById(grade.id);
      expect(stored?.widths.map((w) => w.rollWidthIn)).toEqual([4.625, 9.75, 11.3125]);
    });

    it('refuses a pallet fit that is not a sixteenth', async () => {
      await expect(
        db.pool.query(
          `update quoting.pallet_fits set roll_width_in = 24.7
           where roll_width_in = 24 and product_family = 'kraft'`,
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'pallet_fits_roll_width_sixteenths_check',
      });
    });
  });

  describe('blank text', () => {
    it('refuses a blank on the config, tier and grade columns that must carry a value', async () => {
      const blank = { code: '23514' };
      await expect(
        db.pool.query(`update quoting.pricing_config set updated_by = '  '`),
      ).rejects.toMatchObject({ ...blank, constraint: 'pricing_config_updated_by_check' });
      await expect(
        db.pool.query(`update quoting.pricing_tiers set name = '' where code = 'volume_3'`),
      ).rejects.toMatchObject({ ...blank, constraint: 'pricing_tiers_name_check' });
      await expect(
        db.pool.query(`update quoting.pricing_tiers set code = ' ' where code = 'volume_3'`),
      ).rejects.toMatchObject({ ...blank, constraint: 'pricing_tiers_code_check' });

      const grade = await new DrizzleGradeRepository(quoting).create(
        newGradeInput({ id: newId(), code: 'blank-code' }),
      );
      await expect(
        db.pool.query(`update quoting.grades set code = '  ' where id = $1`, [grade.id]),
      ).rejects.toMatchObject({ ...blank, constraint: 'grades_code_check' });
    });

    it('lets a tier record a blank updated_by, which its contract permits', async () => {
      await db.pool.query(`update quoting.pricing_tiers set updated_by = '' where code = 'list'`);
      await db.pool.query(`update quoting.pricing_tiers set updated_by = null where code = 'list'`);
    });
  });

  describe('tax rates', () => {
    it('seeds the statute rate the application starts with', async () => {
      const { rows } = await db.pool.query(
        `select jurisdiction, rate, to_char(effective_from, 'YYYY-MM-DD') as effective_from, source
           from quoting.tax_rates`,
      );
      expect(rows).toEqual([
        { jurisdiction: 'ID', rate: '0.060000', effective_from: '2001-01-01', source: 'statute' },
      ]);
    });
  });

  describe('quote numbers', () => {
    const insertFresh = async (): Promise<number> => {
      const { rows } = await db.pool.query<{ quote_number: number }>(
        `insert into quoting.quotes (id, customer_id, status, root_quote_id, version_number)
         select id, gen_random_uuid(), 'draft', id, 1 from (select gen_random_uuid() as id) as fresh
         returning quote_number`,
      );
      return rows[0]?.quote_number ?? 0;
    };

    it('numbers quotes from a sequence that starts at 1', async () => {
      const { rows } = await db.pool.query(
        `select start_value::int as start from pg_sequences
          where schemaname = 'quoting' and sequencename = 'quote_number_seq'`,
      );
      expect(rows).toEqual([{ start: 1 }]);

      const first = await insertFresh();
      expect(await insertFresh()).toBe(first + 1);
    });

    it('lets versions share a number, and refuses a second row with the same number and version', async () => {
      const taken = await insertFresh();
      const insertAt = (version: number) =>
        db.pool.query(
          `insert into quoting.quotes (id, customer_id, status, root_quote_id, version_number, quote_number)
           select id, gen_random_uuid(), 'draft', id, $2, $1 from (select gen_random_uuid() as id) as other`,
          [taken, version],
        );

      await insertAt(2);
      await expect(insertAt(1)).rejects.toMatchObject({
        code: '23505',
        constraint: 'quotes_number_version_unique',
      });
    });
  });

  describe('floor override', () => {
    async function insertQuote(by: string | null, at: string | null): Promise<string> {
      const { rows } = await db.pool.query<{ id: string }>(
        `INSERT INTO quoting.quotes
           (id, customer_id, status, root_quote_id, version_number, floor_override_by, floor_override_at)
         SELECT id, gen_random_uuid(), 'draft', id, 1, $1, $2
           FROM (SELECT gen_random_uuid() AS id) AS fresh
         RETURNING id`,
        [by, at],
      );
      return rows[0]?.id ?? '';
    }

    it('holds the floor override pair together: both or neither', async () => {
      await insertQuote(null, null);
      await insertQuote('dev-admin', '2026-11-02T16:00:00Z');
      for (const [by, at] of [
        ['dev-admin', null],
        [null, '2026-11-02T16:00:00Z'],
      ] as const) {
        await expect(insertQuote(by, at)).rejects.toMatchObject({
          code: '23514',
          constraint: 'quotes_floor_override_pair_check',
        });
      }
    });

    it('takes the two kinds of decision, and nothing else', async () => {
      const quoteId = await insertQuote(null, null);
      const insert = (kind: string) =>
        db.pool.query(
          `INSERT INTO quoting.quote_override_decisions (id, quote_id, decision, kind, actor)
           VALUES (gen_random_uuid(), $1, 'requested', $2, 'dev-sales')`,
          [quoteId, kind],
        );

      await insert('price');
      await insert('floor');
      await expect(insert('margin')).rejects.toMatchObject({
        code: '23514',
        constraint: 'quote_override_decisions_kind_check',
      });
    });

    it('makes every decision name its kind, with no default to fall back on', async () => {
      const { rows } = await db.pool.query(
        `SELECT is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'quoting' AND table_name = 'quote_override_decisions'
            AND column_name = 'kind'`,
      );
      expect(rows).toEqual([{ is_nullable: 'NO', column_default: null }]);

      const quoteId = await insertQuote(null, null);
      await expect(
        db.pool.query(
          `INSERT INTO quoting.quote_override_decisions (id, quote_id, decision, actor)
           VALUES (gen_random_uuid(), $1, 'requested', 'dev-sales')`,
          [quoteId],
        ),
      ).rejects.toMatchObject({ code: '23502' });
    });
  });
});
