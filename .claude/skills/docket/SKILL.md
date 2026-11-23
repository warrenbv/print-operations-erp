---
name: docket
description: Find your next work item from the tracker (current sprint milestone, open and unassigned, priority-ordered), verify it is Ready, check nobody else has claimed it, and start it in a worktree with the branch pushed as the claim. Use when the user says "look at the docket", "what's next", "pick up work", or opens a session without naming a task.
disable-model-invocation: true
---

# Docket — find and start the next work item

> **In this edition.** This skill is kept as the agents ran it on the original project. It drives an issue tracker and a code platform through `glab`, and neither is part of this repository, so its commands and some of the scripts and guides it names do not exist here. It is set so that Claude does not start it by itself. Do not push branches or open merge requests from it.

Your work queue is defined by CLAUDE.md §10 and decision record 008
(`docs/decisions/008-operating-model-for-coding-agents.md`): the **open issues
in the current sprint milestone**, which the backlog leaves **unassigned** on
purpose. §3 orders them and §4a settles whether someone is already on one.
Never take an issue assigned to someone else (CLAUDE.md §10 rule 5).

## Headless, as triage phase 3

The intake service starts this skill as `/docket <iid> --owners <a,b>` when a
defect story reaches `triage:remediate`, or when an owner adds `agent:go`. That
session runs unattended on the triage machine under `--permission-mode
dontAsk`, so **there is nobody to answer a question**: each place below where the
skill says ask becomes one comment and a stop. `--owners` carries the tracker
usernames to mention; without the flag, mention the project owner and say the
flag was missing. Everything else runs as written — the claim is still a
worktree plus an immediately-pushed branch.

| Where the skill says ask                | Headless instead                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| §1a, a registered worktree looks stale  | Leave it alone and name it in your comment. An unattended session never deletes another session's worktree.                         |
| §3, the sprint is clear                 | The prompt names your issue, so §3's ordering does not run. If that issue is not in the current sprint, comment saying so and stop. |
| §4a, any hit on the collision check     | Comment naming the branch or MR you found, mention the owners, and stop — no branch, no worktree.                                   |
| §4a, a hit that may be a killed session | The same, and say which of the two it looks like so a person can answer in one word.                                                |

If the session has read-only diagnostic access, the `triage` skill's two rules
bind you too: nothing you write carries a row value, and an act on the running
system is a person's to do.

Four rules bind the unattended session:

- **Fails the Definition of Ready, or the spec contradicts itself: run
  `blocked`, then stop.** Never narrow the story to make it buildable
  (CLAUDE.md §10 rule 1). `blocked` ends by taking the next docket item; you
  do not — this session works the one issue it was given.
- **A defect story's trace to a requirement is the promise its triage comment
  cites** — the tour step or the spec line phase 1 quoted. That is what satisfies
  §4's trace; a defect story with no cited promise is not Ready.
