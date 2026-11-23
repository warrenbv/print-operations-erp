// The Drizzle handle a module builds over its own schema object, for example
// modules/documents/src/data/documents-db.ts. Its relational queries know only that module's tables.
// Importing another module's table object is what the lint rule refuses, and the pair is the
// boundary described in docs/decisions/010-orm-spike.md.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';

/** The pool, or one client checked out of it. */
export type DbClient = Pool | PoolClient;

export function createModuleDb<TSchema extends Record<string, unknown>>(
  client: DbClient,
  schema: TSchema,
): NodePgDatabase<TSchema> {
  return drizzle(client, { schema });
}
