// Structural check: every role list in apps/api/src and packages/types/src that grants Production also grants the Production Manager.
// The rule: the Production Manager may do everything Production may do: docs/product/roles.md.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const TYPES_SRC = resolve(__dirname, '../../../packages/types/src');

const SCANNED_ROOTS = [resolve(__dirname, '../src'), TYPES_SRC];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

function productionRoleLists(): { file: string; name: string; roles: string }[] {
  const found: { file: string; name: string; roles: string }[] = [];

  for (const file of SCANNED_ROOTS.flatMap(sourceFiles)) {
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(/const (\w*ROLES)\s*=\s*\[([^\]]*)\]/g)) {
      const [, name = '', roles = ''] = match;
      if (roles.includes("'Production'")) found.push({ file, name, roles });
    }

    for (const match of source.matchAll(/@RequireRoles\(([^)]*)\)/g)) {
      const [, roles = ''] = match;
      if (roles.includes("'Production'")) {
        found.push({ file, name: '@RequireRoles (inline)', roles });
      }
    }
  }
  return found;
}

describe('production role convention', () => {
  it('finds the role lists it is meant to police', () => {
    const found = productionRoleLists();
    expect(found.length).toBeGreaterThan(0);

    expect(
      found.filter((entry) => entry.file.startsWith(TYPES_SRC)),
      `no Production-bearing role list found under ${TYPES_SRC}`,
    ).not.toHaveLength(0);
  });

  it('never grants the floor a route without also granting the manager', () => {
    const offenders = productionRoleLists().filter(
      (entry) => !entry.roles.includes("'ProductionManager'"),
    );

    expect(
      offenders.map((entry) => `${entry.name} in ${entry.file}: ${entry.roles.trim()}`),
    ).toEqual([]);
  });
});
