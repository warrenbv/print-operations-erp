// The shared Vitest preset. Each package's vitest.config.mjs starts from it, for example
// packages/db/vitest.config.mjs, which raises the timeouts for its database tests.
/** @type {import('vitest/config').UserConfig} */
export default {
  test: {
    environment: 'node',

    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],

    // A package whose tests are not found fails instead of passing with nothing run.
    passWithNoTests: false,

    testTimeout: process.env.CI ? 30_000 : 10_000,

    hookTimeout: 60_000,
  },
};
