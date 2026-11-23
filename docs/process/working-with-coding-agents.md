# Working with coding agents

Coding agents wrote most of the Print Operations ERP's code. Warren Vogel set the scope, the business rules and the architecture direction, directed the agents, reviewed their work and kept the acceptance decisions. Colleagues also contributed code. This page describes the operating model in practice. The decision behind it is [record 008](../decisions/008-operating-model-for-coding-agents.md).

## How work was scoped

Scope lived in one backlog file of epics and costed stories, each with acceptance criteria. At first Warren assigned each developer a module lane at sprint planning. About four weeks in, the pickup rule changed. A session took the top ready item in the sprint and claimed it by pushing a branch straight away, after checking that no other branch or open merge request already held that work.

Development agents took their tasks from an orchestrator session. An agent worked to four gates and stopped at each one for a reply:

1. **Scope.** What it will build, the tables, ports, API and screens, the tests, every decision it made alone, and every question for the owner. If the story failed the definition of ready, it said so here.
2. **Pre-commit.** Local checks passed, with counts.
3. **Merge request open.** Pushed, pipeline running.
4. **Wrap-up.** Status note on the issue, workspace cleaned up.

## What agents worked under

Two documents governed every session. A working constitution covered module boundaries, docs and code changing together, decision records for anything architectural, and never committing secrets or customer data. An agent brief held operational rules, each with the date it was learned, because almost every one existed because something had gone wrong first.

## What gated a merge

- Formatting, lint, type checks, the full test suite and a docs-integrity check, run locally with exit codes reported. The brief required counts, not adjectives, and a report had to confirm zero skipped tests, because database suites skip silently without a database.
- The same checks in CI, after rebasing on the main branch and re-running, because two branches that were each green had once broken the main branch together.
- A change-control job on protected paths: decision records, the charter, requirements, the backlog, agent configuration and CI.
- A human merge. Agents never merged.

## What stayed a human decision

Business rules, scope and acceptance criteria. Accepting a decision record. Any change to a protected path. The merge. When an agent was blocked, it did not narrow the requirement to get unblocked. It asked, either its orchestrator or Warren directly, with the options and a recommendation. The ruling was recorded on the issue or merge request.

## Failures that became rules

**Adapters that disagreed.** Each port had an in-memory adapter for tests and a PostgreSQL adapter for production. In one day this produced four defects, three of which reached the main branch. For example, a duplicate key answered 500 instead of 409. Every one passed its unit tests, because the in-memory adapter never touched a driver or a constraint. The rule became that a port's promises are tested in a contract suite run against every adapter, and the definition of done requires it.

**A shared stash.** Several agents worked in parallel git worktrees on one machine. Git keeps one stash list for the whole repository. When three paused lanes were told to move their work with stash and pop, one lane's pop took another lane's 13 files. Nothing was lost because each lane had written a backup patch first. A hook now refuses any stash command that changes the list, and work moves as a patch file instead.

## In this edition

The agent instructions are [`CLAUDE.md`](../../CLAUDE.md) at the repository root. The permission policy, the skills and the stash hook are in [`.claude/`](../../.claude/). The change-control job is [`ci-gates/governance-guard.mjs`](../../ci-gates/governance-guard.mjs). The contract suites sit beside each module's tests, for example [`modules/orders/test/contracts/`](../../modules/orders/test/contracts/), and [`modules/orders/test/repository-contracts.test.ts`](../../modules/orders/test/repository-contracts.test.ts) runs that module's suite against both adapters.
