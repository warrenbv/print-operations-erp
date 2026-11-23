#!/usr/bin/env node
// docs-freshness: reports which module, app and package READMEs have fallen
// behind the code they describe.
//
// For each `<root>/<name>` that has both a README.md and a src/ folder:
//   code last changed  the newest commit touching `<dir>/src`
//   last verified      the newest commit whose `Docs-Verified:` trailer names
//                      `<dir>`, or failing that the commit named in an older
//                      "Verified against <sha>" line in the README
// and one of three statuses:
//   FRESH           the code commit is the verifying commit or an ancestor of it
//   STALE           code has landed under src/ since the page was verified
//   NEVER VERIFIED  no trailer and no stamp line, so there is no baseline
// It exists because a stamp line inside each README made every merge request
// that touched a module conflict with every other one. A commit trailer lives
// in history, so two branches never collide over it.
//
// Usage: node docs-freshness.mjs [--check]
// Without --check it is a report and always exits 0. With --check it exits 1
// when any page is STALE, and only then. The pure rules are exported for the
// tests.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PAGE_ROOTS = ['modules', 'apps', 'packages'];

export const TRAILER_KEY = 'Docs-Verified';

// The trailer value is typed by hand, so commas, semicolons, extra spaces,
// backslashes and trailing slashes are all accepted as the same list.
export function parseTrailerDirectories(value) {
  if (!value) return [];
  return value
    .split(/[,;\s]+/)
    .map((part) => part.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter((part) => part.length > 0);
}

// Reads the sha and date from an older stamp line, in any of its spellings.
// The date is looked for in the 80 characters after the sha, so a stamp that a
// formatter wrapped onto the next line still reads.
export function parseLegacyStamp(readmeText) {
  const stamp = /verified\s+against\s+(?:commit\s+)?`?([0-9a-fA-F]{7,40})`?/i.exec(
    readmeText ?? '',
  );
  if (!stamp) return null;
  const after = readmeText.slice(stamp.index + stamp[0].length, stamp.index + stamp[0].length + 80);
  const date = /(\d{4}-\d{2}-\d{2})/.exec(after);
  return { sha: stamp[1].toLowerCase(), date: date ? date[1] : null };
}

export const FRESH = 'FRESH';
export const STALE = 'STALE';
export const NEVER_VERIFIED = 'NEVER VERIFIED';

// Ancestry rather than dates decides freshness, because a rebase rewrites
// dates and a merge can land an older commit after a newer one. `isAncestor`
// is passed in so the rule can be tested without a repository.
export function pageStatus({ codeSha, verifiedSha, isAncestor }) {
  if (!codeSha) return FRESH;
  if (!verifiedSha) return NEVER_VERIFIED;
  if (codeSha === verifiedSha) return FRESH;
  return isAncestor(codeSha, verifiedSha) ? FRESH : STALE;
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function discoverPages() {
  const pages = [];
  for (const root of PAGE_ROOTS) {
    const rootPath = join(REPO_ROOT, root);
    if (!existsSync(rootPath)) continue;
    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${root}/${entry.name}`;
      if (!existsSync(join(REPO_ROOT, dir, 'src'))) continue;
      if (!existsSync(join(REPO_ROOT, dir, 'README.md'))) continue;
      pages.push(dir);
    }
  }
  return pages;
}

// One pass over history, newest first, so the first commit that names a
// directory is that directory's latest verification.
function collectTrailerVerifications() {
  const format = `%H|%h|%as|%(trailers:key=${TRAILER_KEY},valueonly,unfold,separator=%x2C)`;
  const verified = new Map();
  for (const line of git(['log', `--format=${format}`]).split('\n')) {
    const [sha, short, date, value] = line.replace(/\r$/, '').split('|');
    if (!sha || !value) continue;
    for (const dir of parseTrailerDirectories(value)) {
      if (!verified.has(dir)) verified.set(dir, { sha, short, date, source: 'trailer' });
    }
  }
  return verified;
}

function lastCodeCommit(dir) {
  const line = git(['log', '-1', '--format=%H|%h|%as', '--', `${dir}/src`]).trim();
  if (!line) return null;
  const [sha, short, date] = line.split('|');
  return { sha, short, date };
}

function stampVerification(dir) {
  const stamp = parseLegacyStamp(readFileSync(join(REPO_ROOT, dir, 'README.md'), 'utf8'));
  if (!stamp) return null;
  let sha;
  try {
    sha = git(['rev-parse', '--verify', stamp.sha]).trim();
  } catch {
    // A stamp naming a commit this clone lacks gives no usable baseline. The
    // page reads NEVER VERIFIED, and the sha is still printed to show why.
    return { sha: null, short: stamp.sha, date: stamp.date, source: 'stamp (unknown sha)' };
  }
  return { sha, short: sha.slice(0, 8), date: stamp.date, source: 'stamp' };
}

function isAncestor(a, b) {
  try {
    git(['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}

function describe(commit) {
  if (!commit || !commit.short) return '-';
  const parts = [commit.short, commit.date ?? '(no date)'];
  if (commit.source) parts.push(`(${commit.source})`);
  return parts.join(' ');
}

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function main() {
  const check = process.argv.slice(2).includes('--check');
  const trailers = collectTrailerVerifications();

  const rows = discoverPages().map((dir) => {
    const code = lastCodeCommit(dir);
    const verified = trailers.get(dir) ?? stampVerification(dir);
    return {
      dir,
      code,
      verified,
      status: pageStatus({
        codeSha: code?.sha,
        verifiedSha: verified?.sha,
        isAncestor,
      }),
    };
  });

  const columns = [
    Math.max(4, ...rows.map((row) => row.dir.length)),
    Math.max(17, ...rows.map((row) => describe(row.code).length)),
    Math.max(13, ...rows.map((row) => describe(row.verified).length)),
  ];

  console.log(`\nDocs freshness — ${rows.length} pages (every modules, apps and packages`);
  console.log(`directory with a src and a README).\n`);
  console.log(
    `${pad('PAGE', columns[0])}  ${pad('CODE LAST CHANGED', columns[1])}  ` +
      `${pad('LAST VERIFIED', columns[2])}  STATUS`,
  );
  for (const row of rows) {
    console.log(
      `${pad(row.dir, columns[0])}  ${pad(describe(row.code), columns[1])}  ` +
        `${pad(describe(row.verified), columns[2])}  ${row.status}`,
    );
  }

  const stale = rows.filter((row) => row.status === STALE);
  const never = rows.filter((row) => row.status === NEVER_VERIFIED);

  if (stale.length > 0) {
    console.log(`\n${stale.length} stale — code landed after the page was last verified.`);
    console.log(`Re-read each one, edit what the change made false, and carry this`);
    console.log(`trailer on the commit that does it:\n`);
    console.log(`  ${TRAILER_KEY}: ${stale.map((row) => row.dir).join(', ')}\n`);
  }
  if (never.length > 0) {
    console.log(`\n${never.length} never verified — no trailer names them and they carry no`);
    console.log(`stamp, so there is no baseline to measure. Each leaves this status the`);
    console.log(`first time a commit that re-reads it names it:\n`);
    console.log(`  ${TRAILER_KEY}: ${never.map((row) => row.dir).join(', ')}\n`);
  }
  if (stale.length === 0 && never.length === 0) {
    console.log(`\nEvery page is current with its code.`);
  }

  // Only STALE fails the check. A page nobody has verified is reported, not blocked.
  if (check && stale.length > 0) process.exit(1);
}

// Importing the module (as the tests do) does not run the report.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
