// The Drizzle handle typed to the crm schema alone, so a query on another module's tables does
// not compile: docs/decisions/010-orm-spike.md.
import { createModuleDb, type Pool } from '@erp/db';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

export type CrmDb = NodePgDatabase<typeof schema>;

export function createCrmDb(pool: Pool): CrmDb {
  return createModuleDb(pool, schema);
}
