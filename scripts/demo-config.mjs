// Everything the demonstration launcher decides: the ports, the environment of each process built from
// an allowlist, the demonstration password and roster, and the build stamp. scripts/demo.mjs uses it,
// and tests/portfolio/demo-config.test.mjs checks it against the application source.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The one place the demonstration password is written. tests/portfolio/demo-config.test.mjs fails if it
// appears anywhere else in the source.
export const demoPassword = 'demo-password';
// The accounts the API lets sign in. They must be the ones the sign-in page offers in
// apps/web/src/lib/portfolio-demo.ts, which the launcher's test checks.
export const demoAccounts = ['dev-sales', 'dev-production-manager', 'dev-billing', 'dev-admin'];
export const buildStampPath = path.join(root, 'apps/web/.next/portfolio-demo-build.json');

export function demoPorts(env = process.env) {
  const parse = (name, fallback) => {
    const text = env[name] ?? String(fallback);
    if (!/^\d+$/.test(text)) throw new Error(`${name} must be a port number.`);
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1024 || value > 65535)
      throw new Error(`${name} must be between 1024 and 65535.`);
    return value;
  };
  const web = parse('PORTFOLIO_WEB_PORT', 4330);
  const api = parse('PORTFOLIO_API_PORT', 4331);
  if (web === api) throw new Error('The web and API ports must be different.');
  return { web, api, webUrl: `http://127.0.0.1:${web}`, apiUrl: `http://127.0.0.1:${api}` };
}

// Starts from nothing and copies only these keys, so a database, directory, mail or storage setting in
// the caller's shell never reaches a demo process. The telemetry opt-outs are added.
export function cleanEnvironment(env = process.env) {
  const result = {};
  for (const key of [
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
  ]) {
    if (env[key] !== undefined) result[key] = env[key];
  }
  return {
    ...result,
    NEXT_TELEMETRY_DISABLED: '1',
    TURBO_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
  };
}

export function launchEnvironments(env = process.env) {
  const ports = demoPorts(env);
  const base = cleanEnvironment(env);
  return {
    ports,
    build: { ...base, NEXT_PUBLIC_API_BASE_URL: ports.apiUrl },
    api: {
      ...base,
      // Not `production`: the local provider, role seeding and the fake tax lookup each refuse it.
      NODE_ENV: 'test',
      AUTH_PROVIDER: 'local',
      DATA_PERSISTENCE: 'memory',
      DEV_SEED_ROLES: 'true',
      LOCAL_AUTH_PASSWORD: demoPassword,
      LOCAL_AUTH_USERS: demoAccounts.join(','),
      // The demo serves plain HTTP on the local machine, so the cookie cannot be `Secure`:
      // docs/decisions/005-server-side-sessions.md.
      SESSION_COOKIE_INSECURE: 'true',
      E2E_TAX_CODE_LOOKUP: 'fake',
      API_HOST: '127.0.0.1',
      API_PORT: String(ports.api),
      WEB_ORIGIN: ports.webUrl,
    },
    web: {
      ...base,
      NODE_ENV: 'production',
      // The web app shows the demonstration sign-in only with this flag and a loopback HTTP API address:
      // apps/web/src/lib/portfolio-demo.ts.
      PORTFOLIO_DEMO: 'true',
      PORTFOLIO_DEMO_PASSWORD: demoPassword,
      PORT: String(ports.web),
      API_INTERNAL_URL: ports.apiUrl,
      NEXT_PUBLIC_API_BASE_URL: ports.apiUrl,
      SESSION_COOKIE_INSECURE: 'true',
    },
  };
}

export function assertRuntime() {
  if (Number(process.versions.node.split('.')[0]) !== 22)
    throw new Error('This snapshot requires Node.js 22. See the README prerequisites.');
}

// Next.js loads `.env` files by itself, which would bypass the allowlist. The launcher refuses to start
// while one exists at the root or in either app.
export function assertNoLocalEnvFiles() {
  const names = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
    '.env.test',
    '.env.test.local',
  ];
  for (const directory of ['', 'apps/api', 'apps/web']) {
    for (const name of names) {
      if (existsSync(path.join(root, directory, name))) {
        throw new Error(
          `The isolated demo does not use environment files. Move ${path.join(directory, name)} out before starting it.`,
        );
      }
    }
  }
}

export function writeBuildStamp(ports, file = buildStampPath) {
  writeFileSync(file, `${JSON.stringify({ apiUrl: ports.apiUrl })}\n`);
}

// Refuses a build whose embedded API address differs from the one the API would start on, because the
// browser would then call the wrong port.
export function assertBuildMatches(ports, file = buildStampPath) {
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(
      'This build was not made by pnpm demo:build, so its API address is unknown. Run pnpm demo, or pnpm demo:build and then pnpm demo:start.',
    );
  }
  if (stamp?.apiUrl !== ports.apiUrl) {
    throw new Error(
      `This build points the browser at ${stamp?.apiUrl ?? 'an unknown address'}, but the API would start on ${ports.apiUrl}. Rebuild for these ports: run pnpm demo with the same PORTFOLIO_WEB_PORT and PORTFOLIO_API_PORT, or pnpm demo:build before pnpm demo:start.`,
    );
  }
}
