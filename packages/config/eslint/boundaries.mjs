// The module boundary, enforced: docs/decisions/001-modular-monorepo.md. Rules are declared by folder
// type, so a new module or package is covered the day it appears. This file decides who may import
// whom. Which data crosses a boundary is review guidance and is not linted:
// docs/decisions/002-what-crosses-a-module-boundary.md.
import boundaries from 'eslint-plugin-boundaries';

export default {
  plugins: { boundaries },
  settings: {
    // Each app, module and package folder is an element of one of three types. The type decides
    // what it may import.
    'boundaries/elements': [
      { type: 'app', pattern: 'apps/*' },
      { type: 'module', pattern: 'modules/*' },
      { type: 'package', pattern: 'packages/*' },
    ],
    'import/resolver': {
      typescript: { alwaysTryTypes: true },
    },
  },
  rules: {
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        message:
          'Cross-boundary import: ${file.type} may not depend on ${dependency.type}. ' +
          'Cross-module data flows through contracts in packages/types (see docs/decisions/002-what-crosses-a-module-boundary.md).',
        // A module may import packages only, never another module. What it needs from another module it
        // declares as a port, and the API composition root supplies it: modules/quoting/src/ports.ts and
        // apps/api/src/quoting/quoting.factory.ts.
        // An app may import modules and packages. It is where modules are wired together.
        // A package may import other packages only, so shared code never depends on a business module.
        // Any other pair is refused by `default: 'disallow'`.
        rules: [
          { from: 'module', allow: ['package'] },
          { from: 'app', allow: ['package', 'module'] },
          { from: 'package', allow: ['package'] },
        ],
      },
    ],

    'no-restricted-imports': [
      'error',
      {
        // Internal links are plain anchors, so every navigation is a full page load and the server
        // renders the top bar for the new route: docs/decisions/004-server-first-web-ui.md.
        paths: [
          {
            name: 'next/link',
            message:
              'Use a plain <a href>. next/link navigates client-side, which leaves the server-rendered top bar showing the previous route.',
          },
        ],
        // Even an allowed dependency is imported only through its public entry point. A path into any
        // module's or `@erp/*` package's `src/` is refused, so each index.ts is that package's contract.
        patterns: [
          {
            group: ['**/modules/*/src/**', '@erp/*/src/**'],
            message:
              "Import the module's public surface (or the contract from packages/types), never its src/ internals.",
          },
        ],
      },
    ],
  },
};
