# Agent configuration

These are the files the coding agents on the Print Operations ERP worked under. They are adapted from the originals for publication. Agents drafted most of the text under Warren Vogel's direction. He decided the rules.

The instructions file is [`CLAUDE.md`](../CLAUDE.md) at the repository root. The rest is in this folder.

## How the pieces fit

The instructions file sets the rules. The permission policy enforces the ones a tool can enforce mechanically. The skills carry the workflows an agent repeats. The hook blocks one specific failure.

## The pieces

**[`CLAUDE.md`](../CLAUDE.md)** is the working constitution, read at the start of every session. It sets module boundaries, docs changing with code, and five binding limits on agent authority: never narrow scope to get unblocked, touch protected paths only on human direction, never accept your own decision record, never merge, and never touch others' assignments.

**[`.claude/settings.json`](settings.json)** is the permission policy, applied to every tool call. Read-only tracker commands run freely. Edits to protected paths ask a person first. Merging and reading `.env` files are denied. It also registers the hook.

**[`.claude/skills/`](skills/)** holds four workflows that drive the issue tracker.

- [`docket`](skills/docket/SKILL.md) runs when a session starts without a named task. It finds the next ready item, checks nobody holds it, and claims it with a pushed branch.
- [`blocked`](skills/blocked/SKILL.md) runs when an item cannot proceed. The agent asks a person, with options and a recommendation, and records the answer.
- [`wrap-up`](skills/wrap-up/SKILL.md) ends a session. It runs the gates, opens a draft merge request and writes the handoff.
- [`triage`](skills/triage/SKILL.md) runs unattended on an emailed defect report and turns it into a story. It never writes code.

The skills call `glab`, the command-line client for the self-hosted code platform the project used. The commands are kept as written.

**[`.claude/hooks/refuse-git-stash.mjs`](hooks/refuse-git-stash.mjs)** runs before every shell command. Parallel agents worked in separate worktrees of one repository, and git keeps one stash list for all of them, so one agent's stash pop could take another agent's uncommitted work. The hook refuses any stash command that changes the list and points to a patch route instead. Its tests are in [`hooks/refuse-git-stash.test.mjs`](hooks/refuse-git-stash.test.mjs).

## What works in this repository

Open this repository with Claude Code and three pieces apply as they stand. Claude Code loads `CLAUDE.md` at the root. It applies the permission policy in `.claude/settings.json`. It runs the hook, which the policy registers as `${CLAUDE_PROJECT_DIR}/.claude/hooks/refuse-git-stash.mjs`, before every Bash or PowerShell call.

The skills are here to show how the original project ran. Their workflows depend on an issue tracker and a code platform that are not part of this edition, and every `glab` command in them needs that platform. Each skill is therefore marked `disable-model-invocation: true`, so Claude does not start one by itself, and each opens with a note saying so. On the original project Claude could start them.

## Protected paths

The permission policy's ask list and the merge gate's list in [`ci-gates/governance-guard.mjs`](../ci-gates/governance-guard.mjs) name protected paths from the original repository's layout, renamed for publication. The lists are kept as they are, so some of their paths do not exist in this edition. The equivalents here:

| The lists name | In this repository |
| --- | --- |
| `CLAUDE.md`, `.claude/**` | the same paths |
| `docs/decisions/**` | the same path, [`docs/decisions/`](../docs/decisions/), the decision records |
| `docs/requirements/**` | [`docs/product/requirements.md`](../docs/product/requirements.md) |
| `pipeline.yml` | [`.github/workflows/`](../.github/workflows/), the hosted workflow |
| `scripts/ci/**` | [`ci-gates/`](../ci-gates/), the gates |
| `.forge/**` (the code platform's folder, which held its issue and merge request templates), `docs/charter/**`, `docs/backlog/**`, `tools/project-plan/backlog.py` | not in this edition |

Nothing enforces these lists on merge here. The merge gate ran in the original project's pipeline, and the workflow in this repository runs its tests, not the gate.

## What changed for publication

- The employer, colleagues, hosts, production access, original document paths, tracker numbers and dated incident accounts were removed or made neutral. References to documents outside this repository are now generic or point to `docs/decisions/` and `docs/process/`.
- `CLAUDE.md` opens with a note on this edition, and its map of the tree, its commands and its links are corrected for this repository.
- `CLAUDE.md` states the comment convention this repository applies, in §7.

## Known limits

- The policy's ask list predates the hook and does not cover `.claude/hooks/`. The merge gate does, because it protects all of `.claude/`.
- The deny list is a backstop. A command that is not on the allow list is not run silently in an interactive session. It asks a person. The human merge and the merge gate were the real controls on what reached the main branch.
- Path names in the policy were renamed for publication, in step with the merge gate's list in `ci-gates/governance-guard.mjs`.

## Location

The files sit where the agents loaded them: `CLAUDE.md` at the repository root and the rest in `.claude/`, beside the application code they governed.
