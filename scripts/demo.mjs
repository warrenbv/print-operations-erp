// The demonstration launcher behind `pnpm demo`, `pnpm demo:build` and `pnpm demo:start`. It builds the
// API and web app for the chosen ports, starts the API in memory mode, seeds the fictional customers
// through the API, then starts the web app. What each process receives is decided in
// scripts/demo-config.mjs. The guards the application applies by itself stay on, for example
// modules/identity/src/domain/provider-guard.ts.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertBuildMatches,
  assertNoLocalEnvFiles,
  assertRuntime,
  launchEnvironments,
  root,
  writeBuildStamp,
} from './demo-config.mjs';
import { seedDemo } from './demo-seed.mjs';

assertRuntime();
assertNoLocalEnvFiles();
const args = new Set(process.argv.slice(2));
const allowed = new Set(['--build-only', '--skip-build']);
for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown demo option: ${arg}`);
const config = launchEnvironments();

async function assertPortsAvailable() {
  for (const port of [config.ports.api, config.ports.web]) {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', () =>
        reject(
          new Error(
            `Local port ${port} is already in use. Stop the other process or choose different portfolio ports.`,
          ),
        ),
      );
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
  }
}

async function build() {
  const cli = process.env.npm_execpath;
  if (!cli || !existsSync(cli))
    throw new Error('Run this command through pnpm, for example pnpm demo.');
  console.log('Building Print Operations ERP for the local demo…');
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        cli,
        'exec',
        'turbo',
        'run',
        'build',
        '--filter=api',
        '--filter=web',
        // The web build embeds the API address, so a cached build for other ports must not be reused.
        '--force',
        '--concurrency=2',
      ],
      { cwd: root, env: config.build, stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (code !== 0) throw new Error(`Demo build failed (${code}).`);
  writeBuildStamp(config.ports);
}

if (!args.has('--build-only')) await assertPortsAvailable();
if (!args.has('--skip-build')) await build();
if (args.has('--build-only')) process.exit(0);
if (
  !existsSync(path.join(root, 'apps/api/dist/main.js')) ||
  !existsSync(path.join(root, 'apps/web/.next/BUILD_ID'))
)
  throw new Error('Build output is missing. Run pnpm demo:build first.');
// The build stamp written after a build must name the API address this run will use.
try {
  assertBuildMatches(config.ports);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    process.exit(code);
  }, 1000);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
function start(commandArgs, cwd, env) {
  const child = spawn(process.execPath, commandArgs, { cwd, env, stdio: 'inherit' });
  children.push(child);
  child.once('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once('exit', (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
async function ready(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (stopping) throw new Error('A demo process stopped before readiness.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Demo did not become ready at ${url}.`);
}

try {
  start(['dist/main.js'], path.join(root, 'apps/api'), config.api);
  await ready(`${config.ports.apiUrl}/health`);
  // Seeding runs before the web app starts, so nobody can sign in to an empty demo.
  await seedDemo(config.ports.apiUrl);
  start(
    [
      path.join(root, 'apps/web/node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(config.ports.web),
    ],
    path.join(root, 'apps/web'),
    config.web,
  );
  await ready(`${config.ports.webUrl}/login`);
  console.log(`\nPrint Operations ERP is ready: ${config.ports.webUrl}/login`);
  console.log('Choose a fictional role on the sign-in page. No network credentials are needed.');
  console.log('Customer: Northstar Demo Packaging. All records and prices are examples.');
  console.log(
    'Ctrl-C stops the demo. Restarting clears changes and creates fresh fictional data.\n',
  );
} catch (error) {
  console.error(error.message);
  stop(1);
}
