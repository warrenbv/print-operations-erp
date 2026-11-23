// Tests for the merge gate's decision rules. They import the rules from the
// script itself, so the tests and the gate cannot drift apart. Usernames,
// paths and commit subjects are fictional.
import { describe, expect, it } from 'vitest';

import { decide, findApprovalNote, hasAgentTrailer, isProtected } from './governance-guard.mjs';

const OWNERS = ['owner'];

describe('isProtected', () => {
  it('matches exact-file rules exactly', () => {
    expect(isProtected('CLAUDE.md')).toBe(true);
    expect(isProtected('tools/project-plan/backlog.py')).toBe(true);
    expect(isProtected('CLAUDE.md.orig')).toBe(false);
  });

  it('matches directory globs by prefix, on the directory boundary', () => {
    expect(isProtected('.claude/settings.json')).toBe(true);
    expect(isProtected('scripts/ci/governance-guard.mjs')).toBe(true);
    expect(isProtected('docs/decisions/0001-example.md')).toBe(true);
    // A directory rule must not cover its parent's other files.
    expect(isProtected('scripts/check-migrations.mjs')).toBe(false);
  });

  it('leaves the escalation valve unguarded — raising an open decision must stay frictionless', () => {
    expect(isProtected('docs/registers/decision-log.md')).toBe(false);
  });

  it('ignores ordinary source paths', () => {
    expect(isProtected('modules/orders/src/order-service.ts')).toBe(false);
    expect(isProtected('docs/process/change-policy.md')).toBe(false);
  });
});

describe('hasAgentTrailer', () => {
  it('recognises the trailers this repo actually emits', () => {
    // Two model spellings of the trailer, as they appeared in the project.
    expect(
      hasAgentTrailer([
        'feat(orders): a Shipment aggregate\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.example>',
      ]),
    ).toBe(true);
    expect(
      hasAgentTrailer([
        'fix(tooling): x\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.example>',
      ]),
    ).toBe(true);
  });

  it('matches on the vendor when the model name changes again', () => {
    expect(
      hasAgentTrailer(['chore: x\n\nCo-Authored-By: Assistant <noreply@anthropic.example>']),
    ).toBe(true);
  });

  it('does not flag human co-authors', () => {
    expect(
      hasAgentTrailer(['feat: pair work\n\nCo-Authored-By: Sam Example <sam@example.com>']),
    ).toBe(false);
  });

  it('does not flag prose that mentions Claude outside a trailer line', () => {
    expect(hasAgentTrailer(['docs: describe how Claude sessions claim work'])).toBe(false);
  });

  it('finds a trailer anywhere in the commit list, and handles the empty list', () => {
    const human = 'fix: human commit';
    const agent = 'fix: agent commit\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.example>';
    expect(hasAgentTrailer([human, agent, human])).toBe(true);
    expect(hasAgentTrailer([])).toBe(false);
  });
});

describe('findApprovalNote', () => {
  const HEAD = 'a5ce192f00112233445566778899aabbccddeeff';
  const note = (username, body) => ({ author: { username }, body });

  it('accepts an owner note pinning the full head SHA', () => {
    expect(findApprovalNote([note('owner', `governance: approved ${HEAD}`)], OWNERS, HEAD)).toBe(
      'owner',
    );
  });

  it('accepts an 8+ character prefix — what the merge request page shows', () => {
    expect(findApprovalNote([note('owner', 'governance: approved a5ce192f')], OWNERS, HEAD)).toBe(
      'owner',
    );
    expect(
      findApprovalNote([note('owner', 'governance: approved A5CE192F0011')], OWNERS, HEAD),
    ).toBe('owner');
  });

  it('rejects a prefix shorter than 8 characters — too easy to guess-match', () => {
    expect(
      findApprovalNote([note('owner', 'governance: approved a5ce192')], OWNERS, HEAD),
    ).toBeNull();
  });

  it('rejects a note pinning a different SHA — the stale-approval loophole, closed', () => {
    expect(
      findApprovalNote([note('owner', 'governance: approved deadbeef00')], OWNERS, HEAD),
    ).toBeNull();
  });

  it('ignores the right words from the wrong author', () => {
    expect(
      findApprovalNote([note('contributor', `governance: approved ${HEAD}`)], OWNERS, HEAD),
    ).toBeNull();
  });

  it('skips unrelated notes and finds the approval among them', () => {
    const notes = [
      note('owner', 'looks good overall, one question inline'),
      note('reviewer', 'added a test for the retry path'),
      note('owner', `governance: approved ${HEAD.slice(0, 12)}`),
    ];
    expect(findApprovalNote(notes, OWNERS, HEAD)).toBe('owner');
  });

  it('handles malformed notes without throwing', () => {
    const notes = [
      { author: {}, body: undefined },
      { body: 'governance: approved' },
      note('owner', ''),
    ];
    expect(findApprovalNote(notes, OWNERS, HEAD)).toBeNull();
  });
});

describe('decide', () => {
  const base = {
    touched: ['CLAUDE.md'],
    author: 'owner',
    owners: OWNERS,
    approvers: [],
    agentAssisted: false,
    approvalNoteBy: null,
  };

  it('passes untouched MRs without looking at anything else', () => {
    expect(decide({ ...base, touched: [], author: '', owners: [] }).verdict).toBe('pass');
  });

  it('passes a human-authored MR from a governance owner — the owner is the authority', () => {
    expect(decide(base).verdict).toBe('pass');
  });

  it('fails a non-owner human MR with no approval', () => {
    expect(decide({ ...base, author: 'contributor' }).verdict).toBe('fail');
  });

  it('passes a non-owner human MR once a governance owner approves', () => {
    expect(decide({ ...base, author: 'contributor', approvers: ['owner'] }).verdict).toBe('pass');
  });

  it('ignores approvals from non-owners', () => {
    expect(decide({ ...base, author: 'contributor', approvers: ['reviewer'] }).verdict).toBe(
      'fail',
    );
  });

  it('WARNS instead of fast-passing when an owner-authored MR is agent-assisted', () => {
    // Same author and paths: the trailer alone turns a silent pass into a warning.
    expect(decide({ ...base, agentAssisted: true }).verdict).toBe('warn');
  });

  it('never blocks on the trailer alone — warn is the ceiling for an owner author', () => {
    expect(decide({ ...base, agentAssisted: true }).verdict).not.toBe('fail');
  });

  it('turns the warning green once an owner pins the head SHA by note', () => {
    expect(decide({ ...base, agentAssisted: true, approvalNoteBy: 'owner' }).verdict).toBe('pass');
  });

  it('accepts a formal approval on an agent-assisted MR — a second owner outranks the note', () => {
    expect(decide({ ...base, agentAssisted: true, approvers: ['owner'] }).verdict).toBe('pass');
  });

  it('still HARD-fails a non-owner MR with a trailer — the tripwire never weakens the working gate', () => {
    expect(decide({ ...base, author: 'contributor', agentAssisted: true }).verdict).toBe('fail');
  });
});
