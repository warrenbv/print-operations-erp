// Tests the demonstration launcher in scripts/demo-config.mjs and scripts/demo-seed.mjs against the
// application source. It checks that the allowlist really blocks the settings the application reads,
// that each process gets exactly its own keys, that the API's roster matches the sign-in page, that the
// password is written once, and that a build for other ports is refused. `pnpm test` runs it first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertBuildMatches,
  cleanEnvironment,
  demoAccounts,
  demoPassword,
  demoPorts,
  launchEnvironments,
  root,
  writeBuildStamp,
} from '../../scripts/demo-config.mjs';
import { demoCustomers } from '../../scripts/demo-seed.mjs';

const ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'COMSPEC',
  'PATHEXT',
];
const TELEMETRY = ['NEXT_TELEMETRY_DISABLED', 'TURBO_TELEMETRY_DISABLED', 'DO_NOT_TRACK'];

// Settings that would point the demo at real systems. The first test proves the application reads
// every one of these names, so the allowlist test is not passing on names nothing uses.
const HOSTILE = {
  NODE_ENV: 'production',
  AUTH_PROVIDER: 'ldap',
  DATA_PERSISTENCE: 'postgres',
  DATABASE_URL: 'postgres://blocked.example.test/erp',
  LDAP_URLS: 'ldaps://blocked.example.test',
  LDAP_BIND_DN: 'blocked',
  LDAP_BIND_PASSWORD: 'blocked',
  LDAP_USER_BASE_DN: 'blocked',
  LDAP_CA_FILE: '/blocked',
  SMTP_HOST: 'blocked.example.test',
  SMTP_PORT: '25',
  SMTP_FROM_ADDRESS: 'blocked@example.test',
  SMTP_RETURN_PATH: 'blocked@example.test',
  SMTP_CA_FILE: '/blocked',
  MAIL_REDIRECT_TO: 'blocked@example.test',
  TAX_CODE_LOOKUP_URL: 'https://blocked.example.test',
  DOCUMENT_STORAGE_ROOT: '/blocked',
  BREAK_GLASS_DEV_PASSWORD: 'blocked',
  READ_ONLY_USERS: 'dev-sales',
  TRUST_PROXY: 'true',
  API_HOST: '0.0.0.0',
  LOCAL_AUTH_PASSWORD: 'blocked',
  LOCAL_AUTH_USERS: 'dev-noroles',
  DEV_SEED_ROLES: 'blocked',
  PORTFOLIO_DEMO_PASSWORD: 'blocked',
  NEXT_PUBLIC_API_BASE_URL: 'https://blocked.example.test',
  API_INTERNAL_URL: 'https://blocked.example.test',
};

function sourceText(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory())
      return ['node_modules', 'dist', '.next', 'test'].includes(entry.name) ? [] : sourceText(full);
    return /\.(ts|tsx|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [readFileSync(full, 'utf8')]
      : [];
  });
}

const workspaces = (group) =>
  readdirSync(path.join(root, group)).map((name) => path.join(root, group, name, 'src'));
const applicationSource = [
  path.join(root, 'apps/api/src'),
  path.join(root, 'apps/web/src'),
  ...workspaces('modules'),
  ...workspaces('packages').filter((directory) => {
    try {
      readdirSync(directory);
      return true;
    } catch {
      return false;
    }
  }),
]
  .flatMap(sourceText)
  .join('\n');

test('the hostile environment uses names the application really reads', () => {
  const unread = Object.keys(HOSTILE).filter(
    (name) => !new RegExp(`\\b${name}\\b`).test(applicationSource),
  );
  assert.deepEqual(unread, []);
});

test('the allowlist passes only its own keys and adds the telemetry opt-outs', () => {
  const full = Object.fromEntries([...ALLOWLIST, ...Object.keys(HOSTILE)].map((k) => [k, 'x']));
  assert.deepEqual(Object.keys(cleanEnvironment(full)).sort(), [...ALLOWLIST, ...TELEMETRY].sort());
  const partial = cleanEnvironment({ ...HOSTILE, PATH: '/example/bin' });
  assert.deepEqual(Object.keys(partial).sort(), ['PATH', ...TELEMETRY].sort());
});

