// Runs the OrderRepository contract against the in-memory adapter, and against the Drizzle adapter
// when a database is available. The assertions are in
// modules/orders/test/contracts/order-repository.contract.ts. The database-only blocks below test the
// baseline's CHECK constraints and the job number sequence directly.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DrizzleOrderRepository } from '../src/adapters/drizzle/drizzle-order-repository';
import { InMemoryOrderRepository } from '../src/adapters/in-memory/in-memory-order-repository';
import { createOrdersDb } from '../src/data/orders-db';
import type { OrderRepository } from '../src/ports';
import {
  createOrder,
  newLine,
  newOrder,
  orderRepositoryContract,
} from './contracts/order-repository.contract';

const db = moduleTestDatabase({
  moduleName: 'orders',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/orders'),
  isolationKey: 'contract',
});

const describeDb = db.enabled ? describe : describe.skip;

describe('InMemoryOrderRepository', () => {
  orderRepositoryContract(async (): Promise<OrderRepository> => new InMemoryOrderRepository());
});

describeDb('DrizzleOrderRepository', () => {
  beforeAll(async () => {
    await db.setup();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.truncate(['orders.order_lines', 'orders.order_transitions', 'orders.orders']);
  });

  orderRepositoryContract(
    async (): Promise<OrderRepository> => new DrizzleOrderRepository(createOrdersDb(db.pool)),
  );

  describe('a confirmation is recorded whole or not at all', () => {
    async function insertConvertedOrder(): Promise<string> {
      const id = randomUUID();
      await db.pool.query(
        `INSERT INTO orders.orders (id, quote_id, customer_id, status)
         VALUES ($1, $2, $3, 'converted')`,
        [id, randomUUID(), randomUUID()],
      );
      return id;
    }

    it('refuses a confirmation record written half-way', async () => {
      const id = await insertConvertedOrder();

      await expect(
        db.pool.query(
          `UPDATE orders.orders
             SET status = 'confirmed', job_number = 'DPW-99999', confirmed_lead_time_days = 5
           WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/orders_confirmation_record_check/);
    });

    it('accepts the whole set together', async () => {
      const id = await insertConvertedOrder();

      await db.pool.query(
        `UPDATE orders.orders
           SET status = 'confirmed', job_number = 'DPW-61829',
               confirmed_lead_time_days = 5, confirmed_by = 'pm', confirmed_at = now()
         WHERE id = $1`,
        [id],
      );

      const { rows } = await db.pool.query<{ confirmed_by: string }>(
        `SELECT confirmed_by FROM orders.orders WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.confirmed_by).toBe('pm');
    });

    it('still allows an unconfirmed order to hold none of them', async () => {
      const id = await insertConvertedOrder();

      const { rows } = await db.pool.query<{ job_number: string | null }>(
        `SELECT job_number FROM orders.orders WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.job_number).toBeNull();
    });
  });

  describe('job numbers', () => {
    it('mints from a sequence that starts at one, in the DPW-00000 form', async () => {
      const { rows } = await db.pool.query<{ start_value: string; increment_by: string }>(
        `SELECT start_value, increment_by FROM pg_sequences
          WHERE schemaname = 'orders' AND sequencename = 'job_number_seq'`,
      );
      expect(rows).toEqual([{ start_value: '1', increment_by: '1' }]);

      const repo = new DrizzleOrderRepository(createOrdersDb(db.pool));
      const first = await repo.mintJobNumber();
      const second = await repo.mintJobNumber();
      expect(first).toMatch(/^DPW-\d{5}$/);
      expect(Number(second.slice(4))).toBe(Number(first.slice(4)) + 1);
    });
  });

  describe('order status', () => {
    it('refuses a status the order lifecycle does not have, on the order and its history', async () => {
      const id = randomUUID();
      await expect(
        db.pool.query(
          `INSERT INTO orders.orders (id, quote_id, customer_id, status)
           VALUES ($1, $2, $3, 'shipped')`,
          [id, randomUUID(), randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'orders_status_check' });

      await db.pool.query(
        `INSERT INTO orders.orders (id, quote_id, customer_id, status)
         VALUES ($1, $2, $3, 'converted')`,
        [id, randomUUID(), randomUUID()],
      );
      const transition = (from: string | null, to: string) =>
        db.pool.query(
          `INSERT INTO orders.order_transitions (id, order_id, from_status, to_status, actor)
           VALUES ($1, $2, $3, $4, 'pm')`,
          [randomUUID(), id, from, to],
        );
      await expect(transition('confirmed', 'shipped')).rejects.toMatchObject({
        code: '23514',
        constraint: 'order_transitions_to_status_check',
      });
      await expect(transition('shipped', 'confirmed')).rejects.toMatchObject({
        code: '23514',
        constraint: 'order_transitions_from_status_check',
      });
      await transition(null, 'converted');
      await transition('converted', 'confirmed');
    });
  });

  describe('order line rules', () => {
    async function insertLine(): Promise<string> {
      const repo = new DrizzleOrderRepository(createOrdersDb(db.pool));
      const line = newLine();
      await createOrder(repo, newOrder({ lines: [line] }));
      return line.id;
    }

    it('defaults a line to per_roll and keeps the default in place', async () => {
      const lineId = await insertLine();

      const { rows } = await db.pool.query(
        `SELECT pricing_basis, product_price_per_lb FROM orders.order_lines WHERE id = $1`,
        [lineId],
      );
      expect(rows[0]).toMatchObject({ pricing_basis: 'per_roll', product_price_per_lb: null });

      const { rows: def } = await db.pool.query(
        `SELECT column_default FROM information_schema.columns
          WHERE table_schema = 'orders' AND table_name = 'order_lines'
            AND column_name = 'pricing_basis'`,
      );
      expect(def[0]?.column_default).toContain('per_roll');
    });

    it('refuses a basis that is not one of the two', async () => {
      const lineId = await insertLine();

      await expect(
        db.pool.query(`UPDATE orders.order_lines SET pricing_basis = 'per_ton' WHERE id = $1`, [
          lineId,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('ties the price per pound to the basis in both directions', async () => {
      const lineId = await insertLine();

      await expect(
        db.pool.query(
          `UPDATE orders.order_lines SET product_price_per_lb = '0.7234' WHERE id = $1`,
          [lineId],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        db.pool.query(`UPDATE orders.order_lines SET pricing_basis = 'per_pound' WHERE id = $1`, [
          lineId,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('requires a roll weight on a per-pound line, and only there', async () => {
      const lineId = await insertLine();

      await db.pool.query(`UPDATE orders.order_lines SET roll_weight_lb = NULL WHERE id = $1`, [
        lineId,
      ]);

      await expect(
        db.pool.query(
          `UPDATE orders.order_lines
              SET pricing_basis = 'per_pound', product_price_per_lb = '0.7234',
                  ordered_weight_lb = '500.0000'
            WHERE id = $1`,
          [lineId],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'order_lines_per_pound_weight_check' });

      await db.pool.query(
        `UPDATE orders.order_lines SET roll_weight_lb = '44.6000' WHERE id = $1`,
        [lineId],
      );
      await db.pool.query(
        `UPDATE orders.order_lines
            SET pricing_basis = 'per_pound', product_price_per_lb = '0.7234',
                ordered_weight_lb = '500.0000'
          WHERE id = $1`,
        [lineId],
      );

      const { rows } = await db.pool.query(
        `SELECT pricing_basis FROM orders.order_lines WHERE id = $1`,
        [lineId],
      );
      expect(rows[0]?.pricing_basis).toBe('per_pound');
    });

    it('ties the pounds ordered to the basis in both directions, and keeps them positive', async () => {
      const lineId = await insertLine();
      const check = { code: '23514', constraint: 'order_lines_ordered_weight_check' };

      await expect(
        db.pool.query(
          `UPDATE orders.order_lines SET ordered_weight_lb = '500.0000' WHERE id = $1`,
          [lineId],
        ),
      ).rejects.toMatchObject(check);

      await db.pool.query(
        `UPDATE orders.order_lines SET roll_weight_lb = '44.6000' WHERE id = $1`,
        [lineId],
      );
      await expect(
        db.pool.query(
          `UPDATE orders.order_lines
              SET pricing_basis = 'per_pound', product_price_per_lb = '0.7234'
            WHERE id = $1`,
          [lineId],
        ),
      ).rejects.toMatchObject(check);

      for (const zeroOrLess of ['0.0000', '-31.4200']) {
        await expect(
          db.pool.query(
            `UPDATE orders.order_lines
                SET pricing_basis = 'per_pound', product_price_per_lb = '0.7234',
                    ordered_weight_lb = $2
              WHERE id = $1`,
            [lineId, zeroOrLess],
          ),
        ).rejects.toMatchObject(check);
      }

      await db.pool.query(
        `UPDATE orders.order_lines
            SET pricing_basis = 'per_pound', product_price_per_lb = '0.7234',
                ordered_weight_lb = '500.0000'
          WHERE id = $1`,
        [lineId],
      );
      const { rows } = await db.pool.query(
        `SELECT ordered_weight_lb FROM orders.order_lines WHERE id = $1`,
        [lineId],
      );
      expect(rows[0]?.ordered_weight_lb).toBe('500.0000');
    });

    it("bounds and trims the customer's part number and description, each optional", async () => {
      const lineId = await insertLine();
      const refuse = async (column: string, value: string) =>
        expect(
          db.pool.query(`UPDATE orders.order_lines SET ${column} = $2 WHERE id = $1`, [
            lineId,
            value,
          ]),
        ).rejects.toMatchObject({ code: '23514', constraint: `order_lines_${column}_check` });

      await refuse('customer_part_number', 'X'.repeat(41));
      await refuse('customer_part_number', '');
      await refuse('customer_part_number', ' LN-870');
      await refuse('customer_description', 'X'.repeat(121));
      await refuse('customer_description', 'CEDAR CORE SHEET ');

      await db.pool.query(
        `UPDATE orders.order_lines
            SET customer_part_number = $2, customer_description = $3
          WHERE id = $1`,
        [lineId, 'X'.repeat(40), 'X'.repeat(120)],
      );
      const { rows } = await db.pool.query(
        `SELECT customer_part_number FROM orders.order_lines WHERE id = $1`,
        [lineId],
      );
      expect(rows[0]?.customer_part_number).toBe('X'.repeat(40));
    });

    it('keeps a line width in sixteenths, and a custom width whole', async () => {
      const lineId = await insertLine();
      const set = (assignments: string) =>
        db.pool.query(`UPDATE orders.order_lines SET ${assignments} WHERE id = $1`, [lineId]);

      await set('roll_width_in = 11.3125');
      await expect(set('roll_width_in = 13.7')).rejects.toMatchObject({
        code: '23514',
        constraint: 'order_lines_roll_width_sixteenths_check',
      });
      await expect(set('custom_width = true')).rejects.toMatchObject({
        code: '23514',
        constraint: 'order_lines_custom_width_whole_check',
      });
      await set('roll_width_in = 41, custom_width = true');
      const { rows } = await db.pool.query(
        `SELECT roll_width_in FROM orders.order_lines WHERE id = $1`,
        [lineId],
      );
      expect(rows[0]?.roll_width_in).toBe('41.0000');
    });
  });
});
