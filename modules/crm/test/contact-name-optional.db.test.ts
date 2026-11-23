// A contact may lack a name if it has an email address: contacts_name_or_email_check against the
// migrated crm schema. Skipped without a database.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = moduleTestDatabase({
  moduleName: 'crm',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/crm'),
  isolationKey: 'contact_name_optional',
});

const describeDb = db.enabled ? describe : describe.skip;

const CUSTOMER = '00000000-0000-7000-8000-000000000767';
const CONTACT = '00000000-0000-7000-8000-000000000768';

async function insertContact(name: string | null, email: string | null): Promise<void> {
  await db.pool.query(
    `insert into crm.contacts (id, customer_id, name, email, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())`,
    [CONTACT, CUSTOMER, name, email],
  );
}

describeDb('crm contacts with no name, against a real database', () => {
  beforeAll(async () => {
    await db.setup();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.truncate(['crm.contact_roles', 'crm.contacts', 'crm.customers']);
    await db.pool.query(
      `insert into crm.customers (id, name, payment_terms_kind, net_days, created_at, updated_at)
       values ($1, 'Mailbox Co', 'net', 30, now(), now())`,
      [CUSTOMER],
    );
  });

  it('stores a contact that is an email address alone', async () => {
    await insertContact(null, 'ap@example.test');
    const { rows } = await db.pool.query<{ name: string | null; email: string }>(
      'select name, email from crm.contacts where id = $1',
      [CONTACT],
    );
    expect(rows).toEqual([{ name: null, email: 'ap@example.test' }]);
  });

  it('refuses a contact with neither a name nor an email address', async () => {
    await expect(insertContact(null, null)).rejects.toThrow(/contacts_name_or_email_check/);
  });

  it('refuses clearing the address of a contact with no name', async () => {
    await insertContact(null, 'ap@example.test');
    await expect(
      db.pool.query('update crm.contacts set email = null where id = $1', [CONTACT]),
    ).rejects.toThrow(/contacts_name_or_email_check/);
  });

  it('still refuses a blank name, which is not the same as none', async () => {
    await expect(insertContact('   ', 'ap@example.test')).rejects.toThrow(/contacts_name_check/);
  });

  it('still stores a contact by name alone', async () => {
    await insertContact('Pat Example', null);
    const { rowCount } = await db.pool.query('select 1 from crm.contacts where id = $1', [CONTACT]);
    expect(rowCount).toBe(1);
  });
});
