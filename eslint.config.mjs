// Applies the shared lint presets, including the module boundary rule in
// packages/config/eslint/boundaries.mjs, to everything `pnpm lint` names.
import erp from '@erp/config/eslint';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',

      '**/next-env.d.ts',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  ...erp,
];
