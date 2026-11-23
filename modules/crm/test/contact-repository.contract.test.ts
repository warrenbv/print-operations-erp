// Runs the ContactRepository contract against the in-memory adapter, and against the Drizzle adapter
// when a database is available. The assertions are in modules/crm/test/contracts/contact-repository.contract.ts.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';

import { DrizzleContactRepository } from '../src/adapters/drizzle/drizzle-contact-repository';
import { DrizzleCustomerRepository } from '../src/adapters/drizzle/drizzle-customer-repository';
import { InMemoryContactRepository } from '../src/adapters/in-memory/in-memory-contact-repository';
import { createCrmDb } from '../src/data/crm-db';
import type { ContactRepository } from '../src/ports';
import { contactRepositoryContract } from './contracts/contact-repository.contract';
import { newCustomerInput } from './fixtures';

const db = moduleTestDatabase({
  moduleName: 'crm',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/crm'),

  isolationKey: 'contacts',
});

const CUSTOMER_ID = '01988a00-0003-7000-8000-0000000000aa';
const CREATED_AT = new Date('2026-08-06T08:00:00.000Z');

describe('InMemoryContactRepository', () => {
  contactRepositoryContract(async () => ({
    contacts: new InMemoryContactRepository(),

    customerId: CUSTOMER_ID,
  }));
});

const describeDb = db.enabled ? describe : describe.skip;

describeDb('DrizzleContactRepository', () => {
  beforeAll(async () => {
    await db.setup();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.truncate(['crm.customers']);
  });

  contactRepositoryContract(async () => {
    const crm = createCrmDb(db.pool);

    await new DrizzleCustomerRepository(crm).create(
      newCustomerInput({
        id: CUSTOMER_ID,
        name: 'Contract Parent Co',
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    );
    const contacts: ContactRepository = new DrizzleContactRepository(crm);
    return { contacts, customerId: CUSTOMER_ID };
  });
});
