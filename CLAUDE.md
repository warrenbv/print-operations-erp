# CLAUDE.md — Working Constitution for this Repository

This file governs how Claude (and any AI-assisted work) operates in this repo.
Read it before making changes. It is intentionally opinionated: this codebase is
meant to grow into our company's primary ERP over years, so consistency and
documented intent matter more than local cleverness.

**Human contributors:** your entry point is [`README.md`](README.md) and the
[docs index](docs/README.md). This file is the AI-facing operating manual, but the standards it
points to apply to everyone.

**This edition.** This is the instructions file the coding agents on the original
project worked under, adapted for publication. The rules are kept. This edition
has no issue tracker, merge-request pipeline or deployment, so rules that mention
them describe how the original project ran. The original project also kept
guides, registers and a glossary that are not published here. Where a rule names
one of them, it says so, and where this repository holds the equivalent, the text
links it. The map, the commands and the links are corrected for this tree.

---

## 1. What we are building

**Print Operations ERP**: a **bespoke, self-hosted ERP** for Demo Printworks, a
custom-printing business, replacing a hodgepodge of disconnected platforms
(bids, quotes, AR/AP, job sheets, CRM, inventory) with one internally-owned,
on-prem system used through a web browser on the local network.

**Strategy — build one line of business, then lift-and-shift:**

1. Build the complete order lifecycle (**intake → process → output**) for the
   first line of business: custom printing.
2. Prove it end-to-end, generalize the reusable pieces, then adapt the pattern to
   the company's other lines of business.

Every decision should be evaluated against the long game: _will this still make
sense when there are five lines of business and a dozen modules?_

This repository holds one journey of the first line of business, from quote to
confirmed order, with fictional data. Its rules are in
[`docs/product/requirements.md`](docs/product/requirements.md) (R1 to R12), and
what it leaves out is in
[`docs/product/scope-and-deferrals.md`](docs/product/scope-and-deferrals.md).

## 2. Non-negotiable guardrails

- **On-prem & no-cloud by default.** The system runs on our servers, reachable
  over the LAN. Do not introduce a required third-party cloud dependency without
  a decision record. Cloud is an explicit, justified exception — never a default.
- **Never commit secrets.** Only `*.example` env files are tracked. Real `.env`
  files are git-ignored. Do not paste credentials, customer data, or pricing into
  code, docs, commits, or any external service.
- **Docs-first, decision-logged.** Non-trivial architectural or cross-module
  decisions get a [decision record](docs/decisions/). If you change a convention,
  update the doc that describes it in the same change.
- **Respect module boundaries.** Business capabilities are separate modules
  (bounded contexts). They talk through explicit contracts in `packages/types`,
  not by reaching into each other's internals. A lint rule enforces it:
  [`packages/config/eslint/boundaries.mjs`](packages/config/eslint/boundaries.mjs).
