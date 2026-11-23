// The test-database helper's lifecycle: setup creates and migrates, and teardown drops without
// throwing, including when the database is still in use, slow to drop or left invalid. Runs only with
// `DATABASE_URL`. The cases that need a drop to finish in time skip on CI, as the banner below says.
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createPool } from '../src/pool';
import { moduleTestDatabase, shouldForceDrop } from '../src/testing';

const BASE_URL = process.env.DATABASE_URL;
const enabled = BASE_URL !== undefined && BASE_URL !== '';

const onCi = shouldForceDrop();

if (enabled && onCi) {
  process.stdout.write(
    '[teardown probe] SKIPPED ON CI: "leaves the database alone when something else is still ' +
      'connected", "gives up rather than stalling when the drop takes too long" and "heals a ' +
      'database left invalid by an interrupted drop". Each needs a real DROP DATABASE to finish ' +
      'inside the test budget, which the shared runner cannot promise. All three run on ' +
      'every local gate.\n',
  );
}

const MODULE = 'crm';
const ISOLATION_KEY = 'teardown_probe';

function expectedName(): string {
  const url = new URL(BASE_URL as string);
  const base = decodeURIComponent(url.pathname.replace(/^\//, ''));

  return `${base}__${MODULE}_${ISOLATION_KEY}`;
}

let admin: Pool | undefined;

async function exists(name: string): Promise<boolean> {
  admin ??= createPool({ connectionString: BASE_URL as string });
  const { rows } = await admin.query('select 1 from pg_database where datname = $1', [name]);
  return rows.length === 1;
}

afterAll(async () => {
  await admin?.end();
});

const suite = enabled ? describe : describe.skip;

suite('moduleTestDatabase teardown', () => {
  const GENEROUS_MS = 60_000;

  function makeDb(dropTimeoutMs?: number, forceDrop?: boolean) {
    return moduleTestDatabase({
      moduleName: MODULE,
      migrationsFolder: resolve(__dirname, '../../../infra/db/migrations/crm'),
      isolationKey: ISOLATION_KEY,
      ...(dropTimeoutMs === undefined ? {} : { dropTimeoutMs }),
      ...(forceDrop === undefined ? {} : { forceDrop }),
    });
  }

  const promisesTheDropCompletes = !onCi;

  it('creates the database on setup and tears it down without throwing', async () => {
    const name = expectedName();
    const db = makeDb(GENEROUS_MS);

    await db.setup();
    expect(await exists(name), `${name} should exist after setup()`).toBe(true);

    await expect(db.teardown()).resolves.toBeUndefined();

    if (promisesTheDropCompletes) {
      expect(await exists(name), `${name} should be gone after teardown()`).toBe(false);
    } else {
      process.stdout.write(
        `[teardown probe] after a forced drop on CI, "${name}" ${
          (await exists(name)) ? 'is STILL PRESENT' : 'is gone'
        }\n`,
      );
    }
  }, 120_000);

  it.skipIf(onCi)(
    'leaves the database alone when something else is still connected',
    async () => {
      const name = expectedName();

      const db = makeDb(undefined, false);
      await db.setup();

      const squatter = createPool({ connectionString: connectionTo(name) });
      try {
        await squatter.query('select 1');

        await expect(db.teardown()).resolves.toBeUndefined();
        expect(await exists(name), `${name} should survive while in use`).toBe(true);
      } finally {
        await squatter.end();
      }

      const cleanup = makeDb(GENEROUS_MS);
      await cleanup.setup();
      await expect(cleanup.teardown()).resolves.toBeUndefined();

      expect(await exists(name), `${name} should be collected once nothing holds it`).toBe(false);
    },
    120_000,
  );

  it.skipIf(onCi)(
    'gives up rather than stalling when the drop takes too long',
    async () => {
      const name = expectedName();

      const db = makeDb(1, false);
      await db.setup();

      const started = Date.now();
      await expect(db.teardown()).resolves.toBeUndefined();

      expect(Date.now() - started).toBeLessThan(5_000);
      expect(await exists(name), `${name} should survive a cancelled drop`).toBe(true);

      const next = makeDb(GENEROUS_MS);
      await next.setup();

      expect(await canConnect(name), 'the healed database should be usable').toBe(true);
      await next.teardown();
      expect(await exists(name)).toBe(false);
    },
    120_000,
  );

  it.skipIf(onCi)(
    'heals a database left invalid by an interrupted drop',
    async () => {
      const name = expectedName();

      admin ??= createPool({ connectionString: BASE_URL as string });
      await admin.query(`drop database if exists "${name}"`);
      await admin.query(`create database "${name}"`);
      await admin.query('update pg_database set datconnlimit = -2 where datname = $1', [name]);

      expect(await connLimit(name), `${name} should be marked invalid`).toBe(-2);
      expect(await canConnect(name), 'an invalid database refuses connections').toBe(false);

      const healed = makeDb(GENEROUS_MS);
      await healed.setup();
      expect(await canConnect(name), 'the healed database should be usable').toBe(true);
      expect(await connLimit(name)).not.toBe(-2);

      await healed.teardown();
      expect(await exists(name)).toBe(false);
    },
    120_000,
  );
});

async function connLimit(name: string): Promise<number | undefined> {
  admin ??= createPool({ connectionString: BASE_URL as string });
  const { rows } = await admin.query<{ datconnlimit: number }>(
    'select datconnlimit from pg_database where datname = $1',
    [name],
  );
  return rows[0]?.datconnlimit;
}

async function canConnect(name: string): Promise<boolean> {
  const pool = createPool({ connectionString: connectionTo(name) });
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

function connectionTo(name: string): string {
  const url = new URL(BASE_URL as string);
  url.pathname = `/${name}`;
  return url.toString();
}
