import { defineConfig } from 'vitest/config';
import base from '@erp/config/vitest';

export default defineConfig({
  ...base,
  test: {
    ...base.test,

    // The migration tests start an embedded PostgreSQL, which can outlast the shared preset's timeouts.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
