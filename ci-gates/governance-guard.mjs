#!/usr/bin/env node
// governance-guard: the merge gate for governance-protected paths.
//
// A merge request that changes a protected path (the agent rules, decision
// records, requirements, the pipeline, these gates) needs a governance owner
// behind it. The guard returns one of three verdicts:
//   pass  exit 0  nothing protected changed, an owner approved, an owner wrote
//                 it without agent help, or an owner pinned the head by note
//   warn  exit 3  an owner is the author but the branch carries an AI
//                 co-author trailer. The pipeline marks exit 3 as allowed to
//                 fail, so the job shows as a warning at the merge button
//   fail  exit 1  anything else, including missing configuration or API errors
// It exists so that an agent working under the owner's account cannot change
// the rules it works under without a human seeing it before the merge.
//
// The decision rules are exported as pure functions for the tests. main() only
// gathers inputs from git and the merge-request API.
//
// Environment:
//   CI_MERGE_REQUEST_DIFF_BASE_SHA  diff base, set on merge-request pipelines
//   GOVERNANCE_OWNERS               comma-separated owner usernames
//   GUARD_TOKEN                     read-only API token
//   GUARD_DRY_RUN=1                 skip the API, author = GUARD_DRY_RUN_AUTHOR
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PROTECTED = [
  'CLAUDE.md',
  'docs/charter/**',
  'docs/decisions/**',
  'docs/requirements/**',
  'docs/backlog/**',
  'tools/project-plan/backlog.py',
  'pipeline.yml',
  '.forge/**',
  '.claude/**',
  'scripts/ci/**',
];

// A `/**` rule matches by directory prefix including the slash, so a rule for a
// subfolder never covers its parent folder. Other rules match exactly.
export const isProtected = (path) =>
  PROTECTED.some((rule) =>
    rule.endsWith('/**') ? path.startsWith(rule.slice(0, -2)) : path === rule,
  );

// Only a Co-Authored-By line counts, so prose that mentions the assistant does
// not. The vendor name is matched as well as the model name because model
// names change between releases.
export function hasAgentTrailer(commitMessages) {
  return commitMessages.some((message) =>
    /^co-authored-by:.*\b(claude|anthropic)\b/im.test(message),
  );
}

// Returns the owner whose note approves this exact head, or null. The note must
// name at least 8 hex characters of the current head commit, so any new push
// makes an earlier note stop matching.
export function findApprovalNote(notes, owners, headSha) {
  const pattern = /governance:\s*approved\s+([0-9a-f]{8,40})\b/i;
  const head = (headSha ?? '').toLowerCase();
  for (const note of notes) {
    const author = note.author?.username ?? '';
    if (!owners.includes(author)) continue;
    const match = pattern.exec(note.body ?? '');
    if (match && head.startsWith(match[1].toLowerCase())) return author;
  }
  return null;
}

// The policy. Order matters: a formal owner approval passes whatever the
// trailer says. The trailer only affects the owner-author shortcut, and only
// softens it to a warning. A non-owner author without approval fails with or
// without a trailer.
export function decide({ touched, author, owners, approvers, agentAssisted, approvalNoteBy }) {
  if (touched.length === 0) {
    return { verdict: 'pass', reason: 'no governance-protected paths changed.' };
  }
  const approvingOwner = approvers.find((name) => owners.includes(name));
  if (approvingOwner) {
    return { verdict: 'pass', reason: `approved by governance owner '${approvingOwner}'.` };
  }
  if (!agentAssisted && owners.includes(author)) {
    return { verdict: 'pass', reason: `MR author '${author}' is a governance owner.` };
  }
  if (agentAssisted && approvalNoteBy) {
    return {
      verdict: 'pass',
      reason: `agent-assisted MR: governance owner '${approvalNoteBy}' cleared the warning for this head by note.`,
    };
  }
  if (agentAssisted && owners.includes(author)) {
    return { verdict: 'warn' };
  }
  return { verdict: 'fail' };
}

const fail = (message) => {
  console.error(`\n✖ governance-guard: ${message}`);
  process.exit(1);
};