- **Small, reviewable changes.** Prefer focused MRs that a teammate can review in
  one sitting. (The original project's code-review guide is not published.)
- **Protected paths are guarded.** Decision records, charter, requirements,
  `backlog.py`, this file, and the CI/agent config need a governance owner's
  approval to merge — a CI job enforces it. The job is
  [`ci-gates/governance-guard.mjs`](ci-gates/governance-guard.mjs). It ran in the
  original pipeline and does not run here. Its list names the original
  repository's paths, and [`.claude/README.md`](.claude/README.md) gives their
  equivalents in this tree. See
  [decision record 008](docs/decisions/008-operating-model-for-coding-agents.md)
  and §10.

## 3. Tech stack (the short version)

| Layer    | Choice                           | Notes                                       |
| -------- | -------------------------------- | ------------------------------------------- |
| Web      | Next.js / React (TS)             | `apps/web`                                  |
| API      | NestJS (Node / TS)               | `apps/api`                                  |
| Database | PostgreSQL                       | one instance, schema-per-module boundary    |
| Shared   | TypeScript packages              | `packages/*` — types, ui, config, db, utils |
| Monorepo | pnpm workspaces + Turborepo      |                                             |
| Deploy   | Docker Compose on a local server | original project, not in this edition       |

Full rationale: the [technology-stack record](docs/decisions/009-technology-stack.md) and the
[decision records](docs/decisions/). **One language end-to-end (TypeScript)** is
a deliberate choice — share types, don't duplicate them.

## 4. Where things live

```
apps/web             Next.js front end (the shell + module UIs)
apps/api             NestJS API (composes modules into deployable services)
modules/<name>       A bounded context: domain logic, data access, module API
packages/types       Shared domain contracts / DTOs (the cross-module lingua franca)
packages/ui          Shared React components
packages/config      Shared eslint/prettier/vitest presets
packages/db          Shared database plumbing: pool, migrator, ids, test databases
packages/utils       Small framework-agnostic helpers
infra/db/migrations  One folder of SQL migrations per module schema
docs/                Product documents, decision records, process pages
scripts/             Cross-platform Node (.mjs) helpers: demo launcher, test runners
tests/portfolio/     The browser journey through quote-to-order, launcher tests
ci-gates/            The original pipeline's gates, with their tests
.claude/             Permission policy, workflow skills, the stash hook
.github/workflows/   The hosted workflow that runs the checks
```

The shared TypeScript settings are `tsconfig.base.json` at the root. Each app,
module and package has a `README.md` at its root. The original repository also
had `tools/` (generators such as the project-plan spreadsheet) and compose files
and seeds under `infra/`. They are not part of this edition.

If you're unsure where something goes, it almost always belongs in a **module**
(business logic) or a **package** (shared, generic code) — not in `apps/`. Apps
wire modules together; they should stay thin.

## 5. How to add a new module (bounded context)

This is the repeatable unit of growth. When you add one (e.g. `inventory`,
`crm`, `ar-ap`, or the next line of business's variant):

1. Create `modules/<name>/` with its own `package.json`, `tsconfig.json`
   (extends `../../tsconfig.base.json`), `src/`, and `README.md`.
2. Define the module's public surface (types/DTOs) in `packages/types` — other
   modules and apps import from there, never from `modules/<name>/src` directly.
3. Keep the module's persistence isolated (its own schema/migrations under
   `infra/db`); do not cross-query another module's tables.
4. Add a bounded-context entry to the domain model overview and, if it owns a
   schema, its ERD to the context ERDs page. (Both pages belong to the original
   project's documentation and are not in this repository.)
5. If the module changes an architectural pattern, write a decision record.

> This recipe is proven — `identity`, `crm`, `quoting`, `orders`, `documents`
> and `notifications` all grew through it. Read a recent module's README and
> mirror its shape before adding the next one, for example
> [`modules/quoting/README.md`](modules/quoting/README.md).

## 6. Documentation & product workflow

- The **knowledge base** is in `docs/`, organised by concern: the charter (why),
  architecture (how it's built), product (what we're building & the plan),
  engineering (how we work), and domain (the business model), with an index
  page. In this edition the index is [`docs/README.md`](docs/README.md), and
  `docs/` holds the [product documents](docs/product/), the
  [decision records](docs/decisions/) and the [process pages](docs/process/).
  The charter, architecture, engineering and domain sections are not published.
- **Requirements** flow BRD → PRD → **costed stories in `backlog.py`** (per-story
  acceptance criteria), with decision records and the open-decisions register
  carrying detailed design decisions. The FRD tier was retired — none was ever
  written, and the story-plus-decision-record path is what this repo actually
  runs on. A standing caveat from the open-decisions register: backlog
  acceptance wording is a **summary, not the source**. Templates live with the
  requirements, and the first line of business's BRD/PRD beside them. In this
  repository the requirements are
  [`docs/product/requirements.md`](docs/product/requirements.md) and the design
  decisions are in [`docs/decisions/`](docs/decisions/). The BRD, PRD,
  templates, `backlog.py` and the open-decisions register are not published.
- **Diagrams are Mermaid in markdown** (process maps, C4, ERDs). They render in
  the code platform and diff cleanly — never paste binary diagram exports as the
  source of truth.
- **The ubiquitous language matters.** Use the exact terms from the glossary in
  code, tables, and docs. If a business term is missing, add it rather than
  inventing a synonym. The glossary is not in this repository. Here, use the
  terms the product documents and the code already use.
- **Docs are reference, not process.** They describe the architecture, how it
  works, and how to troubleshoot it. Process ceremony — who signs what, where a
  file is filed — is not documented.
- **The commit names the pages it was verified against.** Change a module's or
  an app's code, re-read its README in the same MR, and carry a
  `Docs-Verified: <dir>, <dir>` trailer on the code commit naming every page you
  read — edited in that same commit wherever the change made it false. Nothing
  is stamped into a README: a stamp is one line per page, so every MR open
  against the same app rewrote that one line and the first to merge conflicted
  all the rest, never over code. `pnpm docs:freshness` is how rot is found, and
  `wrap-up` runs it. In this repository the command is
  `node ci-gates/docs-freshness.mjs`, and it reports every page as never verified
  because this edition's history carries no such trailers. The stamp lines still
  on the pages are each page's starting point: leave them alone, and delete a
  page's line the next time you edit that page for content. The READMEs in this
  edition carry no stamp lines.
- **Recurring operational tasks get a runbook page**, one per task, indexed in
  the runbooks folder. This edition has no deployment and no runbooks.
- **An open question goes to a person first**. A lane
  puts it to its orchestrator at the next gate; a session with no orchestrator
  puts it to the project owner in the conversation — the question in plain
  words, the options in a line each, a recommendation first. The ruling is
  recorded where the work needs it: the issue, the merge request, a comment that cites the
  issue. The open-decisions register is where a question is **parked** when
  nobody in the session can answer it; it is never the way of asking. Either
  way, never a "TBD" or a callout on a page; a page that depends on a parked
  question cites its number.

## 7. Engineering conventions (summary — details in the engineering docs)

- **TypeScript strict everywhere.** No implicit `any`; honor
  `noUncheckedIndexedAccess`.
- **Naming:** files `kebab-case`; types/classes `PascalCase`; variables/functions
  `camelCase`; constants `SCREAMING_SNAKE_CASE`; DB tables/columns `snake_case`.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`), imperative mood, machine-checked by commitlint.
  Reference the tracker issue (`#<id>`). (The git-workflow guide, the commitlint
  setup and the tracker belong to the original project and are not in this
  edition.)
- **Branches:** `feat/<issue>-short-slug`, `fix/…`, `docs/…`. Trunk is `main`;
  integrate via merge requests.
- **Tests:** follow the testing strategy. A change isn't done until it meets the
  [Definition of Done](docs/process/definition-of-done.md). The strategy itself
  is not published. Its layers are described in
  [Verifying agent-written code](docs/process/verifying-agent-written-code.md).
- **Comments** say why, not what. A comment states one of four things: the
  purpose of a file or block, the rule it implements with its citation, where
  to look next, or a constraint a careful reader might otherwise "fix". Cite the
  rule instead of restating it, by its full path from the repository root: a
  requirement as `docs/product/requirements.md (R5)`, a decision as
  `docs/decisions/006-optimistic-concurrency.md`, code as
  `modules/quoting/src/ports.ts`. Cite only where the code implements or depends
  on the rule. A comment never carries history, dates, tracker or issue ids,
  people, companies, business figures such as prices or margins, task markers,
  or documents that are not in this repository. Match the comment density of
  the surrounding code. Most files need a short header and little else.
- **Every app, module and package has a `README.md`** at its root
  (`apps/*/README.md`, `modules/*/README.md`, `packages/*/README.md`). It states
  the responsibility, the public contract, the state it owns and any state
  machine, the rules it enforces with citations, where to start reading, and its
  tests. Keep it true in the same change as the code.
- **Don't break the boundary rules** in §2 and §5 for convenience.

## 8. Environment notes (the development machine)

- **Node 22 LTS + pnpm 10** — pinned via `packageManager` and provided by
  **corepack** (bundled with Node), so no global install is needed. You do need a
  real `pnpm` **on PATH**: `corepack pnpm <cmd>` covers pnpm itself but **not**
  anything Turborepo runs — `turbo` shells out to a bare `pnpm` and dies with
  `Unable to find package manager binary`, taking out `pnpm test`, `pnpm test:db`
  and `pnpm typecheck`. If plain `corepack enable` needs elevated rights,
  install its shims somewhere you own instead:
  `corepack enable --install-directory <a dir on PATH>`. Setup detail:
  [`README.md`](README.md).
- **The commands** (all from the repository root, defined in `package.json`):
  - `pnpm demo` builds and starts the web app and the API with fictional data in
    memory. `pnpm demo:build` and `pnpm demo:start` run its two halves.
  - `pnpm test` runs the launcher's test, the gate and hook tests, and every
    package's tests, with no database.
  - `pnpm test:db` starts a throwaway local PostgreSQL, runs the same package
    tests against it and removes it.
  - `pnpm test:portfolio` builds the demo and walks the quote-to-order journey
    in a browser.
  - `pnpm test:gates` runs only the gate and hook tests.
  - `pnpm typecheck`, `pnpm lint` and `pnpm format:check` are the static checks.
- **Docker is not installed yet.** Container-based dev/infra won't run until
  Docker is installed. The working database path is the repo's **embedded
  PostgreSQL**, which `pnpm test:db` starts for you. `DATABASE_URL`-gated tests
  skip without it, so run them through `pnpm test:db` and confirm **0 skipped**.
  Author compose/infra config anyway — it's the intended runtime. (This edition
  has no compose files and no deployment.)
