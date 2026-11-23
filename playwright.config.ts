// Runs the browser journey in tests/portfolio/ against a demo built by `pnpm demo:build`. Playwright
// starts it with `pnpm demo:start` and never reuses a running server. One worker, because the tests
// share one quote and run in order.
import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.PORTFOLIO_WEB_PORT ?? '4330');
const webUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests/portfolio',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: webUrl, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm demo:start',
    url: `${webUrl}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
