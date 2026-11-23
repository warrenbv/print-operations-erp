// The CHECK constraints on crm.customer_defaults and crm.customer_parts against the migrated schema.
// Skipped without a database.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = moduleTestDatabase({
  moduleName: 'crm',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/crm'),
  isolationKey: 'customer_defaults',
});

const describeDb = db.enabled ? describe : describe.skip;

const CUSTOMER = '00000000-0000-7000-8000-000000000583';

const GRADE = '00000000-0000-7000-8000-000000000584';

async function insertDefaults(columns: Record<string, unknown> = {}): Promise<void> {
  const row = {
    pricing_basis: null,
    tier_code: null,
    freight_mode: null,
    lead_time_days: null,
    lock_version: 1,
    updated_by: 'jsmith',
    ...columns,
  };
  await db.pool.query(
    `insert into crm.customer_defaults
       (customer_id, pricing_basis, tier_code, freight_mode, lead_time_days, lock_version,
        updated_by, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())`,
    [
      CUSTOMER,
      row.pricing_basis,
      row.tier_code,
      row.freight_mode,
      row.lead_time_days,
      row.lock_version,
      row.updated_by,
    ],
  );
}

let partSeq = 0;
async function insertPart(columns: Record<string, unknown> = {}): Promise<void> {
  partSeq += 1;
  const row = {
    position: 0,
    grade_id: GRADE,
    roll_width_in: 36,
    part_number: 'LN-34',
    description: null,
    feet_per_roll: null,
    ...columns,
  };
  await db.pool.query(
    `insert into crm.customer_parts
       (id, customer_id, position, grade_id, roll_width_in, part_number, description,
        feet_per_roll)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      `00000000-0000-7000-8000-${String(partSeq).padStart(12, '0')}`,
      CUSTOMER,
      row.position,
      row.grade_id,
      row.roll_width_in,
      row.part_number,
      row.description,
      row.feet_per_roll,
    ],
  );
}

describeDb('crm.customer_defaults and crm.customer_parts', () => {
  beforeAll(async () => {
    await db.setup();
    await db.pool.query(
      `insert into crm.customers (id, name, created_at, updated_at)
       values ($1, $2, now(), now())
       on conflict (id) do nothing`,
      [CUSTOMER, 'Defaults Co'],
    );
  });

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.pool.query('delete from crm.customer_defaults where customer_id = $1', [CUSTOMER]);
  });

  it('stores a row with every default absent, which is a real state', async () => {
    await insertDefaults();
    const { rows } = await db.pool.query(
      'select * from crm.customer_defaults where customer_id = $1',
      [CUSTOMER],
    );
    expect(rows).toHaveLength(1);
  });

  it('holds the pricing basis and the freight mode to their value sets', async () => {
    await expect(insertDefaults({ pricing_basis: 'per_ton' })).rejects.toMatchObject({
      constraint: 'customer_defaults_pricing_basis_check',
    });
    await expect(insertDefaults({ freight_mode: 'drone' })).rejects.toMatchObject({
      constraint: 'customer_defaults_freight_mode_check',
    });
    for (const mode of ['pickup', 'our_vehicle', 'pass_through', 'carrier']) {
      await insertDefaults({ freight_mode: mode, pricing_basis: 'per_pound' });
      await db.pool.query('delete from crm.customer_defaults where customer_id = $1', [CUSTOMER]);
    }
  });

  it('holds the tier code to the shape of a tier code, and to nothing else', async () => {
    await insertDefaults({ tier_code: 'list' });
    await db.pool.query('delete from crm.customer_defaults where customer_id = $1', [CUSTOMER]);

    await insertDefaults({ tier_code: 'no_such_tier' });
    await db.pool.query('delete from crm.customer_defaults where customer_id = $1', [CUSTOMER]);
    for (const code of ['', 'V2', 'v2 list', '2v', 'entered-margin', 'v'.repeat(33)]) {
      await expect(insertDefaults({ tier_code: code }), JSON.stringify(code)).rejects.toMatchObject(
        {
          constraint: 'customer_defaults_tier_code_check',
        },
      );
    }
  });

  it('takes a same-day lead time and refuses one outside the quote lead time bounds', async () => {
    await insertDefaults({ lead_time_days: 0 });
    await db.pool.query('delete from crm.customer_defaults where customer_id = $1', [CUSTOMER]);
    await expect(insertDefaults({ lead_time_days: -1 })).rejects.toMatchObject({
      constraint: 'customer_defaults_lead_time_days_range_check',
    });
    await expect(insertDefaults({ lead_time_days: 3651 })).rejects.toMatchObject({
      constraint: 'customer_defaults_lead_time_days_range_check',
    });
  });

  it('refuses a blank saver and a generation below 1', async () => {
    await expect(insertDefaults({ updated_by: '  ' })).rejects.toMatchObject({
      constraint: 'customer_defaults_updated_by_check',
    });
    await expect(insertDefaults({ lock_version: 0 })).rejects.toMatchObject({
      constraint: 'customer_defaults_lock_version_check',
    });
  });

  it('refuses defaults for a customer that does not exist', async () => {
    await expect(
      db.pool.query(
        `insert into crm.customer_defaults (customer_id, updated_by, updated_at)
         values ('00000000-0000-7000-8000-000000000999', 'jsmith', now())`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  describe('parts', () => {
    beforeEach(async () => {
      await insertDefaults();
    });

    it('takes a grade that exists nowhere: the grade is held by value, with no foreign key', async () => {
      await insertPart();
      const { rows } = await db.pool.query<{ grade_id: string }>(
        'select grade_id from crm.customer_parts where customer_id = $1',
        [CUSTOMER],
      );
      expect(rows[0]?.grade_id).toBe(GRADE);
    });

    it('keeps one part per paper and width', async () => {
      await insertPart({ roll_width_in: 36 });
      await insertPart({ roll_width_in: 48, position: 1 });
      await expect(insertPart({ roll_width_in: 36, position: 2 })).rejects.toMatchObject({
        constraint: 'customer_parts_customer_grade_width_key',
      });
    });

    it('holds the width from 1 to 1000 inches', async () => {
      await expect(insertPart({ roll_width_in: 0 })).rejects.toMatchObject({
        constraint: 'customer_parts_roll_width_in_check',
      });
      await expect(insertPart({ roll_width_in: 1001 })).rejects.toMatchObject({
        constraint: 'customer_parts_roll_width_in_check',
      });
    });

    it('keeps a width in sixteenths, and refuses one that is not', async () => {
      await insertPart({ roll_width_in: '9.75' });
      await insertPart({ roll_width_in: 12, position: 1 });
      await expect(insertPart({ roll_width_in: '13.7', position: 2 })).rejects.toMatchObject({
        constraint: 'customer_parts_roll_width_sixteenths_check',
      });
      const { rows } = await db.pool.query<{ roll_width_in: string }>(
        'select roll_width_in from crm.customer_parts where customer_id = $1 order by position',
        [CUSTOMER],
      );

      expect(rows.map((row) => row.roll_width_in)).toEqual(['9.7500', '12.0000']);
    });

    it('takes no roll length or one above 0, and refuses 0 and below', async () => {
      await insertPart({ roll_width_in: 36 });
      await insertPart({ roll_width_in: 48, position: 1, feet_per_roll: '1480' });
      await insertPart({ roll_width_in: 60, position: 2, feet_per_roll: '0.0001' });
      for (const feet of ['0', '-1480']) {
        await expect(
          insertPart({ roll_width_in: 72, position: 3, feet_per_roll: feet }),
          feet,
        ).rejects.toMatchObject({ constraint: 'customer_parts_feet_per_roll_check' });
      }
      const { rows } = await db.pool.query<{ feet_per_roll: string | null }>(
        'select feet_per_roll from crm.customer_parts where customer_id = $1 order by position',
        [CUSTOMER],
      );
      expect(rows.map((row) => row.feet_per_roll)).toEqual([null, '1480.0000', '0.0001']);
    });

    it('refuses a negative position', async () => {
      await expect(insertPart({ position: -1 })).rejects.toMatchObject({
        constraint: 'customer_parts_position_check',
      });
    });

    it('holds the names to the bounds a quote line has, trimmed and non-empty', async () => {
      await expect(insertPart({ part_number: 'X'.repeat(41) })).rejects.toMatchObject({
        constraint: 'customer_parts_part_number_check',
      });
      await expect(insertPart({ part_number: ' WF ' })).rejects.toMatchObject({
        constraint: 'customer_parts_part_number_check',
      });
      await expect(insertPart({ part_number: '' })).rejects.toMatchObject({
        constraint: 'customer_parts_part_number_check',
      });
      await expect(
        insertPart({ part_number: null, description: 'X'.repeat(121) }),
      ).rejects.toMatchObject({ constraint: 'customer_parts_description_check' });
      await insertPart({ part_number: 'X'.repeat(40), description: 'X'.repeat(120) });
    });

    it('refuses a part with neither name', async () => {
      await expect(insertPart({ part_number: null, description: null })).rejects.toMatchObject({
        constraint: 'customer_parts_has_a_name_check',
      });
    });

    describe('agreed price', () => {
      const setAgreed = (values: {
        basis?: string | null;
        price?: string | null;
        setBy?: string | null;
        setAt?: string | null;
      }) =>
        db.pool.query(
          `update crm.customer_parts
              set agreed_price_basis = $2, agreed_price = $3,
                  agreed_price_set_by = $4, agreed_price_set_at = $5
            where customer_id = $1`,
          [
            CUSTOMER,
            values.basis ?? null,
            values.price ?? null,
            values.setBy ?? null,
            values.setAt ?? null,
          ],
        );
      const full = {
        basis: 'per_pound',
        price: '0.69',
        setBy: 'dev-billing',
        setAt: '2026-11-16T17:00:00.000Z',
      };

      it('takes all four or none, and reads the figure back at four places', async () => {
        await insertPart();
        await setAgreed(full);
        const { rows } = await db.pool.query<{ agreed_price: string }>(
          'select agreed_price from crm.customer_parts where customer_id = $1',
          [CUSTOMER],
        );
        expect(rows[0]?.agreed_price).toBe('0.6900');
        await setAgreed({});

        const together = { constraint: 'customer_parts_agreed_price_together_check' };
        await expect(setAgreed({ ...full, setBy: null })).rejects.toMatchObject(together);
        await expect(setAgreed({ ...full, setAt: null })).rejects.toMatchObject(together);
        await expect(setAgreed({ basis: 'per_pound', price: '0.69' })).rejects.toMatchObject(
          together,
        );
        await expect(setAgreed({ ...full, setBy: '   ' })).rejects.toMatchObject(together);
      });

      it('holds the basis to the two Pricing Bases and the figure above 0', async () => {
        await insertPart();
        await setAgreed({ ...full, basis: 'per_roll', price: '23.75' });
        await expect(setAgreed({ ...full, basis: 'per_ton' })).rejects.toMatchObject({
          constraint: 'customer_parts_agreed_price_basis_check',
        });
        for (const price of ['0', '-0.69']) {
          await expect(setAgreed({ ...full, price }), price).rejects.toMatchObject({
            constraint: 'customer_parts_agreed_price_positive_check',
          });
        }
      });
    });

    it('goes with its defaults row, and the row goes with the customer', async () => {
      await insertPart();
      await db.pool.query('delete from crm.customer_defaults where customer_id = $1', [CUSTOMER]);
      const { rows } = await db.pool.query(
        'select 1 from crm.customer_parts where customer_id = $1',
        [CUSTOMER],
      );
      expect(rows).toHaveLength(0);
    });
  });
});
