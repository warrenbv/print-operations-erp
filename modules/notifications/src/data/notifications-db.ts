// The Drizzle handle for the `notifications` schema, built with packages/db/src/module-db.ts.
import { createModuleDb, type Pool } from '@erp/db';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

export type NotificationsDb = NodePgDatabase<typeof schema>;

export function createNotificationsDb(pool: Pool): NotificationsDb {
  return createModuleDb(pool, schema);
}
