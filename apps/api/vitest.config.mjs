import { defineConfig } from 'vitest/config';
import base from '@erp/config/vitest';

export default defineConfig({
  ...base,
  test: {
    ...base.test,

    hookTimeout: 120_000,
  },
});
