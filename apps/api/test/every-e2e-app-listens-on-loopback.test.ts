// Structural check: every end-to-end test file that builds a Nest app binds it to 127.0.0.1 before its first request.
// The rule: supertest calls 127.0.0.1, and a server it starts itself listens on the wildcard address and a new port
// for each request. Another process holding that port on 127.0.0.1 can then answer in its place, which shows up as a
// stray 404 or an empty body in one test. Binding the app to 127.0.0.1 makes the port ours on that address.
// A failure names the test file. Replace `app.init()` with `app.listen(0, '127.0.0.1')`. Background: docs/process/verifying-agent-written-code.md.
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LOOPBACK_LISTEN = /\.listen\(0, '127\.0\.0\.1'\)/;

const TEST_DIR = __dirname;

const appTests = readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.ts') && name !== basename(__filename))
  .filter((name) => readFileSync(join(TEST_DIR, name), 'utf8').includes('createNestApplication('));

describe('every e2e app is reached on the address supertest calls', () => {
  it('finds the e2e files that build an app', () => {
    expect(appTests.length).toBeGreaterThan(0);
  });

  it.each(appTests)('%s listens on 127.0.0.1 before any request', (name) => {
    const source = readFileSync(join(TEST_DIR, name), 'utf8');

    expect(source).toMatch(LOOPBACK_LISTEN);
    expect(source).not.toMatch(/\bapp\.init\(\)/);
  });
});
