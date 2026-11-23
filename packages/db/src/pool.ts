// Creates a `pg` pool for a composition root, a CLI or a test helper. Without a connection string or
// `DATABASE_URL` it refuses rather than letting `pg` fall back to its own defaults.
// Whether to connect at all is the API's decision: docs/decisions/007-persistence-switch-at-the-composition-root.md.
import { Pool, type PoolConfig } from 'pg';

export function createPool(config: PoolConfig = {}): Pool {
  const connectionString = config.connectionString ?? process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set (or pass connectionString explicitly)');
  }
  return new Pool({ ...config, connectionString });
}
