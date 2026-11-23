// Gives each module's database tests a database of their own, created beside the one in
// `DATABASE_URL` and migrated with that module's migrations. Without `DATABASE_URL` the helper is
// disabled and suites that check `enabled` skip. `pnpm test:db` (scripts/test-db.mjs) supplies a
// throwaway Postgres, which is how those suites run.
import { createPool } from './pool';
import { runModuleMigrations } from './migrator';
import type { Pool } from 'pg';

const DROP_TIMEOUT_MS = 8_000;

export function shouldForceDrop(env: NodeJS.ProcessEnv = process.env): boolean {
  const ci = env['CI'];
  return ci !== undefined && ci !== '' && ci !== 'false' && ci !== '0';
}

export interface ModuleTestDatabaseOptions {
  moduleName: string;

  migrationsFolder: string;

  isolationKey?: string;

  dropTimeoutMs?: number;

  forceDrop?: boolean;
}

export interface ModuleTestDatabase {
  readonly enabled: boolean;

  readonly pool: Pool;
  setup(): Promise<void>;
  teardown(): Promise<void>;

  truncate(tables: readonly string[]): Promise<void>;
}

function isDuplicateDatabase(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '42P04'
  );
}

async function ensureOwnDatabase(
  baseUrl: string,
  moduleName: string,
  isolationKey?: string,
): Promise<{ url: string; name: string }> {
  const url = new URL(baseUrl);
  const suffix = isolationKey === undefined ? moduleName : `${moduleName}_${isolationKey}`;

  const ownName = `${decodeURIComponent(url.pathname.replace(/^\//, ''))}__${suffix}`;
  // The name is interpolated into DDL, so only letters, digits and underscores pass.
  if (!/^[A-Za-z0-9_]+$/.test(ownName)) {
    throw new Error(`Refusing to create a database with an unsafe name: "${ownName}"`);
  }

  const admin = createPool({ connectionString: baseUrl });
  try {
    const { rows } = await admin.query<{ datconnlimit: number }>(
      'select datconnlimit from pg_database where datname = $1',
      [ownName],
    );

    // PostgreSQL marks a database whose DROP was interrupted with `datconnlimit = -2`. It refuses
    // connections and cannot be reused, so it is dropped and created afresh.
    if (rows[0]?.datconnlimit === -2) {
      await admin.query(`drop database if exists "${ownName}"`);
      rows.length = 0;
    }
    if (rows.length === 0) {
      await admin.query(`create database "${ownName}"`).catch((error: unknown) => {
        // Another worker can create the same database between the lookup and the create. That race
        // is harmless.
        if (!isDuplicateDatabase(error)) {
          throw error;
        }
      });
    }
  } finally {
    await admin.end();
  }

  url.pathname = `/${ownName}`;

  return { url: url.toString(), name: ownName };
}

/**
 * Drops a test database and never throws. A drop blocked by another connection or cut off by the
 * statement timeout is logged and the database is left behind, so a slow teardown cannot fail or
 * stall a suite. On CI the drop uses `WITH (FORCE)`. The next `setup()` under the same name reuses
 * or heals what was left: packages/db/test/module-test-database-teardown.test.ts.
 */
export async function dropTestDatabase(
  baseUrl: string,
  ownName: string,
  options: { timeoutMs?: number; label?: string; force?: boolean } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DROP_TIMEOUT_MS;
  const label = options.label ?? 'moduleTestDatabase';
  const force = options.force ?? shouldForceDrop();

  const admin = createPool({ connectionString: baseUrl, statement_timeout: timeoutMs });
  const started = Date.now();
  try {
    await admin.query(`drop database if exists "${ownName}"${force ? ' with (force)' : ''}`);
  } catch (error: unknown) {
    const code = (error as { code?: string } | null)?.code;
    const detail = error instanceof Error ? error.message : String(error);

    const elapsed = `${String(Date.now() - started)}ms, SQLSTATE ${code ?? 'none'}${
      force ? ', forced' : ''
    }`;

    console.warn(
      code === '55006' || code === '57014'
        ? `[${label}] "${ownName}" could not be dropped now (${
            code === '55006' ? 'still in use' : `took longer than ${String(timeoutMs)}ms`
          }; ${elapsed}), so it was left behind. ` +
            'The next setup() under the same name reuses it, or drops it if the drop was interrupted.'
        : `[${label}] could not drop "${ownName}" (${elapsed}): ${detail}`,
    );
  } finally {
    await admin.end();
  }
}

export function moduleTestDatabase(options: ModuleTestDatabaseOptions): ModuleTestDatabase {
  const baseUrl = process.env.DATABASE_URL;
  const enabled = baseUrl !== undefined && baseUrl !== '';
  let pool: Pool | undefined;

  let ownName: string | undefined;

  return {
    enabled,
    get pool(): Pool {
      if (pool === undefined) {
        throw new Error(
          `No test database for "${options.moduleName}". Set DATABASE_URL and call setup() first.`,
        );
      }
      return pool;
    },
    async setup(): Promise<void> {
      if (!enabled || baseUrl === undefined) {
        return;
      }
      const own = await ensureOwnDatabase(baseUrl, options.moduleName, options.isolationKey);
      ownName = own.name;
      pool = createPool({ connectionString: own.url });

      const migrationLockName = `erp-migrations-${options.moduleName}-${options.isolationKey ?? ''}`;
      // Test files that share this database can run in parallel workers. The advisory lock makes them
      // migrate one at a time.
      const lock = await pool.connect();
      try {
        await lock.query('select pg_advisory_lock(hashtext($1))', [migrationLockName]);

        await runModuleMigrations({
          pool,
          moduleName: options.moduleName,
          migrationsFolder: options.migrationsFolder,
        });
      } finally {
        await lock.query('select pg_advisory_unlock(hashtext($1))', [migrationLockName]);
        lock.release();
      }
    },
    async teardown(): Promise<void> {
      await pool?.end();
      pool = undefined;
      if (baseUrl !== undefined && ownName !== undefined) {
        await dropTestDatabase(baseUrl, ownName, {
          timeoutMs: options.dropTimeoutMs,
          ...(options.forceDrop === undefined ? {} : { force: options.forceDrop }),
        });
        ownName = undefined;
      }
    },
    async truncate(tables: readonly string[]): Promise<void> {
      if (pool === undefined || tables.length === 0) {
        return;
      }
      // Table names are interpolated, so each must be a plain `schema.table`.
      for (const t of tables) {
        if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(t)) {
          throw new Error(`Refusing to truncate an unsafe table name: "${t}"`);
        }
      }
      await pool.query(
        `truncate ${tables.map((t) => `"${t.split('.').join('"."')}"`).join(', ')} cascade`,
      );
    },
  };
}
