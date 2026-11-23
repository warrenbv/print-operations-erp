// The reach rule for contact roles as the database enforces it: the generated contact_reach column,
// the CHECKs on contact_roles, and the composite foreign key that cascades reach into role rows.
// A failure means the schema no longer makes an unreachable role impossible. Skipped without a database.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { CONTACT_ROLES } from '@erp/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = moduleTestDatabase({
  moduleName: 'crm',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/crm'),
  isolationKey: 'contact_roles',
});

const describeDb = db.enabled ? describe : describe.skip;

const CUSTOMER = '00000000-0000-7000-8000-000000000511';
const EMAILED = '00000000-0000-7000-8000-000000000512';
const PHONED = '00000000-0000-7000-8000-000000000513';
const SILENT = '00000000-0000-7000-8000-000000000514';

async function insertContact(
  id: string,
  fields: { email?: string; phone?: string } = {},
): Promise<void> {
  await db.pool.query(
    `insert into crm.contacts (id, customer_id, name, email, phone, created_at, updated_at)
     values ($1, $2, 'Contact', $3, $4, now(), now())`,
    [id, CUSTOMER, fields.email ?? null, fields.phone ?? null],
  );
}

async function grant(id: string, role: string, reach: string): Promise<void> {
  await db.pool.query(
    `insert into crm.contact_roles (contact_id, role, contact_reach, set_by, set_at)
     values ($1, $2, $3, 'dev-sales', now())`,
    [id, role, reach],
  );
}

describeDb('crm contact roles, against a real database', () => {
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
       values ($1, 'Roles Co', 'net', 30, now(), now())`,
      [CUSTOMER],
    );
  });

  describe('contact_reach, the generated column', () => {
    it('computes the four values from email and phone', async () => {
      await insertContact(EMAILED, { email: 'buyer@example.test' });
      await insertContact(PHONED, { phone: '555-0157' });
      await insertContact(SILENT);
      const both = '00000000-0000-7000-8000-000000000515';
      await insertContact(both, { email: 'both@example.test', phone: '555-0129' });

      const { rows } = await db.pool.query<{ id: string; contact_reach: string }>(
        'select id, contact_reach from crm.contacts order by id',
      );
      expect(Object.fromEntries(rows.map((r) => [r.id, r.contact_reach]))).toEqual({
        [EMAILED]: 'email',
        [PHONED]: 'phone',
        [SILENT]: 'none',
        [both]: 'both',
      });
    });
  });

  describe('the value guards', () => {
    it('takes every role the code defines on a contact with both an address and a phone', async () => {
      await insertContact(EMAILED, { email: 'buyer@example.test', phone: '555-0157' });
      for (const role of CONTACT_ROLES) {
        await grant(EMAILED, role, 'both');
      }

      const { rows } = await db.pool.query<{ role: string }>(
        'select role from crm.contact_roles where contact_id = $1 order by role',
        [EMAILED],
      );
      expect(rows.map((r) => r.role)).toEqual([...CONTACT_ROLES].sort());
    });

    it('refuses a role outside the closed list', async () => {
      await insertContact(EMAILED, { email: 'buyer@example.test' });
      await expect(grant(EMAILED, 'shipping', 'email')).rejects.toThrow(/contact_roles_role_check/);
    });

    it('refuses a mail role on a contact with no address', async () => {
      await insertContact(PHONED, { phone: '555-0157' });
      await expect(grant(PHONED, 'quote', 'phone')).rejects.toThrow(
        /contact_roles_reachable_check/,
      );
    });

    it('allows production on a phone-only contact', async () => {
      await insertContact(PHONED, { phone: '555-0157' });
      await grant(PHONED, 'production', 'phone');

      const { rows } = await db.pool.query<{ role: string }>(
        'select role from crm.contact_roles where contact_id = $1',
        [PHONED],
      );
      expect(rows.map((r) => r.role)).toEqual(['production']);
    });

    it('refuses production on a contact nobody can reach', async () => {
      await insertContact(SILENT);
      await expect(grant(SILENT, 'production', 'none')).rejects.toThrow(
        /contact_roles_reachable_check/,
      );
    });

    it('refuses a blank actor', async () => {
      await insertContact(EMAILED, { email: 'buyer@example.test' });
      await expect(
        db.pool.query(
          `insert into crm.contact_roles (contact_id, role, contact_reach, set_by, set_at)
           values ($1, 'quote', 'email', '  ', now())`,
          [EMAILED],
        ),
      ).rejects.toThrow(/contact_roles_set_by_check/);
    });
  });

  describe('the composite foreign key, which is what makes the rule structural', () => {
    it('refuses a role row claiming a reach its contact does not have', async () => {
      await insertContact(EMAILED, { email: 'buyer@example.test' });
      await expect(grant(EMAILED, 'quote', 'both')).rejects.toThrow(/contact_roles_reach_fkey/);
    });

    it('refuses to clear an email out from under a mail role', async () => {
      await insertContact(EMAILED, { email: 'buyer@example.test' });
      await grant(EMAILED, 'quote', 'email');

      await expect(
        db.pool.query('update crm.contacts set email = null where id = $1', [EMAILED]),
      ).rejects.toThrow(/contact_roles_reachable_check/);
    });

    it('permits the same clear once the role rows have gone', async () => {
      await insertContact(EMAILED, { email: 'buyer@example.test' });
      await grant(EMAILED, 'quote', 'email');

      await db.pool.query('delete from crm.contact_roles where contact_id = $1', [EMAILED]);
      await expect(
        db.pool.query('update crm.contacts set email = null where id = $1', [EMAILED]),
      ).resolves.toBeDefined();
    });

    it('cascades a widening reach into the rows already held', async () => {
      await insertContact(PHONED, { phone: '555-0157' });
      await grant(PHONED, 'production', 'phone');

      await db.pool.query('update crm.contacts set email = $2 where id = $1', [
        PHONED,
        'foreman@example.test',
      ]);

      const { rows } = await db.pool.query<{ contact_reach: string }>(
        'select contact_reach from crm.contact_roles where contact_id = $1',
        [PHONED],
      );
      expect(rows[0]?.contact_reach).toBe('both');
    });

    it('takes the role rows with the contact', async () => {
      await insertContact(EMAILED, { email: 'buyer@example.test' });
      await grant(EMAILED, 'order_confirmation', 'email');

      await db.pool.query('delete from crm.contacts where id = $1', [EMAILED]);

      const { rows } = await db.pool.query<{ n: number }>(
        'select count(*)::int as n from crm.contact_roles',
      );
      expect(rows[0]).toEqual({ n: 0 });
    });
  });
});
