#!/usr/bin/env node
// docs-integrity: catches documentation damage that still reads as valid
// markdown, so formatting and lint checks pass it.
//
// Six checks over the tracked files:
//   1. conflict markers, including the form a formatter leaves behind
//   2. decision record (ADR) numbers are unique
//   3. every ADR has a row in the ADR index, with the same status
//   4. an Accepted ADR that supersedes another finds it marked Superseded
//   5. every register row has as many cells as its table's header
//   6. register ids (OD-n for open decisions, SQ-n for stakeholder questions)
//      are unique within their register
// It exists because a formatter can turn a corrupt file into syntactically
// valid markdown, which defeats any check that expects corruption to look
// corrupt. Exits 0 when clean and 1 with a grouped report when not.
//
// The register rules are exported for the tests. main() reads the git index.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ADR_DIR = 'docs/decisions';

// The two registers every contributor edits, often at the same time.
export const REGISTERS = ['docs/registers/decision-log.md', 'docs/registers/question-log.md'];

// Splits a table row into trimmed cells. An escaped pipe (`\|`) stays inside
// its cell, and the empty strings outside the outer pipes are dropped.
export function splitTableRow(line) {
  const SENTINEL = '\u0000';
  const parts = line.replaceAll('\\|', SENTINEL).split('|');
  return parts.slice(1, -1).map((cell) => cell.replaceAll(SENTINEL, '\\|').trim());
}

// Every row must carry as many cells as the header of its own table. This
// catches a row moved between tables with the old columns still attached, and
// a row saved one cell short. Both render without complaint.
export function findRowShapeMismatches(text) {
  const lines = text.split(/\r?\n/);
  const mismatches = [];
  let headerCells = null;
  lines.forEach((line, i) => {
    // Any line that is not a table row ends the current table.
    if (!/^\s*\|/.test(line)) {
      headerCells = null;
      return;
    }
    const cells = splitTableRow(line.trim());
    if (headerCells === null) {
      headerCells = cells.length;
      return;
    }
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return;
    if (cells.length !== headerCells) {
      mismatches.push({
        line: i + 1,
        cells: cells.length,
        expected: headerCells,
        id: cells[0] ?? '',
      });
    }
  });
  return mismatches;
}

// Only a bold id in a row's first cell counts, so prose in other cells that
// refers to another entry is never read as a second claim on that id.
export function findDuplicateRegisterIds(text) {
  const seen = new Map();
  const dupes = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const match = /^\s*\|\s*\*\*((?:OD|SQ)-\d+)\*\*\s*\|/.exec(line);
    if (!match) return;
    const id = match[1];
    if (seen.has(id)) {
      dupes.push({ id, line: i + 1, first: seen.get(id) });
    } else {
      seen.set(id, i + 1);
    }
  });
  return dupes;
}

