// The `migrate` script of @erp/db: applies every module's migrations to the database in
// `DATABASE_URL`. Each folder under infra/db/migrations is one module, applied in name order.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { createPool } from '../pool';
import { resolveMigrationsRoot, runModuleMigrations } from '../migrator';

async function main(): Promise<void> {
  // Resolved from the compiled file in packages/db/dist/cli, four levels below the repository root.
  const repoRoot = resolve(__dirname, '../../../..');
  const migrationsRoot = resolveMigrationsRoot(process.env, repoRoot);

  const moduleNames = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (moduleNames.length === 0) {
    console.info('No module migrations found — nothing to apply.');
    return;
  }

  const pool = createPool();
  try {
    for (const moduleName of moduleNames) {
      await runModuleMigrations({
        pool,
        moduleName,
        migrationsFolder: resolve(migrationsRoot, moduleName),
      });
      console.info(`✔ ${moduleName}`);
    }
    console.info(`Applied migrations for ${moduleNames.length} module(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