- **Prefer cross-platform Node (`.mjs`) scripts** over shell-specific ones.
- **git identity** is set repo-locally (not globally) — keep commits attributed
  correctly.
- **glab CLI** talks to the project's self-hosted code platform (issues, MRs) —
  per-developer setup is in the platform setup guide. The platform, its setup
  guide and the tracker are not part of this edition, so the skills that call
  `glab` describe the original workflow.

## 9. How Claude should work here

- **Read the agent brief before your first change** — the gate protocol, the
  claim ritual, and the traps this repo has already paid for, each with the date
  it was learned. (The brief is not in this repository.
  [Working with coding agents](docs/process/working-with-coding-agents.md)
  summarises it.)
- **Understand before changing.** Read the relevant `docs/` section and any
  affected module's README first. Reuse existing patterns and shared code before
  writing new.
- **Match the surrounding code and docs.** Mirror naming, structure, and comment
  density. Keep docs and code in sync in the same change. Comments follow the
  convention in §7.
- **State assumptions and surface trade-offs.** For anything architectural,
  propose a decision record rather than silently deciding.
- **Keep the plan honest.** If tests fail or a step is skipped, say so. Don't mark
  work done that isn't verified.
- **Prefer the dedicated tools** (file/search) and make small, coherent commits
  with Conventional Commit messages.

