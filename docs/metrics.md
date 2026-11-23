# Metrics

Each number below has its scope, its date and where it comes from. Numbers about the original system are kept apart from anything this repository can demonstrate.

## The system in use

| Measure | Value | Scope and date | Source and limits |
| --- | --- | --- | --- |
| In production | Live since October 2026 | One business line. In use from quoting through receivables as of 20 November 2026. Its general-ledger export loads into the company's existing accounting system automatically, as of 22 November 2026 | Reported by Warren Vogel |
| Staff time saved | 25 hours a week, against a discovery estimate of 20 to 40 | The same business line, in production use. First reported in October 2026 and still the figure on 20 November 2026 | Reported by Warren from a before-and-after comparison of staff hours. Not audited and not instrumented |

## How the software was built

Counts are from the original repository's commit history, 9 July to 17 November 2026.

| Measure | Value | How it was counted |
| --- | --- | --- |
| Commits written with a coding agent | 1,196 of 1,381 non-merge commits (86.6%) | Commits carrying an agent co-author trailer |
| Merges made by Warren | 848 of 869 (97.6%) | Committer of each merge commit |
| Commits with documentation verified | 433 | Commits carrying a `Docs-Verified` trailer, first used on 21 September 2026 |
| Test files | 695: 532 unit and integration, 163 browser journeys | File count at the last commit |
| Tests on the tooling itself | About 325 cases in 13 files | Static count of test cases for the repository checks and agent tooling |

The first two rows are the operating model in two numbers: agents wrote most of the code, and one person held the merge decision.

## What the checks caught

| Measure | Value | Scope and date | Source and limits |
| --- | --- | --- | --- |
| Workflows with no usable screen | 27 found: 7 while writing training tours, 20 by the audit that followed | August to September 2026 | The audit registers. See [the audit](process/ui-completeness-audit.md). The check that came out of it has an empty exception list today |

## The pipeline

| Measure | Before | After | Scope and limits |
| --- | --- | --- | --- |
| Median time from push to finished pipeline | 88 min 56 s | 10 min 17 s | Before: 10 to 21 September 2026. After: 24 September to 2 October 2026. Measured from the code host's pipeline history. Warren identified the runner bottleneck, requested dedicated runners and directed the restructure. The intern he directed installed the runners, and the dedicated hardware accounts for most of the gain |
| Flaky failures | 52 in 400 pipelines | 1 in 104 | Before: the 23 days to 21 September 2026 that the pipeline review covered, a longer window than the median's. In that window 102 jobs failed hard, and 52 of those failures were flakes. After: the record gives 1 of 104 for the period after the change and does not state its window. Same source and the same shared credit |

These two rows come from the code host's records and cannot be recomputed from this repository.

## Agents and the issue tracker

The project ran a triage service that started a headless agent run when a defect ticket arrived. An intern built the service and its infrastructure under Warren's direction. Warren specified it and set its phases and its limits in the decision records. Its first phase, classifying the ticket without editing or running anything, ran on real tickets from 10 September 2026. The later phases, which investigate and propose a fix as a draft merge request for a person to review, first ran on a live ticket on 13 October 2026.

| Measure | Value | Scope and date | Source and limits |
| --- | --- | --- | --- |
| Tickets handled by the triage service | About 30 to 40 | In regular use, as of 20 November 2026 | Warren's estimate, not a count taken from the tracker |
| Defect or feature request classified correctly | Every ticket | The same tickets | Reported by Warren. Not independently checked |

For defects the service starts the investigating and fixing sessions itself. For feature requests it carries a conversation with the requester over email, including screenshots, and passes their guidance to the agent. See [decision record 011](decisions/011-agent-triage-of-defect-reports.md).

## What this repository demonstrates itself

The application, its tests and the original project's gates are in this repository, and the [README](../README.md#run-it) gives the commands that run them on your machine. Among them are the gate and hook tests: 147 tests in 5 files when counted on 20 November 2026. Everything above this section is reported, with its source stated, and cannot be recomputed from this repository.
