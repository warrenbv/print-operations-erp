// Runs the CustomerDefaultsRepository contract against the in-memory adapter, and against the Drizzle
// adapter when a database is available. The assertions are in
// modules/crm/test/contracts/customer-defaults-repository.contract.ts.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';

import { DrizzleCustomerDefaultsRepository } from '../src/adapters/drizzle/drizzle-customer-defaults-repository';
import { DrizzleCustomerRepository } from '../src/adapters/drizzle/drizzle-customer-repository';
import { InMemoryCustomerDefaultsRepository } from '../src/adapters/in-memory/in-memory-customer-defaults-repository';
import { createCrmDb } from '../src/data/crm-db';
import { customerDefaultsRepositoryContract } from './contracts/customer-defaults-repository.contract';
import { newCustomerInput } from './fixtures';

const db = moduleTestDatabase({
  moduleName: 'crm',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/crm'),

  isolationKey: 'customerdefaults',
});

const CUSTOMER_ID = '01988a00-0583-7000-8000-0000000000aa';
const CREATED_AT = new Date('2026-09-28T08:00:00.000Z');

describe('InMemoryCustomerDefaultsRepository', () => {
  customerDefaultsRepositoryContract(async () => ({
    defaults: new InMemoryCustomerDefaultsRepository(),

    customerId: CUSTOMER_ID,
  }));
});

const describeDb = db.enabled ? describe : describe.skip;

describeDb('DrizzleCustomerDefaultsRepository', () => {
  beforeAll(async () => {
    await db.setup();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.truncate(['crm.customers']);
  });

  customerDefaultsRepositoryContract(async () => {
    const crm = createCrmDb(db.pool);
    await new DrizzleCustomerRepository(crm).create(
      newCustomerInput({
        id: CUSTOMER_ID,
        name: 'Defaults Parent Co',
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    );
    return { defaults: new DrizzleCustomerDefaultsRepository(crm), customerId: CUSTOMER_ID };
  });
});
