// Runs modules/quoting/test/contracts/tax-rate-repository.contract.ts against the in-memory adapter
// and, under `pnpm test:db`, the Drizzle adapter. A failure means the two adapters disagree:
// docs/process/verifying-agent-written-code.md.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';

import { DrizzleTaxRateRepository } from '../src/adapters/drizzle/drizzle-tax-rate-repository';
import { InMemoryTaxRateRepository } from '../src/adapters/in-memory/in-memory-tax-rate-repository';
import { createQuotingDb } from '../src/data/quoting-db';
import { taxRateRepositoryContract } from './contracts/tax-rate-repository.contract';

const db = moduleTestDatabase({
  moduleName: 'quoting',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/quoting'),
  isolationKey: 'taxrates',
});

const describeDb = db.enabled ? describe : describe.skip;

describe('InMemoryTaxRateRepository', () => {
  taxRateRepositoryContract(async () => new InMemoryTaxRateRepository());
});

describeDb('DrizzleTaxRateRepository', () => {
  beforeAll(async () => {
    await db.setup();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.truncate(['quoting.tax_rates']);
  });

  taxRateRepositoryContract(async () => new DrizzleTaxRateRepository(createQuotingDb(db.pool)));
});
