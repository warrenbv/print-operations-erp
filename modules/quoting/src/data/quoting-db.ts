// The Drizzle handle typed to the quoting schema only, so a query cannot name another module's
// tables: docs/decisions/010-orm-spike.md.
import { createModuleDb, type Pool } from '@erp/db';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

export type QuotingDb = NodePgDatabase<typeof schema>;

export function createQuotingDb(pool: Pool): QuotingDb {
  return createModuleDb(pool, schema);
}
