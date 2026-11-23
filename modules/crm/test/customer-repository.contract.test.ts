// Runs the CustomerRepository contract against the in-memory adapter, and against the Drizzle adapter
// when a database is available. The assertions are in modules/crm/test/contracts/customer-repository.contract.ts.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';

import { DrizzleCustomerRepository } from '../src/adapters/drizzle/drizzle-customer-repository';
import { InMemoryCustomerRepository } from '../src/adapters/in-memory/in-memory-customer-repository';
import { createCrmDb } from '../src/data/crm-db';
import type { CustomerRepository } from '../src/ports';
import { customerRepositoryContract } from './contracts/customer-repository.contract';

const db = moduleTestDatabase({
  moduleName: 'crm',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/crm'),

  isolationKey: 'contract',
});

describe('InMemoryCustomerRepository', () => {
  customerRepositoryContract(
    async (): Promise<CustomerRepository> => new InMemoryCustomerRepository(),
  );
});

const describeDb = db.enabled ? describe : describe.skip;

describeDb('DrizzleCustomerRepository', () => {
  beforeAll(async () => {
    await db.setup();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.truncate(['crm.customers']);
  });

  customerRepositoryContract(
    async (): Promise<CustomerRepository> => new DrizzleCustomerRepository(createCrmDb(db.pool)),
  );
});
