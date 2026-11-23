// The database handle typed to the identity schema alone: docs/decisions/010-orm-spike.md.
import { createModuleDb, type Pool } from '@erp/db';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

export type IdentityDb = NodePgDatabase<typeof schema>;

export function createIdentityDb(pool: Pool): IdentityDb {
  return createModuleDb(pool, schema);
}
