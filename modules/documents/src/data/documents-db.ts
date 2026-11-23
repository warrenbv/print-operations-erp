// The Drizzle handle for the `documents` schema, built with packages/db/src/module-db.ts.
import { createModuleDb, type Pool } from '@erp/db';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

export type DocumentsDb = NodePgDatabase<typeof schema>;

export function createDocumentsDb(pool: Pool): DocumentsDb {
  return createModuleDb(pool, schema);
}
