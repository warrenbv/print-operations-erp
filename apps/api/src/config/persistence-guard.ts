// The storage switch every factory calls: in-memory stores or PostgreSQL, decided once for the whole process.
// The decision lives at the composition root: docs/decisions/007-persistence-switch-at-the-composition-root.md.
// The shared type is in packages/types/src/persistence.ts. Tests: apps/api/test/persistence-guard.test.ts.
import { PERSISTENCE_MODES, type PersistenceMode } from '@erp/types';

const VAR = 'DATA_PERSISTENCE';

/**
 * An explicit DATA_PERSISTENCE wins. Otherwise a DATABASE_URL means PostgreSQL and its absence means memory.
 * Throws rather than run production on in-memory stores, where nothing written survives a restart,
 * and rather than run PostgreSQL mode with nothing to connect to.
 */
export function resolvePersistenceMode(
  rawMode: string | undefined,
  rawDatabaseUrl: string | undefined,
  nodeEnv: string | undefined,
): PersistenceMode {
  const hasDatabaseUrl = rawDatabaseUrl !== undefined && rawDatabaseUrl !== '';

  if (rawMode !== undefined && rawMode !== '') {
    if (!PERSISTENCE_MODES.includes(rawMode as PersistenceMode)) {
      throw new Error(`${VAR} "${rawMode}" is not one of: ${PERSISTENCE_MODES.join(', ')}`);
    }
    const mode = rawMode as PersistenceMode;
    if (mode === 'memory' && nodeEnv === 'production') {
      throw new Error(memoryInProductionMessage(`${VAR} is set to "memory"`));
    }
    if (mode === 'postgres' && !hasDatabaseUrl) {
      throw new Error(`${VAR} is "postgres" but DATABASE_URL is not set`);
    }
    return mode;
  }

  if (hasDatabaseUrl) {
    return 'postgres';
  }
  if (nodeEnv === 'production') {
    throw new Error(memoryInProductionMessage('DATABASE_URL is not set'));
  }
  return 'memory';
}

export function resolvePersistenceModeFromEnv(env: NodeJS.ProcessEnv): PersistenceMode {
  return resolvePersistenceMode(env[VAR], env.DATABASE_URL, env.NODE_ENV);
}

function memoryInProductionMessage(cause: string): string {
  return (
    `${cause}. This application refuses to run on in-memory stores in ` +
    'production: nothing written would survive a restart ' +
    '(see docs/decisions/007-persistence-switch-at-the-composition-root.md), and the ' +
    'break-glass credential is provisioned only in PostgreSQL.'
  );
}