## 10. Agent authority & change control

Your work queue comes from the `docket` skill (`.claude/skills/docket/SKILL.md`)
— open issues in the current sprint milestone, priority-ordered. The backlog is
deliberately unassigned: **the claim is a worktree plus an immediately-pushed
branch**, never the assignee field. `blocked` is
the escalation ritual; `wrap-up` ends a session — gates, MR, status note on the
issue, the parent closed when its last story lands, the worktree that held the
claim retired, and the handoff written. These five rules are **binding** in
every session (full detail:
[decision record 008](docs/decisions/008-operating-model-for-coding-agents.md),
and the original change-control guide, which is not published):

1. **Blocked ≠ re-spec.** Never narrow acceptance criteria, requirements, or
   scope to get unblocked. Run the `blocked` skill: **ask first** — a lane asks
   its orchestrator, a solo session asks the project owner directly, with a
   recommendation — and record the ruling on the issue. Park the question in the
   open-decisions register only when nobody in the session can answer it, and
   then take the next docket item.
2. **Protected paths only on explicit human direction** (the canonical table is
   in the change-control guide, which is not published. Here the lists in `.claude/settings.json` and
   `ci-gates/governance-guard.mjs` carry it, with the original paths renamed for
   publication). Agent-assisted protected-path MRs go **orange**
   at the merge button — the owner's merge click, made informed, is the review.
3. **Never accept your own decision record.** Propose; a human flips it to
   `Accepted` on merge.
4. **Never merge.** Open and update MRs, mark them ready — a human clicks merge.
5. **Never touch others' assignments.** Reassignment is a sprint-planning act.

---

_This is a living document. When conventions evolve, update this file and the
relevant `docs/` page together, and note significant shifts in a decision
record._
