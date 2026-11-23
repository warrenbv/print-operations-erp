// The root test run: the gate tests under ci-gates/ and the hook tests under .claude/. Each package
// has its own configuration, run by turbo. It fails when it finds no tests.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['ci-gates/**/*.test.mjs', '.claude/**/*.test.mjs'],
    passWithNoTests: false,
  },
});
