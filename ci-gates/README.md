# CI gates

Four repository checks from the print operations ERP, published with their tests.

## What each gate checks

**governance-guard.mjs** is the merge gate. It checks which protected paths a merge request changes (agent rules, decision records, requirements, the pipeline), whether its commits carry an AI co-author trailer, and whether an owner approved. It passes when nothing protected changed, when an owner approved, or when an owner wrote the change without agent help. It warns with exit code 3, shown as a non-blocking warning, when an owner's branch carries agent commits. An owner can clear the warning with a note that names the current head commit, so any later push brings it back. Everything else fails with exit code 1.

**docs-integrity.mjs** fails on documentation damage that still renders as valid markdown. It finds conflict markers, duplicate or unindexed decision records, broken supersede links, register rows with the wrong number of cells and duplicate register ids.

**docs-only.mjs** exits 0 when every changed file is documentation. The heavy jobs then end early. Any unrecognised path runs the full pipeline.

**docs-freshness.mjs** reports which READMEs have fallen behind their code, using a `Docs-Verified:` commit trailer. With `--check` it exits 1 on a stale page. It was run by hand and was never a pipeline job.

## Where they ran

The first three ran in the project's GitLab pipeline, where they lived under `scripts/ci/`. `pipeline.reference.yml` is that definition, kept for reference. It is not executed here.

The path lists inside the gates name the original repository's layout, renamed for publication, so some of their paths do not exist in this edition. [`.claude/README.md`](../.claude/README.md) lists the equivalents here.

## What changed for publication

All original comments were removed and new ones written. Usernames, document paths, register ids, commit hashes and code-host paths were replaced with fictional values. Test files were converted from TypeScript to plain JavaScript with the same cases and assertions. The decision logic is unchanged.

## Who wrote them

Coding agents wrote this code under Warren Vogel's direction. He set the rules the gates enforce.

## Known limits

`docs-only.mjs` treats the agent skills and settings under `.claude/` as prose, because no pipeline job tested them when it was written. A change to the permission policy alone therefore skips the heavy jobs. The hooks folder is excluded from that rule.

## What is not here

No test calls a live merge-request API. The GitHub workflow in this repository, [`.github/workflows/checks.yml`](../.github/workflows/checks.yml), runs the tests only, not the gates themselves.

## Run the tests

From the repository root, after `pnpm install`:

- `pnpm test:gates` runs only the gate tests and the hook tests in [`.claude/hooks/`](../.claude/hooks/).
- `pnpm test` runs them too, together with every package's tests.

`node ci-gates/docs-freshness.mjs` runs the freshness report against this repository's history. It needs a git checkout. This edition's history carries no `Docs-Verified` trailers, so it reports every page as never verified.