function main() {
  const failures = [];
  const fail = (check, detail) => failures.push({ check, detail });

  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  const read = (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };

  // The third pattern is the closing marker after a formatter has rewritten it
  // as seven nested blockquote markers followed by a commit hash.
  const MARKERS = [
    { re: /^<{7} /, label: '<<<<<<< (ours)' },
    { re: /^>{7} /, label: '>>>>>>> (theirs)' },
    { re: /^(> ){7}[0-9a-f]{7,40}\b/, label: 'Prettier-mangled >>>>>>> blockquote' },
    { re: /^\|{7}$/, label: '||||||| (base)' },
  ];

  for (const path of tracked) {
    if (path.startsWith('.claude/worktrees/')) continue;
    const text = read(path);
    if (text === null || text.includes('\0')) continue;
    const lines = text.split(/\r?\n/);
    const hits = [];
    lines.forEach((line, i) => {
      for (const { re, label } of MARKERS) {
        if (re.test(line)) hits.push(`${path}:${i + 1} — ${label}`);
      }
    });
    // A line of seven equals signs is a legal heading underline, so it is
    // reported only in a file that already has another marker.
    if (hits.length > 0) {
      lines.forEach((line, i) => {
        if (/^={7}$/.test(line)) hits.push(`${path}:${i + 1} — ======= (separator)`);
      });
      for (const hit of hits) fail('conflict-marker', hit);
    }
  }

  const adrFiles = tracked.filter(
    (p) => p.startsWith(`${ADR_DIR}/`) && /\/\d{4}-[^/]+\.md$/.test(p),
  );

  const adrs = adrFiles.map((path) => {
    const text = read(path) ?? '';
    const file = path.slice(ADR_DIR.length + 1);
    const number = file.slice(0, 4);
    // The status runs to the first `·` or the line end, because a retired
    // record reads "Superseded by ADR-NNNN" and so contains digits.
    const status = text.match(/\*\*Status:\*\*\s*([^·\n]+)/)?.[1]?.trim();
    const supersedes = [...text.matchAll(/\*\*Supersedes\s+\[?ADR-(\d{4})/gi)].map((m) => m[1]);
    return { path, file, number, status, supersedes, text };
  });

  const byNumber = new Map();
  for (const adr of adrs) {
    if (!byNumber.has(adr.number)) byNumber.set(adr.number, []);
    byNumber.get(adr.number).push(adr.file);
  }
  for (const [number, files] of byNumber) {
    if (files.length > 1) {
      fail('adr-number', `ADR-${number} is used by ${files.length} files: ${files.join(', ')}`);
    }
  }

  const indexText = read(`${ADR_DIR}/README.md`);
  if (indexText === null) {
    fail('adr-index', `${ADR_DIR}/README.md is missing`);
  } else {
    for (const adr of adrs) {
      const row = indexText
        .split('\n')
        .find((line) => line.startsWith('|') && line.includes(`(${adr.file})`));
      if (!row) {
        fail('adr-index', `ADR-${adr.number} (${adr.file}) has no row in the index`);
        continue;
      }
      if (adr.status && !row.includes(adr.status)) {
        fail(
          'adr-index',
          `ADR-${adr.number} reads "${adr.status}" but its index row does not say so: ${row.trim()}`,
        );
      }
    }
  }

  // Only an Accepted record supersedes anything. A Proposed one is waiting
  // for a human decision and may sit beside the record it would replace.
  for (const adr of adrs) {
    if (adr.status?.toLowerCase() !== 'accepted') continue;
    for (const target of adr.supersedes) {
      const other = adrs.find((a) => a.number === target);
      if (!other) {
        fail('adr-supersede', `ADR-${adr.number} supersedes ADR-${target}, which does not exist`);
        continue;
      }
      if (!/superseded/i.test(other.status ?? '')) {
        fail(
          'adr-supersede',
          `ADR-${adr.number} (Accepted) supersedes ADR-${target}, but ADR-${target} still reads ` +
            `"${other.status ?? 'no status'}" — it should read "Superseded by ADR-${adr.number}"`,
        );
      }
    }
  }

  for (const path of REGISTERS) {
    const text = read(path);
    if (text === null) {
      fail('register-table', `${path} is missing`);
      continue;
    }
    for (const miss of findRowShapeMismatches(text)) {
      fail(
        'register-table',
        `${path}:${miss.line} — row ${miss.id || '(unlabelled)'} has ${miss.cells} cells ` +
          `where its table's header has ${miss.expected}`,
      );
    }
    for (const dupe of findDuplicateRegisterIds(text)) {
      fail(
        'register-id',
        `${path}:${dupe.line} — ${dupe.id} already has a row at line ${dupe.first}`,
      );
    }
  }

  if (failures.length === 0) {
    console.log(`✔ docs-integrity: ${adrs.length} ADRs and ${tracked.length} tracked files clean.`);
    process.exit(0);
  }

  console.error('\n✖ docs-integrity failed:\n');
  for (const group of [
    'conflict-marker',
    'adr-number',
    'adr-index',
    'adr-supersede',
    'register-table',
    'register-id',
  ]) {
    const items = failures.filter((f) => f.check === group);
    if (items.length === 0) continue;
    console.error(`  ${group}:`);
    for (const item of items) console.error(`    - ${item.detail}`);
    console.error('');
  }
  console.error('  See the change-control policy and the ADR README.');
  process.exit(1);
}

// Importing the module (as the tests do) does not run the gate.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
