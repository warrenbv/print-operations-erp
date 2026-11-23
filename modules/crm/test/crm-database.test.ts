// The Drizzle adapters and the crm baseline together: column defaults, CHECK constraints, translation
// of SQLSTATE codes into the port errors, and real NULLs written when a field is cleared.
// Skipped without a database.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DrizzleContactRepository } from '../src/adapters/drizzle/drizzle-contact-repository';
import { DrizzleCustomerRepository } from '../src/adapters/drizzle/drizzle-customer-repository';
import { createCrmDb, type CrmDb } from '../src/data/crm-db';
import { ContactCustomerNotFoundError } from '../src/ports';
import { newCustomerInput } from './fixtures';

const db = moduleTestDatabase({
  moduleName: 'crm',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/crm'),
  isolationKey: 'db',
});

const describeDb = db.enabled ? describe : describe.skip;
const NOW = new Date('2026-08-06T09:00:00.000Z');

let crm: CrmDb;

describeDb('crm database', () => {
  beforeAll(async () => {
    await db.setup();
    crm = createCrmDb(db.pool);
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.truncate(['crm.customers']);
  });

  describe('payment terms', () => {
    it('gives a customer inserted without terms net 15, taxable and not a reseller', async () => {
      await db.pool.query(
        `insert into crm.customers (id, name, created_at, updated_at)
         values ('00000000-0000-7000-8000-000000000001', 'Default Terms Co', now(), now())`,
      );
      const { rows } = await db.pool.query(
        `select payment_terms_kind, net_days, tax_exempt, reseller, tax_jurisdiction
           from crm.customers where name = 'Default Terms Co'`,
      );
      expect(rows[0]).toMatchObject({
        payment_terms_kind: 'net',
        net_days: 15,
        tax_exempt: false,
        reseller: false,
        tax_jurisdiction: null,
      });
    });

    it('rejects net terms with no net_days', async () => {
      await expect(
        db.pool.query(
          `insert into crm.customers (id, name, payment_terms_kind, net_days, created_at, updated_at)
           values ('00000000-0000-7000-8000-000000000002', 'Bad Net', 'net', null, now(), now())`,
        ),
      ).rejects.toMatchObject({ code: '23502' });
    });

    it('rejects any payment_terms_kind other than net', async () => {
      await expect(
        db.pool.query(
          `insert into crm.customers (id, name, payment_terms_kind, net_days, created_at, updated_at)
           values ('00000000-0000-7000-8000-000000000003', 'Bad POD', 'payable_on_delivery', 30, now(), now())`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('rejects net_days of zero', async () => {
      await expect(
        db.pool.query(
          `insert into crm.customers (id, name, payment_terms_kind, net_days, created_at, updated_at)
           values ('00000000-0000-7000-8000-000000000004', 'Zero Days', 'net', 0, now(), now())`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('column-level behaviour', () => {
    it('writes payment_terms_kind as net, which the terms type leaves out', async () => {
      const repo = new DrizzleCustomerRepository(crm);
      const created = await repo.create(
        newCustomerInput({
          id: '00000000-0000-7000-8000-000000000011',
          name: 'Beacon',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );

      await repo.update(created.id, { paymentTerms: { netDays: 45 } }, NOW, 1);
      const { rows } = await db.pool.query(
        'select payment_terms_kind, net_days from crm.customers where id = $1',
        [created.id],
      );
      expect(rows[0]).toEqual({ payment_terms_kind: 'net', net_days: 45 });
    });
  });

  describe('SQLSTATE translation', () => {
    it('translates a foreign-key violation when a contact names an unknown customer', async () => {
      const contacts = new DrizzleContactRepository(crm);
      await expect(
        contacts.create({
          id: '00000000-0000-7000-8000-000000000905',
          customerId: '00000000-0000-7000-8000-0000000009ff',
          name: 'Ghost',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ).rejects.toBeInstanceOf(ContactCustomerNotFoundError);
    });
  });

  describe('billing address', () => {
    const ROW_ID = '00000000-0000-7000-8000-000000000005';

    async function insertWithBilling(columns: string, values: string): Promise<void> {
      await db.pool.query(
        `insert into crm.customers (id, name, created_at, updated_at, ${columns})
         values ('${ROW_ID}', 'Billing Co', now(), now(), ${values})`,
      );
    }

    it('stores a customer with no billing address at all', async () => {
      await db.pool.query(
        `insert into crm.customers (id, name, created_at, updated_at)
         values ('${ROW_ID}', 'No Address Co', now(), now())`,
      );
      const { rows } = await db.pool.query(
        `select billing_name, billing_line1, billing_line2, billing_city,
                billing_state, billing_postal_code
           from crm.customers where name = 'No Address Co'`,
      );
      expect(rows[0]).toEqual({
        billing_name: null,
        billing_line1: null,
        billing_line2: null,
        billing_city: null,
        billing_state: null,
        billing_postal_code: null,
      });
    });

    it('accepts a complete address', async () => {
      await insertWithBilling(
        'billing_line1, billing_city, billing_state, billing_postal_code',
        `'310 Demo Avenue', 'Demo Landing', 'WA', '99000'`,
      );
      const { rows } = await db.pool.query(
        `select billing_line1 from crm.customers where id = '${ROW_ID}'`,
      );
      expect(rows[0].billing_line1).toBe('310 Demo Avenue');
    });

    it('accepts ZIP+4, which the WA DOR rate files are published at', async () => {
      await insertWithBilling(
        'billing_line1, billing_city, billing_state, billing_postal_code',
        `'4471 Mill Road', 'Sample Harbor', 'WA', '98000-6153'`,
      );
      const { rows } = await db.pool.query(
        `select billing_postal_code from crm.customers where id = '${ROW_ID}'`,
      );
      expect(rows[0].billing_postal_code).toBe('98000-6153');
    });

    it.each([
      ['a street with no city', 'billing_line1', `'4471 Mill Road'`],
      ['a city with no street', 'billing_city', `'Demo Falls'`],
      ['a state alone', 'billing_state', `'ID'`],
      ['a postal code alone', 'billing_postal_code', `'83010'`],
      ['a bill-to name with nowhere to send it', 'billing_name', `'Accounts Payable'`],
      ['a suite number attached to no address', 'billing_line2', `'Suite 400'`],
    ])('refuses %s', async (_label, column, value) => {
      await expect(insertWithBilling(column, value)).rejects.toThrow(
        /customers_billing_address_check/,
      );
    });

    it('refuses a state that is not a two-letter code', async () => {
      await expect(
        insertWithBilling(
          'billing_line1, billing_city, billing_state, billing_postal_code',
          `'4471 Mill Road', 'Demo Falls', 'Idaho', '83010'`,
        ),
      ).rejects.toThrow(/customers_billing_state_check/);
    });

    it('accepts a state that has no tax rule', async () => {
      await insertWithBilling(
        'billing_line1, billing_city, billing_state, billing_postal_code',
        `'900 Ala Moana Blvd', 'Honolulu', 'HI', '96826'`,
      );
      const { rows } = await db.pool.query(
        `select billing_state from crm.customers where id = '${ROW_ID}'`,
      );
      expect(rows[0].billing_state).toBe('HI');
    });

    it('refuses a malformed postal code', async () => {
      await expect(
        insertWithBilling(
          'billing_line1, billing_city, billing_state, billing_postal_code',
          `'4471 Mill Road', 'Demo Falls', 'ID', '8301'`,
        ),
      ).rejects.toThrow(/customers_billing_postal_code_check/);
    });

    it('writes all six columns through the adapter, and reads them back as one address', async () => {
      const repo = new DrizzleCustomerRepository(crm);
      const address = {
        name: 'Accounts Payable',
        line1: '310 Demo Avenue',
        line2: 'Attn: Alex Demo',
        city: 'Demo Landing',
        state: 'WA',
        postalCode: '99000',
      };
      const created = await repo.create(
        newCustomerInput({
          id: '00000000-0000-7000-8000-000000000006',
          createdAt: NOW,
          updatedAt: NOW,
          billingAddress: address,
        }),
      );
      expect(created.billingAddress).toEqual(address);
    });

    it('clears the optional columns when an address is replaced by a barer one', async () => {
      const repo = new DrizzleCustomerRepository(crm);
      const id = '00000000-0000-7000-8000-000000000007';
      await repo.create(
        newCustomerInput({
          id,
          createdAt: NOW,
          updatedAt: NOW,
          billingAddress: {
            name: 'Accounts Payable',
            line1: '310 Demo Avenue',
            line2: 'Attn: Alex Demo',
            city: 'Demo Landing',
            state: 'WA',
            postalCode: '99000',
          },
        }),
      );
      await repo.update(
        id,
        {
          billingAddress: {
            line1: '4471 Mill Road',
            city: 'Demo Falls',
            state: 'ID',
            postalCode: '83010',
          },
        },
        NOW,
        1,
      );
      const { rows } = await db.pool.query(
        `select billing_name, billing_line2, billing_city from crm.customers where id = '${id}'`,
      );
      expect(rows[0]).toEqual({
        billing_name: null,
        billing_line2: null,
        billing_city: 'Demo Falls',
      });
    });
  });

  describe('shipping address', () => {
    const ROW_ID = '00000000-0000-7000-8000-000000000012';
    const PARTS = 'shipping_line1, shipping_city, shipping_state, shipping_postal_code';

    async function insertWithShipping(columns: string, values: string): Promise<void> {
      await db.pool.query(
        `insert into crm.customers (id, name, created_at, updated_at, ${columns})
         values ('${ROW_ID}', 'Shipping Co', now(), now(), ${values})`,
      );
    }

    it('stores a customer with no shipping address at all', async () => {
      await db.pool.query(
        `insert into crm.customers (id, name, created_at, updated_at)
         values ('${ROW_ID}', 'No Shipping Co', now(), now())`,
      );
      const { rows } = await db.pool.query(
        `select shipping_name, shipping_line1, shipping_line2, shipping_city,
                shipping_state, shipping_postal_code
           from crm.customers where name = 'No Shipping Co'`,
      );
      expect(rows[0]).toEqual({
        shipping_name: null,
        shipping_line1: null,
        shipping_line2: null,
        shipping_city: null,
        shipping_state: null,
        shipping_postal_code: null,
      });
    });

    it('accepts a complete address', async () => {
      await insertWithShipping(PARTS, `'400 Warehouse Way', 'Sample Harbor', 'WA', '98000'`);
      const { rows } = await db.pool.query(
        `select shipping_line1 from crm.customers where id = '${ROW_ID}'`,
      );
      expect(rows[0].shipping_line1).toBe('400 Warehouse Way');
    });

    it('accepts a shipping address and a billing address that differ entirely', async () => {
      await insertWithShipping(
        `billing_line1, billing_city, billing_state, billing_postal_code, ${PARTS}`,
        `'310 Demo Avenue', 'Demo Landing', 'WA', '99000',
         '400 Warehouse Way', 'Sample Harbor', 'WA', '98000-6153'`,
      );
      const { rows } = await db.pool.query(
        `select billing_line1, shipping_line1, shipping_postal_code
           from crm.customers where id = '${ROW_ID}'`,
      );
      expect(rows[0]).toEqual({
        billing_line1: '310 Demo Avenue',
        shipping_line1: '400 Warehouse Way',
        shipping_postal_code: '98000-6153',
      });
    });

    it.each([
      ['a street with no city', 'shipping_line1', `'400 Warehouse Way'`],
      ['a city with no street', 'shipping_city', `'Sample Harbor'`],
      ['a state alone', 'shipping_state', `'WA'`],
      ['a postal code alone', 'shipping_postal_code', `'98000'`],
      ['a receiving name with nowhere to send it', 'shipping_name', `'Receiving'`],
      ['a dock number attached to no address', 'shipping_line2', `'Dock 3'`],
    ])('refuses %s', async (_label, column, value) => {
      await expect(insertWithShipping(column, value)).rejects.toThrow(
        /customers_shipping_address_check/,
      );
    });

    it('refuses a state that is not a two-letter code', async () => {
      await expect(
        insertWithShipping(PARTS, `'400 Warehouse Way', 'Sample Harbor', 'Washington', '98000'`),
      ).rejects.toThrow(/customers_shipping_state_check/);
    });

    it('refuses a malformed postal code', async () => {
      await expect(
        insertWithShipping(PARTS, `'400 Warehouse Way', 'Sample Harbor', 'WA', '9800'`),
      ).rejects.toThrow(/customers_shipping_postal_code_check/);
    });

    it.each([
      ['a blank street', 'shipping_line1', 'customers_shipping_line1_check'],
      ['a blank city', 'shipping_city', 'customers_shipping_city_check'],
      ['a blank receiving name', 'shipping_name', 'customers_shipping_name_check'],
      ['a blank second line', 'shipping_line2', 'customers_shipping_line2_check'],
    ])('refuses %s', async (_label, column, constraint) => {
      const values: Record<string, string> = {
        shipping_line1: `'400 Warehouse Way'`,
        shipping_city: `'Sample Harbor'`,
        shipping_state: `'WA'`,
        shipping_postal_code: `'98000'`,
        shipping_name: `'Receiving'`,
        shipping_line2: `'Dock 3'`,
      };

      values[column] = `'   '`;
      const columns = Object.keys(values).join(', ');
      await expect(insertWithShipping(columns, Object.values(values).join(', '))).rejects.toThrow(
        new RegExp(constraint),
      );
    });

    it('writes all six columns through the adapter, and reads them back as one address', async () => {
      const repo = new DrizzleCustomerRepository(crm);
      const shippingAddress = {
        name: 'Receiving',
        line1: '400 Warehouse Way',
        line2: 'Dock 3',
        city: 'Sample Harbor',
        state: 'WA',
        postalCode: '98000-6153',
      };
      const created = await repo.create(
        newCustomerInput({
          id: '00000000-0000-7000-8000-000000000013',
          createdAt: NOW,
          updatedAt: NOW,
          shippingAddress,
        }),
      );
      expect(created.shippingAddress).toEqual(shippingAddress);
    });

    it('nulls the six shipping columns when the address is cleared', async () => {
      const repo = new DrizzleCustomerRepository(crm);
      const id = '00000000-0000-7000-8000-000000000014';
      await repo.create(
        newCustomerInput({
          id,
          createdAt: NOW,
          updatedAt: NOW,
          shippingAddress: {
            name: 'Receiving',
            line1: '400 Warehouse Way',
            city: 'Sample Harbor',
            state: 'WA',
            postalCode: '98000',
          },
        }),
      );
      await repo.update(id, { shippingAddress: null }, NOW, 1);
      const { rows } = await db.pool.query(
        `select shipping_name, shipping_line1, shipping_line2, shipping_city,
                shipping_state, shipping_postal_code
           from crm.customers where id = '${id}'`,
      );
      expect(rows[0]).toEqual({
        shipping_name: null,
        shipping_line1: null,
        shipping_line2: null,
        shipping_city: null,
        shipping_state: null,
        shipping_postal_code: null,
      });
    });
  });

  describe('blank text', () => {
    const CUSTOMER = '00000000-0000-7000-8000-0000000004c1';
    const CONTACT = '00000000-0000-7000-8000-0000000004c2';

    it('refuses a blank string in every text column that holds a value or nothing', async () => {
      await db.pool.query(
        `insert into crm.customers (id, name, payment_terms_kind, net_days, created_at, updated_at)
         values ($1, 'Blank Co', 'net', 30, now(), now())`,
        [CUSTOMER],
      );

      const blanks: readonly (readonly [column: string, value: string])[] = [
        ['legacy_account_number', ''],
        ['legacy_account_number', '   '],
        ['legacy_umbrella_account_number', ''],
        ['tax_jurisdiction', ''],
        ['tax_exemption_doc_ref', ''],
        ['billing_name', ''],
        ['billing_line2', ''],
        ['name', ''],
      ];
      for (const [column, value] of blanks) {
        await expect(
          db.pool.query(`update crm.customers set ${column} = $2 where id = $1`, [CUSTOMER, value]),
          `${column} = ${JSON.stringify(value)}`,
        ).rejects.toThrow(/violates check constraint/);
      }

      await db.pool.query(
        `insert into crm.contacts (id, customer_id, name, email, created_at, updated_at)
         values ($1, $2, 'Billing contact', 'real@example.test', now(), now())`,
        [CONTACT, CUSTOMER],
      );
      for (const column of ['email', 'phone', 'name']) {
        await expect(
          db.pool.query(`update crm.contacts set ${column} = '' where id = $1`, [CONTACT]),
          column,
        ).rejects.toThrow(/violates check constraint/);
      }

      await db.pool.query(
        `insert into crm.contact_roles (contact_id, role, contact_reach, set_by, set_at)
         values ($1, 'order_confirmation', 'email', 'dev-sales', now())`,
        [CONTACT],
      );
      await expect(
        db.pool.query(`update crm.contact_roles set set_by = '  ' where contact_id = $1`, [
          CONTACT,
        ]),
      ).rejects.toThrow(/violates check constraint/);
    });
  });

  describe('clearing a field writes real NULLs', () => {
    const ID = '00000000-0000-7000-8000-000000000009';

    it('nulls the six billing columns, and the CHECK still passes', async () => {
      const repo = new DrizzleCustomerRepository(crm);
      await repo.create(
        newCustomerInput({
          id: ID,
          createdAt: NOW,
          updatedAt: NOW,
          billingAddress: {
            name: 'Accounts Payable',
            line1: '310 Demo Avenue',
            line2: 'Attn: Alex Demo',
            city: 'Demo Landing',
            state: 'WA',
            postalCode: '99000',
          },
        }),
      );

      await repo.update(ID, { billingAddress: null }, NOW, 1);

      const { rows } = await db.pool.query(
        `select billing_name, billing_line1, billing_line2, billing_city,
                billing_state, billing_postal_code
           from crm.customers where id = '${ID}'`,
      );
      expect(rows[0]).toEqual({
        billing_name: null,
        billing_line1: null,
        billing_line2: null,
        billing_city: null,
        billing_state: null,
        billing_postal_code: null,
      });
    });

    it('nulls a scalar column rather than writing an empty string', async () => {
      const repo = new DrizzleCustomerRepository(crm);
      await repo.create(
        newCustomerInput({
          id: ID,
          createdAt: NOW,
          updatedAt: NOW,
          taxJurisdiction: 'WA-9010',
          freightMarginPct: '0.120000',
        }),
      );

      await repo.update(ID, { taxJurisdiction: null, freightMarginPct: null }, NOW, 1);

      const { rows } = await db.pool.query(
        `select tax_jurisdiction, freight_margin_pct from crm.customers where id = '${ID}'`,
      );
      expect(rows[0]).toEqual({ tax_jurisdiction: null, freight_margin_pct: null });
    });

    it('releases the unique index when the legacy account number is cleared', async () => {
      const repo = new DrizzleCustomerRepository(crm);
      await repo.create(
        newCustomerInput({
          id: ID,
          createdAt: NOW,
          updatedAt: NOW,
          legacyAccountNumber: 'LA-CLEAR-1',
        }),
      );
      await repo.update(ID, { legacyAccountNumber: null }, NOW, 1);

      const reused = await repo.create(
        newCustomerInput({
          id: '00000000-0000-7000-8000-000000000010',
          createdAt: NOW,
          updatedAt: NOW,
          legacyAccountNumber: 'LA-CLEAR-1',
        }),
      );
      expect(reused.legacyAccountNumber).toBe('LA-CLEAR-1');
    });
  });

  describe('clearing a contact field writes a real NULL', () => {
    const CUSTOMER_ID = '00000000-0000-7000-8000-000000000020';
    const CONTACT_ID = '00000000-0000-7000-8000-000000000021';

    it('nulls the column rather than writing an empty string', async () => {
      await new DrizzleCustomerRepository(crm).create(
        newCustomerInput({
          id: CUSTOMER_ID,
          name: 'Contact Clearing Co',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      const contacts = new DrizzleContactRepository(crm);
      await contacts.create({
        id: CONTACT_ID,
        customerId: CUSTOMER_ID,
        name: 'Alex Demo',
        email: 'jane@example.com',
        phone: '360-555-0162',
        createdAt: NOW,
        updatedAt: NOW,
      });

      await contacts.update(CONTACT_ID, { email: null }, NOW, 1);

      const { rows } = await db.pool.query(
        `select email, phone from crm.contacts where id = '${CONTACT_ID}'`,
      );
      expect(rows[0]).toEqual({ email: null, phone: '360-555-0162' });
    });
  });
});
