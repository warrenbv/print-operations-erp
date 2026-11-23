// Public surface of @erp/db. Callers import from here, never from src/: packages/config/eslint/boundaries.mjs.
export { createPool } from './pool';
export { createModuleDb, type DbClient } from './module-db';

export type { Pool, PoolClient } from 'pg';

export { newId } from './ids';

export { StaleAggregateError } from './stale-aggregate';
export {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  UNIQUE_VIOLATION,
  isForeignKeyViolation,
  isPgErrorCode,
  isUniqueViolation,
  pgErrorCode,
} from './pg-errors';

export {
  dropTestDatabase,
  moduleTestDatabase,
  type ModuleTestDatabase,
  type ModuleTestDatabaseOptions,
} from './testing';
export {
  MIGRATIONS_SCHEMA,
  MIGRATIONS_ROOT,
  migrationsTableFor,
  runModuleMigrations,
  type RunModuleMigrationsOptions,
} from './migrator';
