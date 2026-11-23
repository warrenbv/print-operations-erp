// Tests the storage switch in apps/api/src/config/persistence-guard.ts: docs/decisions/007-persistence-switch-at-the-composition-root.md.
import { describe, expect, it } from 'vitest';

import {
  resolvePersistenceMode,
  resolvePersistenceModeFromEnv,
} from '../src/config/persistence-guard';

const DEV_URL = 'postgresql://erp:erp@localhost:5432/erp';

describe('resolvePersistenceMode', () => {
  it('infers postgres from a connection string', () => {
    expect(resolvePersistenceMode(undefined, DEV_URL, 'development')).toBe('postgres');
  });

  it('falls back to memory for a developer with no database', () => {
    expect(resolvePersistenceMode(undefined, undefined, 'development')).toBe('memory');
  });

  it.each([[undefined], ['']])(
    'refuses to boot production on in-memory stores (DATABASE_URL=%p)',
    (databaseUrl) => {
      expect(() => resolvePersistenceMode(undefined, databaseUrl, 'production')).toThrow(
        /refuses to run on in-memory stores/,
      );
    },
  );

  it('honors an explicit memory override outside production', () => {
    expect(resolvePersistenceMode('memory', DEV_URL, 'test')).toBe('memory');
  });

  it('refuses an explicit memory override in production', () => {
    expect(() => resolvePersistenceMode('memory', DEV_URL, 'production')).toThrow(
      /refuses to run on in-memory stores/,
    );
  });

  it('refuses an explicit postgres mode with nothing to connect to', () => {
    expect(() => resolvePersistenceMode('postgres', undefined, 'development')).toThrow(
      /DATABASE_URL is not set/,
    );
  });

  it('rejects a value that is neither mode rather than guessing', () => {
    expect(() => resolvePersistenceMode('sqlite', DEV_URL, 'development')).toThrow(/is not one of/);
  });

  it('names DATA_PERSISTENCE when it complains', () => {
    expect(() => resolvePersistenceMode('sqlite', DEV_URL, 'development')).toThrow(
      /DATA_PERSISTENCE "sqlite"/,
    );
  });

  it('treats an empty override as unset', () => {
    expect(resolvePersistenceMode('', DEV_URL, 'development')).toBe('postgres');
  });
});

describe('resolvePersistenceModeFromEnv', () => {
  it('reads DATA_PERSISTENCE', () => {
    expect(
      resolvePersistenceModeFromEnv({
        DATA_PERSISTENCE: 'memory',
        DATABASE_URL: DEV_URL,
        NODE_ENV: 'test',
      }),
    ).toBe('memory');
  });

  it('infers from DATABASE_URL when DATA_PERSISTENCE is not set', () => {
    expect(resolvePersistenceModeFromEnv({ DATABASE_URL: DEV_URL, NODE_ENV: 'development' })).toBe(
      'postgres',
    );
    expect(resolvePersistenceModeFromEnv({ NODE_ENV: 'development' })).toBe('memory');
  });
});
