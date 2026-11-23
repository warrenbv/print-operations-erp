// `pnpm test:portfolio`: builds the demonstration, then runs the browser journey in tests/portfolio/.
// Playwright starts the built demo itself, as playwright.config.ts sets out. The environment is the
// launcher's allowlist plus the browser location and the port overrides.
import { spawn } from 'node:child_process';
import { assertRuntime, cleanEnvironment, root } from './demo-config.mjs';

assertRuntime();
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run this check with pnpm test:portfolio.');
const env = {
  ...cleanEnvironment(),
  ...(process.env.PLAYWRIGHT_BROWSERS_PATH
    ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
    : {}),
  ...(process.env.PORTFOLIO_WEB_PORT ? { PORTFOLIO_WEB_PORT: process.env.PORTFOLIO_WEB_PORT } : {}),
  ...(process.env.PORTFOLIO_API_PORT ? { PORTFOLIO_API_PORT: process.env.PORTFOLIO_API_PORT } : {}),
};
for (const args of [['demo:build'], ['exec', 'playwright', 'test']]) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (code !== 0) process.exit(code);
}
