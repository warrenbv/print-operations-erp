// The lint preset the root eslint.config.mjs applies to apps, modules, packages, scripts and tests:
// TypeScript rules, the module boundaries, and the web interface rules.
import base from './base.mjs';
import boundaries from './boundaries.mjs';
import webUi from './web-ui.mjs';

export default [...base, boundaries, webUi];
