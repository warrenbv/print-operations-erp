// How the migration CLI finds infra/db/migrations, with and without the `ERP_MIGRATIONS_ROOT` override.
import { isAbsolute, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_ROOT, resolveMigrationsRoot } from '../src/migrator';

describe('resolveMigrationsRoot', () => {
  const repoRoot = resolve('/srv/checkout');

  it('defaults to infra/db/migrations under the repo root', () => {
    expect(resolveMigrationsRoot({}, repoRoot)).toBe(resolve(repoRoot, MIGRATIONS_ROOT));
  });

  it('takes ERP_MIGRATIONS_ROOT when set', () => {
    const root = resolveMigrationsRoot({ ERP_MIGRATIONS_ROOT: '/app/migrations' }, repoRoot);
    expect(root).toBe(resolve('/app/migrations'));
    expect(isAbsolute(root)).toBe(true);
  });

  it('treats an empty override as unset', () => {
    expect(resolveMigrationsRoot({ ERP_MIGRATIONS_ROOT: '' }, repoRoot)).toBe(
      resolve(repoRoot, MIGRATIONS_ROOT),
    );
  });

  it('resolves a relative override against the working directory, not the repo', () => {
    const root = resolveMigrationsRoot({ ERP_MIGRATIONS_ROOT: 'migrations' }, repoRoot);
    expect(root).toBe(resolve('migrations'));
    expect(root.startsWith(repoRoot + sep)).toBe(false);
  });
});