- **A protected path stops the session.** If the fix would touch one
  (the change-control guide's table), comment what it would take, mention the
  owners, and stop without a branch. An unattended session does not open an
  orange MR.
- **Never mark the merge request ready.** Phase 3 opens a draft MR and stops. The command
  that would mark it ready is denied in every phase, so the tools cannot do it
  either. The owner reads the draft and clicks merge.

## 1. Preflight

```bash
git status          # must be clean — if not, run the wrap-up skill first
git switch main && git pull
glab auth status
```

If `glab` is missing or unauthenticated, **stop** and point the user to the
one-time setup in the platform setup guide. Do not fall back to guessing work
from the repo.

### 1a. Sweep abandoned worktrees

Active work lives in a worktree (§5), and that worktree is how another session
sees the item is taken. A worktree nobody retired therefore reads as a live
claim on an issue nobody is working on, so clear the dead ones **before** §4a
trusts the list:

```bash
git worktree prune                      # drops registrations whose directory is gone
git worktree list                       # the live set
ls .claude/worktrees/                   # the directories on disk
```

A directory in `.claude/worktrees/` that is **not** in `git worktree list` is
abandoned — it holds no `.git` file and git has forgotten it. Remove it:

```bash
rm -rf .claude/worktrees/<dir>
```

Do not assume `wrap-up` retired it. An agent that is killed, crashes, or has its
session closed never reaches wrap-up, and that is the common case rather than
the rare one — one sweep found the folder holding three directories implying
three active efforts. Two were husks from a killed session; the third was live
but named after an issue that had already merged while actually holding a
different one, because it had been reused. An agent trusting those names would
have read the first issue as taken and the second as free — both backwards.

If a directory is registered but you believe it is stale, **do not delete it** —
another session may be in it right now. Check liveness the way §4a does and ask
the user.

## 2. Resolve the current sprint

```bash
glab api "projects/:id/milestones?state=active&per_page=100"
```

Pick the milestone (titles are `Sprint N`) where `start_date <= today <=
due_date`. If none matches, say so — sprint planning hasn't happened; stop.

<!-- PICKUP RULE — the single swappable policy point; see decision record 008,
     decision 1. Swapped from assigned lanes to pick-freely + branch-claim.
     §4b and the git-workflow guide had described the new model for days while
     this section still queried @me — two agents reading different halves
     behaved differently. To change pickup policy again, replace ONLY this
     section and date the swap here. -->

## 3. Pickup rule (current policy: pick freely, claim by branch)

```bash
glab issue list --milestone "Sprint N" --state opened
```

The backlog is deliberately left unassigned — **the assignee field is not a
claim** (a stale assignment reads as taken and strands the item; one item sat
"claimed" for days with no branch, no worktree, no MR). What answers "is
someone on this?" is §4a's collision check, nothing else.

Order the result: label `Must` > `Should` > `Could`, then lowest story number.
Skip items labeled `blocked`. Take the top item. If the sprint is clear, say
so and ask the user (or the owner) whether to pull from the next sprint.

<!-- END PICKUP RULE -->

## 4. Definition-of-Ready check

Read the issue (`glab issue view <iid>`) against the definition of ready: clear
outcome, testable AC, traced to an epic or business rule, no open blocking
questions. **Fails DoR → run the `blocked` skill for it and return to step 3 for
the next item.**

## 4a. Collision check — is someone already on this?

**Run this before creating any worktree or branch.** The issue number leads every
worktree directory and every branch name, so three commands settle it:

```bash
git worktree list                         # a session on THIS machine, working now
git ls-remote --heads origin "*<iid>*"    # a claim from ANY clone, including another dev's
glab mr list --search "<iid>"             # or an open MR
```

The three cover different ground and you need all three. A worktree is
**local** — it lives on one filesystem and is never pushed, so it says nothing
about what another dev's machine is doing. The **pushed branch** is the only
signal that crosses machines, which is why §5 pushes it at claim time rather
than at wrap-up.

**Any hit → stop and ask the user.** Do not start a parallel implementation.
Options are: pick up where that branch left off, review it, or take a different
docket item — all of which are better than building the same thing twice.

Bring evidence rather than just the hit, because "claimed" and "abandoned" look
identical from the outside:

```bash
git log -1 --format="%h %ad %an %s" --date=relative origin/<branch>
glab mr list --search "<iid>" --state all
```

A branch last touched an hour ago with an open Draft MR is live work. One from
last week with no MR is probably a killed session — still stop and ask, but say
which of the two you are looking at so the user can answer in one word.

Why this is a hard step rather than a nicety: three collisions once happened
inside forty minutes between concurrent sessions — the same conflict-marker fix
twice (two MRs, byte-identical output), and two full independent
implementations of one story, each with its own migration under the same number
and its own `_journal.json` row, so merging one made the other's journal entry
conflict. Both were caught only at review.

## 4b. Note the claim on the issue

The worktree and the pushed branch in §5 are what make the claim **visible** —
that is the mechanism, and it works whether or not anyone is assigned. This step
is the human-readable half: a comment on the issue, so a person scanning the
tracker sees it without running git commands.

<!-- Reconciled after the pickup swap: this section still described
     self-assignment as the claim after §3 swapped to pick-freely — the exact
     two-agents-reading-different-halves problem the swap existed to fix, one
     section later. Caught by a session reading §3 and §4b together. -->

The claim is the **pushed branch** (§5 pushes it before any code), never the
assignee field — the backlog is deliberately unassigned (§3), and an assignee
with no branch is exactly the stale signal that strands items (one sat
"assigned" for days with no branch, no worktree, no MR, and read as taken).
Right after pushing the claim branch:

```bash
glab issue note <iid> --message "Starting this — branch <type>/<iid>-<slug>."
```

Do **not** self-assign as the claim. One story was built twice because nothing
visible claimed it — what prevents that now is the branch §4a checks for, plus
this note for the human scanning the tracker.

If there is no issue at all — an opportunistic fix nobody filed — **raise a
one-line issue first**, then branch and note it. An unticketed fix cannot be
claimed, and that is exactly how the conflict-marker fix got done twice.

Assigning an issue to _someone else_, or reassigning theirs, is a
sprint-planning act and is not yours to do (CLAUDE.md §10 rule 5). The owner
assigning work **to you** is direction, not a claim you made — you still push
the branch and note it when you start.

**Note:** Self-assignment marks _what you are on right now_ — it is not a way to
reserve a queue. The backlog is deliberately left unassigned so both devs can
pick freely from the top of the pile, so do not assign yourself work you are not
about to start. Infrastructure issues are another developer's lane; leave them
alone.

## 5. Start — claim it in the open

Work in a **worktree**, not by switching the shared tree. Two sessions launched
in the same directory share one HEAD and one staging area: a concurrent session
once switched branches mid-session and another session's commit landed on it
without any error. A worktree gives each session its own tree, and its own
entry in `git worktree list` for §4a to find.

The issue number **leads both the directory and the branch**, so the claim
self-identifies and the two cannot drift apart:

```bash
git worktree add .claude/worktrees/<iid>-<short-slug> -b <type>/<iid>-<short-slug>
cd .claude/worktrees/<iid>-<short-slug>
git push -u origin <type>/<iid>-<short-slug>     # ← the claim. Do this NOW, not at wrap-up.
glab issue note <iid> --message "Picked up — branch <type>/<iid>-<short-slug>."
```

**Push before you write a line of code.** The branch is empty at this point and
that is fine — a branch pointer at `main`'s tip is a valid claim. It is also the
_only_ claim another dev's clone can see, because worktrees are local and never
pushed. Pushing at wrap-up instead means §4a's `git ls-remote` check finds
nothing during the entire window when the collision could actually happen, which
is how a story got built twice.

(If §4b already commented, that _was_ this comment — don't post it twice.)

Then set the worktree up to build. Both of these have cost a session already:

```bash
pnpm install                                     # a worktree has no node_modules
export TURBO_CACHE_DIR=.turbo-cache              # else the build reuses the main checkout's dist
```

Finish the item with the `wrap-up` skill, which retires the worktree. If you
are killed before that, the next session's §1a sweep cleans up after you.

Restate the acceptance criteria to the user in one or two sentences, then begin
the work. Follow `CLAUDE.md` throughout; finish the session with the `wrap-up`
skill. If anything blocks you mid-item, use the `blocked` skill — never narrow
the spec to get unblocked.
