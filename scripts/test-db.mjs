// `pnpm test:db`: starts a throwaway PostgreSQL in a new temporary directory, runs every package's tests
// with `DATABASE_URL` pointing at it, then stops it and deletes the directory. Suites that need a
// database skip without it, so this is the run that exercises the PostgreSQL adapters.
// Extra arguments go to `turbo run test`.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startEmbeddedPostgres } from './db/embedded-postgres.mjs';
import { assertRuntime, root } from './demo-config.mjs';

assertRuntime();
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run this check with pnpm test:db.');

const portText = process.env.TEST_PG_PORT ?? '5441';
if (!/^\d+$/.test(portText)) throw new Error('TEST_PG_PORT must be a port number.');
const port = Number(portText);

// turbo refuses a flag given twice, so the default concurrency steps aside when the caller sets one.
const extra = process.argv.slice(2);
const concurrency = extra.some((arg) => arg.startsWith('--concurrency')) ? [] : ['--concurrency=2'];

const dataDir = mkdtempSync(path.join(tmpdir(), 'erp-test-db-'));
let server;
let code = 1;
try {
  server = await startEmbeddedPostgres({ dataDir, port });
  code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, 'exec', 'turbo', 'run', 'test', ...concurrency, ...extra],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: server.connectionString },
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (exitCode) => resolve(exitCode ?? 1));
  });
} finally {
  await server?.pg.stop();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(code);