test('each process receives exactly its own keys, with every adapter fixed to local', () => {
  const env = { ...HOSTILE, PATH: '/example/bin', HOME: '/example/home' };
  const { api, web, build, ports } = launchEnvironments(env);
  const base = ['PATH', 'HOME', ...TELEMETRY];

  assert.deepEqual(
    Object.keys(api).sort(),
    [
      ...base,
      'NODE_ENV',
      'AUTH_PROVIDER',
      'DATA_PERSISTENCE',
      'DEV_SEED_ROLES',
      'LOCAL_AUTH_PASSWORD',
      'LOCAL_AUTH_USERS',
      'SESSION_COOKIE_INSECURE',
      'E2E_TAX_CODE_LOOKUP',
      'API_HOST',
      'API_PORT',
      'WEB_ORIGIN',
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(web).sort(),
    [
      ...base,
      'NODE_ENV',
      'PORTFOLIO_DEMO',
      'PORTFOLIO_DEMO_PASSWORD',
      'PORT',
      'API_INTERNAL_URL',
      'NEXT_PUBLIC_API_BASE_URL',
      'SESSION_COOKIE_INSECURE',
    ].sort(),
  );
  assert.deepEqual(Object.keys(build).sort(), [...base, 'NEXT_PUBLIC_API_BASE_URL'].sort());

  assert.equal(api.NODE_ENV, 'test');
  assert.equal(api.AUTH_PROVIDER, 'local');
  assert.equal(api.DATA_PERSISTENCE, 'memory');
  assert.equal(api.DEV_SEED_ROLES, 'true');
  assert.equal(api.LOCAL_AUTH_PASSWORD, demoPassword);
  assert.equal(api.LOCAL_AUTH_USERS, demoAccounts.join(','));
  assert.equal(api.E2E_TAX_CODE_LOOKUP, 'fake');
  assert.equal(api.API_HOST, '127.0.0.1');
  assert.equal(api.API_PORT, String(ports.api));
  assert.equal(api.WEB_ORIGIN, ports.webUrl);
  assert.equal(web.PORTFOLIO_DEMO, 'true');
  assert.equal(web.PORTFOLIO_DEMO_PASSWORD, demoPassword);
  assert.equal(web.API_INTERNAL_URL, ports.apiUrl);
  assert.equal(web.NEXT_PUBLIC_API_BASE_URL, ports.apiUrl);
  assert.equal(build.NEXT_PUBLIC_API_BASE_URL, ports.apiUrl);
});

test('the accounts the API accepts are exactly the roles the sign-in page offers', () => {
  const page = readFileSync(path.join(root, 'apps/web/src/lib/portfolio-demo.ts'), 'utf8');
  const roster = page.slice(page.indexOf('DEMO_ROLES'), page.indexOf('] as const'));
  const offered = [...roster.matchAll(/username: '([^']+)'/g)].map((match) => match[1]);
  assert.equal(offered.length, [...roster.matchAll(/\bkey: '/g)].length);
  assert.deepEqual([...offered].sort(), [...demoAccounts].sort());
});

test('the demo password is written down once, in the launcher', () => {
  const places = [];
  const scan = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.next'].includes(entry.name)) scan(full);
      } else if (/\.(ts|tsx|mjs|js|json)$/.test(entry.name)) {
        if (readFileSync(full, 'utf8').includes(`'${demoPassword}'`))
          places.push(path.relative(root, full));
      }
    }
  };
  for (const directory of ['apps', 'modules', 'packages', 'scripts', 'tests'])
    scan(path.join(root, directory));
  assert.deepEqual(places, ['scripts/demo-config.mjs']);
});

test('both application start scripts listen on loopback unless told otherwise', () => {
  const web = JSON.parse(readFileSync(path.join(root, 'apps/web/package.json'), 'utf8'));
  assert.match(web.scripts.start, /--hostname 127\.0\.0\.1\b/);
  assert.match(web.scripts.dev, /--hostname 127\.0\.0\.1\b/);
});

test('demo:start refuses a build made for other ports', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'erp-demo-stamp-'));
  const stamp = path.join(directory, 'stamp.json');
  try {
    const built = demoPorts({ PORTFOLIO_WEB_PORT: '4400', PORTFOLIO_API_PORT: '4401' });
    assert.throws(() => assertBuildMatches(built, stamp), /not made by pnpm demo:build/);
    writeBuildStamp(built, stamp);
    assert.doesNotThrow(() => assertBuildMatches(built, stamp));
    const moved = demoPorts({ PORTFOLIO_WEB_PORT: '4400', PORTFOLIO_API_PORT: '4402' });
    assert.throws(
      () => assertBuildMatches(moved, stamp),
      /points the browser at http:\/\/127\.0\.0\.1:4401.*Rebuild/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('custom local ports are coherent and invalid pairs are rejected', () => {
  assert.equal(
    demoPorts({ PORTFOLIO_WEB_PORT: '4400', PORTFOLIO_API_PORT: '4401' }).apiUrl,
    'http://127.0.0.1:4401',
  );
  assert.throws(() => demoPorts({ PORTFOLIO_WEB_PORT: '4331' }));
  assert.throws(() => demoPorts({ PORTFOLIO_API_PORT: 'https://example.test' }));
});

test('customer fixtures are explicitly fictional and use reserved email domains', () => {
  assert.equal(demoCustomers.length, 2);
  assert.equal(new Set(demoCustomers.map((customer) => customer.number)).size, 2);
  for (const customer of demoCustomers) {
    assert.match(customer.name, /Demo/);
    assert.match(customer.email, /@example\.test$/);
    assert.match(customer.number, /^DEMO-/);
  }
});