async function main() {
  const dryRun = process.env.GUARD_DRY_RUN === '1';
  const base = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
  if (!base) fail('CI_MERGE_REQUEST_DIFF_BASE_SHA is not set (not an MR pipeline?).');

  const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  const touched = changed.filter(isProtected);
  if (touched.length === 0) {
    console.log('✔ governance-guard: no governance-protected paths changed.');
    process.exit(0);
  }

  console.log('Governance-protected paths changed in this MR:');
  for (const path of touched) console.log(`  - ${path}`);

  // First-parent and no merges: only the branch's own commits count, not
  // agent commits that arrived by merging the main branch in.
  const commitMessages = execFileSync(
    'git',
    ['log', '--first-parent', '--no-merges', '--format=%B%x00', `${base}..HEAD`],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter((message) => message.trim() !== '');
  const agentAssisted = hasAgentTrailer(commitMessages);
  if (agentAssisted) {
    console.log(
      'Agent-assisted commits detected (Co-Authored-By trailer) — the owner-author fast path is off.',
    );
  }

  const owners = (process.env.GOVERNANCE_OWNERS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  let author;
  let approvers;
  let approvalNoteBy = null;
  let headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  if (dryRun) {
    author = process.env.GUARD_DRY_RUN_AUTHOR ?? '';
    approvers = [];
    console.log(`(dry run: author='${author}', approvals and notes treated as empty)`);
  } else {
    // Protected paths changed, so a missing or broken check fails closed.
    if (owners.length === 0) fail('GOVERNANCE_OWNERS CI variable is missing or empty.');
    if (!process.env.GUARD_TOKEN) fail('GUARD_TOKEN CI variable is missing.');

    const api = async (path) => {
      const url = `${process.env.CI_API_V4_URL}/projects/${process.env.CI_PROJECT_ID}${path}`;
      const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': process.env.GUARD_TOKEN } });
      if (!res.ok) fail(`GitLab API ${path} returned ${res.status} — failing closed.`);
      return res.json();
    };

    const iid = process.env.CI_MERGE_REQUEST_IID;
    const mr = await api(`/merge_requests/${iid}`);
    author = mr.author?.username ?? '';
    if (mr.sha) headSha = mr.sha;
    const approvals = await api(`/merge_requests/${iid}/approvals`);
    approvers = (approvals.approved_by ?? []).map((entry) => entry.user?.username).filter(Boolean);

    if (agentAssisted) {
      // Newest notes first: the approval note follows the final review, so it
      // is recent, and system notes would otherwise fill the page.
      const notes = await api(
        `/merge_requests/${iid}/notes?per_page=100&order_by=created_at&sort=desc`,
      );
      approvalNoteBy = findApprovalNote(notes, owners, headSha);
    }
  }

  const verdict = decide({ touched, author, owners, approvers, agentAssisted, approvalNoteBy });
  if (verdict.verdict === 'pass') {
    console.log(`✔ governance-guard: ${verdict.reason}`);
    process.exit(0);
  }

  if (verdict.verdict === 'warn') {
    const agentSubjects = commitMessages
      .filter((message) => hasAgentTrailer([message]))
      .map((message) => message.split('\n')[0]);
    console.log(
      `\n⚠ governance-guard: agent-assisted commits touch governance-protected paths.\n` +
        `  Nothing is blocked — this warning exists so the merge click is informed\n` +
        `  (the merge click is the human act, see the change-control policy).\n` +
        `  Agent commits:\n` +
        agentSubjects.map((subject) => `    - ${subject}`).join('\n') +
        `\n  If this change was not explicitly directed by the owner, do NOT merge —\n` +
        `  that is the protected-path rule in CLAUDE.md failing, not working.\n` +
        `  Optional: a comment 'governance: approved ${headSha.slice(0, 12)}' by a\n` +
        `  governance owner turns this job green on retry. Agents never post it.`,
    );
    // The pipeline allows exit code 3 to fail, which shows as a warning.
    process.exit(3);
  }

  fail(
    `this MR changes governance-protected paths and has no governance-owner approval.\n` +
      `  Get approval from a governance owner (${owners.join(', ') || 'see the change-control policy'}),\n` +
      `  then re-run this job (Retry on the job page).\n` +
      `  Blocked ≠ re-spec: if a spec seems wrong, raise an open decision instead of changing it.\n` +
      `  See the change-control policy.`,
  );
}

// Importing the module (as the tests do) does not run the gate.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
