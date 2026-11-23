// Runs modules/identity/test/contracts/break-glass-store.contract.ts against the in-memory adapter
// and, under `pnpm test:db`, the Drizzle adapter. A failure means the two adapters disagree:
// docs/process/verifying-agent-written-code.md.
import { resolve } from 'node:path';

import { moduleTestDatabase } from '@erp/db';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';

import { DrizzleBreakGlassStore } from '../src/adapters/drizzle/drizzle-break-glass-store';
import { InMemoryBreakGlassStore } from '../src/adapters/in-memory/in-memory-break-glass-store';
import { createIdentityDb } from '../src/data/identity-db';
import { breakGlassStoreContract } from './contracts/break-glass-store.contract';

const db = moduleTestDatabase({
  moduleName: 'identity',
  migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/identity'),
  isolationKey: 'breakglass',
});

const describeDb = db.enabled ? describe : describe.skip;

describe('InMemoryBreakGlassStore', () => {
  breakGlassStoreContract(async () => new InMemoryBreakGlassStore());
});

describeDb('DrizzleBreakGlassStore', () => {
  beforeAll(async () => {
    await db.setup();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    await db.truncate(['identity.break_glass']);
  });

  breakGlassStoreContract(async () => new DrizzleBreakGlassStore(createIdentityDb(db.pool)));
});
