// The per-module migration runner against a real PostgreSQL: two modules into their own schemas,
// separate histories in the `drizzle` schema, and re-runs that apply nothing. The database cases run
// only with `DATABASE_URL`, which `pnpm test:db` (scripts/test-db.mjs) supplies, and skip without it.
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../src/pool';
import { MIGRATIONS_SCHEMA, migrationsTableFor, runModuleMigrations } from '../src/migrator';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL !== undefined && DATABASE_URL !== '' ? describe : describe.skip;

let pool: Pool;

const REPO_ROOT = resolve(__dirname, '../../..');
const IDENTITY_MIGRATIONS = resolve(REPO_ROOT, 'infra/db/migrations/identity');
const SAMPLE_MIGRATIONS = resolve(__dirname, 'fixtures/migrations/sample');

async function tableExists(schema: string, table: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from information_schema.tables where table_schema = $1 and table_name = $2`,
    [schema, table],
  );
  return rows.length > 0;
}

async function appliedCount(moduleName: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from "${MIGRATIONS_SCHEMA}"."${migrationsTableFor(moduleName)}"`,
  );
  return Number(rows[0]?.count ?? '0');
}

describeDb('per-module migrations', () => {
  beforeAll(async () => {
    pool = createPool({ connectionString: DATABASE_URL as string });
    await pool.query(`DROP SCHEMA IF EXISTS "identity" CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS "sample" CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS "${MIGRATIONS_SCHEMA}" CASCADE`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('applies two modules cleanly, each into its own schema', async () => {
    await runModuleMigrations({
      pool,
      moduleName: 'identity',
      migrationsFolder: IDENTITY_MIGRATIONS,
    });
    await runModuleMigrations({ pool, moduleName: 'sample', migrationsFolder: SAMPLE_MIGRATIONS });

    expect(await tableExists('identity', 'users')).toBe(true);
    expect(await tableExists('identity', 'sessions')).toBe(true);
    expect(await tableExists('identity', 'break_glass')).toBe(true);
    expect(await tableExists('sample', 'widgets')).toBe(true);
  });

  it('keeps bookkeeping out of the modules own schemas', async () => {
    expect(await tableExists(MIGRATIONS_SCHEMA, migrationsTableFor('identity'))).toBe(true);
    expect(await tableExists(MIGRATIONS_SCHEMA, migrationsTableFor('sample'))).toBe(true);
    expect(await tableExists('identity', migrationsTableFor('identity'))).toBe(false);
    expect(await tableExists('sample', migrationsTableFor('sample'))).toBe(false);
  });

  it('tracks each history independently', async () => {
    expect(await appliedCount('identity')).toBe(1);
    expect(await appliedCount('sample')).toBe(2);
  });

  it('is idempotent — re-running applies nothing new', async () => {
    await runModuleMigrations({
      pool,
      moduleName: 'identity',
      migrationsFolder: IDENTITY_MIGRATIONS,
    });
    await runModuleMigrations({ pool, moduleName: 'sample', migrationsFolder: SAMPLE_MIGRATIONS });
    expect(await appliedCount('identity')).toBe(1);
    expect(await appliedCount('sample')).toBe(2);
  });

  it('gives identity the columns the ports expect', async () => {
    const { rows } = await pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'identity' and table_name = 'sessions' order by column_name`,
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      'absolute_expires_at',
      'id',
      'issued_at',
      'last_seen_at',
      'token_hash',
      'user_id',
    ]);
  });
});

describe('migrationsTableFor', () => {
  it('names one tracking table per module', () => {
    expect(migrationsTableFor('identity')).toBe('__migrations_identity');
  });

  it.each([['Identity'], ['identity-module'], ['1identity'], [''], ['id"; drop table x --']])(
    'rejects %s rather than letting it reach SQL as an identifier',
    (name) => {
      expect(() => migrationsTableFor(name)).toThrow(/Invalid module name/);
    },
  );
});
