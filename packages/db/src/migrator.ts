// Applies one module's migrations from its folder under infra/db/migrations. Each module keeps its
// own history table, so modules migrate independently: docs/decisions/010-orm-spike.md.
// Callers: packages/db/src/cli/migrate.ts and packages/db/src/testing.ts.
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

// The history tables live in their own schema, never in the module's. A module's baseline opens with
// a bare `CREATE SCHEMA`, which would fail if the migrator had already created that schema to hold
// its history.
export const MIGRATIONS_SCHEMA = 'drizzle';

export const MIGRATIONS_ROOT = 'infra/db/migrations';

/**
 * `ERP_MIGRATIONS_ROOT` wins when it is set and not empty. A relative override resolves against the
 * working directory, not `repoRoot`: packages/db/test/migrations-root.test.ts.
 */
export function resolveMigrationsRoot(env: NodeJS.ProcessEnv, repoRoot: string): string {
  const override = env.ERP_MIGRATIONS_ROOT;
  if (override !== undefined && override !== '') return resolve(override);
  return resolve(repoRoot, MIGRATIONS_ROOT);
}

const MODULE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export function migrationsTableFor(moduleName: string): string {
  // The name becomes a SQL identifier, so anything but lower_snake_case is refused before it gets there.
  if (!MODULE_NAME_PATTERN.test(moduleName)) {
    throw new Error(
      `Invalid module name "${moduleName}": expected lower_snake_case starting with a letter`,
    );
  }
  return `__migrations_${moduleName}`;
}

export interface RunModuleMigrationsOptions {
  pool: Pool;

  moduleName: string;

  migrationsFolder: string;
}

export async function runModuleMigrations({
  pool,
  moduleName,
  migrationsFolder,
}: RunModuleMigrationsOptions): Promise<void> {
  await migrate(drizzle(pool), {
    migrationsFolder,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: migrationsTableFor(moduleName),
  });
}
