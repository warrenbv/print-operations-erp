// The account_rep_username column against the migrated crm schema. Skipped without a database.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = moduleTestDatabase({
  moduleName: 'crm',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/crm'),
  isolationKey: 'account_rep',
});

const describeDb = db.enabled ? describe : describe.skip;

const CUSTOMER = '00000000-0000-7000-8000-000000000525';

async function insertCustomer(accountRepUsername: string | null): Promise<void> {
  await db.pool.query(
    `insert into crm.customers (id, name, account_rep_username, created_at, updated_at)
     values ($1, $2, $3, now(), now())`,
    [CUSTOMER, 'Rep Co', accountRepUsername],
  );
}

describeDb('crm.customers.account_rep_username', () => {
  beforeAll(async () => {
    await db.setup();
  });

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.pool.query('delete from crm.customers where id = $1', [CUSTOMER]);
  });

  it('stores a username', async () => {
    await insertCustomer('jsmith');
    const { rows } = await db.pool.query<{ account_rep_username: string }>(
      'select account_rep_username from crm.customers where id = $1',
      [CUSTOMER],
    );
    expect(rows[0]?.account_rep_username).toBe('jsmith');
  });

  it('accepts null - an account may be between salespeople', async () => {
    await insertCustomer(null);
    const { rows } = await db.pool.query<{ account_rep_username: string | null }>(
      'select account_rep_username from crm.customers where id = $1',
      [CUSTOMER],
    );
    expect(rows[0]?.account_rep_username).toBeNull();
  });

  it.each([[''], ['   ']])('refuses %j, because blank is what null already says', async (value) => {
    await expect(insertCustomer(value)).rejects.toThrow(/customers_account_rep_username_check/);
  });

  it('accepts a username no user holds, on purpose', async () => {
    await expect(insertCustomer('nobody-by-that-name')).resolves.toBeUndefined();
  });
});
