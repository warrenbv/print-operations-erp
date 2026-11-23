---
name: wrap-up
description: End-of-session hygiene and the handoff in one act — run the local gates, commit and push, open or update the draft MR, comment status on the issue, close the parent feature or epic when this was its last story, retire the worktree that was holding the claim, leave a clean tree, and write the handoff the next session starts from. Use when the user says "wrap up", "end session" or "hand off", when parking blocked work, or when a work item is finished.
disable-model-invocation: true
---

# Wrap-up — leave the work in a state anyone can pick up

> **In this edition.** This skill is kept as the agents ran it on the original project. It drives an issue tracker and a code platform through `glab`, and neither is part of this repository, so its commands and some of the scripts and guides it names do not exist here. It is set so that Claude does not start it by itself. Do not push branches or open merge requests from it.

A wrap-up is also the handoff. The two used to be separate acts, and the
handoff was the one that got done while the wrap-up's own steps were skipped:
two parent features stayed open for five weeks after their last story merged,
and an orchestrator recommended building them again. Every section below runs
every time; §7 is where the handoff is written, and it is not optional.

## 1. Run the local gates

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

Report the results **honestly** (one of the project's operating principles). Red
gates are not a reason to skip the wrap-up — they're a reason the merge request stays a
Draft.

**Then the documentation check** (CLAUDE.md §6): if the branch touches
`modules/<name>/src` or `apps/<name>/src`, the matching `README.md` is updated
in the same MR and the code commit carries a `Docs-Verified: <dir>, <dir>`
trailer naming every page it was re-read against — or the §4 status note says
exactly why not. **No stamp line is written into a README:** one line per page
meant every open MR rewrote the same line, so the first to merge conflicted all
the rest. Run `pnpm docs:freshness` and report what it says. A docs page that
gained a link or a new file also passes the documentation link check in
`scripts/ci/` with the files staged (it scans `git ls-files`).

## 2. Commit and push

Conventional Commit (the git-workflow guide — commitlint enforces the format),
with the issue referenced in the subject line:

```
<type>(<scope>): <imperative summary> (#<iid>)
```

Then `git push -u origin <branch>`.

## 3. Open or update the merge request

```bash
glab mr create --fill --draft   # first push; the platform applies the default template
```

- Fill the template's DoD checklist **truthfully** — an unchecked box with a
  note beats a dishonest tick (`docs/process/definition-of-done.md`).
- Mark ready (`glab mr update <iid> --ready`) only when the gates pass and the
  DoD self-check is genuine.
- **Never merge** — a human merges after review approval (the change-control
  guide). If the merge request touches governance-protected paths, say so in the merge request
  description and expect the change-control job to hold it for owner
  approval.

## 4. Status note on the issue, and the parent it belongs to

```bash
glab issue note <iid> --message "<status>"
```

One short comment: what's done, what remains, the next concrete step. This is
what lets any dev (or session) resume the item cold.

**Then look up.** A story belongs to a parent: an epic (the epic label and the
"Parent epic" line of its description) or a feature issue whose description
lists its stories (`- [ ] #<iid> - …`). When this story's MR has merged, read
the parent's other stories:

```bash
glab api "projects/:id/issues?labels=<epic label>&state=opened"           # an epic's open stories
glab api "projects/:id/issues?iids[]=<iid>&iids[]=<iid>&iids[]=<iid>"     # a feature's listed stories
```

If every one is closed, close the parent with a dated note naming the MRs
(`glab issue close <parent> ` after `glab issue note <parent> --message "…"`).
If one is still open, say in the status note which one holds the parent open.
A parent left open reads as unbuilt work in the backlog, and the next person
plans or builds it again; closing it is the wrap-up's job, not a sprint
planner's.

## 5. Retire the worktree

The worktree `docket` §5 created is a **claim** — while it exists, §4a reads the
issue as actively being worked. Retire it once the merge request is open, so the next
session does not treat finished work as taken:

```bash
cd <the main checkout>
node scripts/worktree/retire.mjs <iid>-<short-slug>
```

The script deletes the directory with `fs.rmSync`, drops git's registration of
that one entry, and deletes the local branch, printing a line per step. It
refuses a dirty tree and a head that is not on `origin/main`; `--unmerged`
overrides the second when the item is finished but unmerged on purpose,
`--husk` deletes a directory git has already forgotten, and `--dry-run` shows
the plan. Two commands it replaces, and why:

- `git worktree remove` **fails on a platform with a short path limit once
  `node_modules` is present** (`Filename too long`) after removing the
  registration, so the directory survives while `git worktree list` and
  `git worktree prune` have both forgotten it: the husk state §1a has to clean
  up, and `--husk` is for.
- `rm -rf` on a worktree **follows the links pnpm leaves in `node_modules`**
  and deletes the store behind them.

**Keep the worktree** if the item is parked rather than finished (blocked, or
work continues next session) — that is a live claim and should keep reading as
one. Say so in the §4 status note.

Leaving the branch pushed is not optional either way: it is what tells another
dev's clone the issue is spoken for, and it outlives the worktree.

## 6. Leave it clean

`git status` must be clean, with the branch pushed. Tell the user in one or
two sentences where the item stands and what happens next (review, guard
approval, or the next docket item).

## 7. Hand off, in the same act

The handoff is what the next session reads first, so it is written last, from
the state §1 to §6 left, as if this session dies the moment it is saved. It is
never a page in this repository and never a merge request (project owner's
ruling): a handoff page on `main` was dead the day it merged, because every
session after it rewrote the facts somewhere else.

**A lane** (one issue, one worktree) hands off with its §4 status note: the
MR, the pipeline, the gate counts, what is left, and whether the worktree is a
live claim. That note is the whole handoff.

**An orchestrator** (a session running lanes, or working the docket for a day)
writes one block at the top of its project-status memory, newest first, headed
`START HERE` with the date, time and session id, and keeps durable copies of
the session's files (the lane sheet, the briefs, the addendum, the lock runner)
in the day's folder of the workspace beside the repository. The block states,
in this order:

1. `main`'s sha and whether the main checkout is fast-forwarded and clean.
2. Every MR of the session: merged, ready, or draft, with the pipeline state
   and what blocks a draft.
3. Every worktree alive, which are claims and which are to be retired after
   which merge.
4. Every lane alive, at which gate, waiting on what; and every lane that is
   done.
5. The local Postgres: up (who started it) or down, and whether to restart it.
6. The owner's open calls, as questions in plain words with the recommendation
   first, and the rulings made from the record that he can overrule.
7. Parents to close and issues to file that wait on the owner's word.
8. What the next session does first.

Re-read the memory file immediately before writing it and prepend; another
session may have written since. Then say in one line where the handoff is.
