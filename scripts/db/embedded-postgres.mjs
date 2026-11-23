// An embedded PostgreSQL that needs no Docker and no administrator rights:
// docs/decisions/009-technology-stack.md. scripts/test-db.mjs starts one per run. Most of this file
// handles stopping a cluster cleanly on Windows.
import EmbeddedPostgresImport from 'embedded-postgres';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EmbeddedPostgres = EmbeddedPostgresImport.default ?? EmbeddedPostgresImport;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Credentials for a cluster this helper creates on the local machine. They guard nothing beyond it.
export const DEV_DB = {
  user: 'erp_app',
  password: 'local-demo-password',
  database: 'erp',
  port: Number(process.env.EMBEDDED_PG_PORT ?? 5433),
};

export const DEFAULT_DATA_DIR = resolve(REPO_ROOT, '.pgdata');

export function connectionString({ database = DEV_DB.database, port = DEV_DB.port } = {}) {
  return `postgresql://${DEV_DB.user}:${DEV_DB.password}@localhost:${port}/${database}`;
}

const SHM_IN_USE = 'pre-existing shared memory block is still in use';

// With `io_method=sync` on Windows the cluster starts no `io_worker` processes, which are what can
// outlive a stop there. See `explainStartFailure`.
export function postgresFlagsFor(platform = process.platform) {
  return platform === 'win32' ? ['-c', 'io_method=sync'] : [];
}

export function survivingChildPids(captured, running) {
  const alive = new Set(running);
  return [...new Set(captured)].filter((pid) => alive.has(pid));
}

export function explainStartFailure(log) {
  if (typeof log !== 'string' || !log.includes(SHM_IN_USE)) {
    return undefined;
  }
  return [
    'PostgreSQL refused to start: a previous server still owns this cluster.',
    '',
    'Stopping a cluster on Windows can leave one io_worker process behind.',
    'It holds the shared memory, and it blocks every later start on this data',
    'directory until it is killed.',
    '',
    'Find the postgres.exe --forkchild process whose parent is no longer a live',
    'postgres.exe, then kill that one PID:  taskkill /F /PID <pid>',
    'Inspect the owning process before stopping a stale local test cluster.',
    '',
    'Do not run taskkill /F /IM postgres.exe. Several clusters run on this machine',
    "at once and that stops all of them, including another session's.",
  ].join('\n');
}

function postgresPids() {
  if (process.platform !== 'win32') {
    return [];
  }
  return numbersFrom(
    powershell(
      '@(Get-Process -Name postgres -ErrorAction SilentlyContinue |' +
        " Select-Object -ExpandProperty Id) -join ','",
    ),
  );
}

function normalizePath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\/+$/, '');
}

export function commandLineNamesDataDir(commandLine, dataDir) {
  const want = normalizePath(dataDir);
  if (want === '') {
    return false;
  }
  const escaped = want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`-d\\s+"?${escaped}"?(\\s|$)`).test(normalizePath(commandLine));
}

// Finds this cluster's processes by the data directory on the server's command line, so only this
// cluster's leftovers are killed and never another session's.
export function clusterChildPidsFrom(processes, dataDir) {
  const postmaster = processes.find((entry) => commandLineNamesDataDir(entry.cmd, dataDir));
  if (postmaster === undefined) {
    return [];
  }
  return processes.filter((entry) => entry.ppid === postmaster.pid).map((entry) => entry.pid);
}

function postgresProcesses() {
  if (process.platform !== 'win32') {
    return [];
  }
  const raw = powershell(
    '@(Get-CimInstance Win32_Process -Filter "Name=\'postgres.exe\'" |' +
      ' ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId;' +
      ' cmd = $_.CommandLine } }) | ConvertTo-Json -Compress -Depth 3',
  );
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function powershell(script, extraEnv = {}) {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, ...extraEnv },
    });
  } catch {
    return '';
  }
}

function numbersFrom(output) {
  return output
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      execFileSync('taskkill', ['/F', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {}
  }
}

export async function startEmbeddedPostgres({
  dataDir = DEFAULT_DATA_DIR,
  port = DEV_DB.port,
  createDatabase = true,
  postgresFlags = [],
} = {}) {
  mkdirSync(dataDir, { recursive: true });

  let log = '';
  const record = (message) => {
    log = `${log}${message}`.slice(-16_384);
  };

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: DEV_DB.user,
    password: DEV_DB.password,
    port,
    persistent: true,
    postgresFlags: [...postgresFlagsFor(), ...postgresFlags],

    onLog: (message) => {
      record(String(message));
      console.log(String(message));
    },
    onError: (error) => {
      record(String(error));
      console.error(error);
    },
  });

  // Initialising an existing data directory fails. Ignoring that lets a persistent cluster start again.
  try {
    await pg.initialise();
  } catch {}

  try {
    await pg.start();
  } catch (error) {
    const explanation = explainStartFailure(log);
    if (explanation === undefined) {
      throw error;
    }
    throw new Error(explanation, { cause: error });
  }

  if (createDatabase) {
    // The database may already exist in a persistent cluster.
    try {
      await pg.createDatabase(DEV_DB.database);
    } catch {}
  }

  // Off Windows the process lists are empty, so this is the library's own stop.
  const libraryStop = pg.stop.bind(pg);
  pg.stop = async () => {
    const children = clusterChildPidsFrom(postgresProcesses(), dataDir);
    await libraryStop();
    if (children.length === 0) {
      return;
    }

    await new Promise((settle) => setTimeout(settle, 500));
    killPids(survivingChildPids(children, postgresPids()));
  };

  return { pg, connectionString: connectionString({ port }) };
}
