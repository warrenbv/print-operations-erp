# Delivering an ERP with coding agents

By Warren Vogel

Revolve Print & Pack is the packaging and custom-print line of business under TPC Holdings, Inc. Its orders pass through several kinds of judgment. Sales has to make an accurate offer, Production has to commit to a schedule, and Finance has to carry the commercial record through invoicing and reconciliation. Before this project that work ran on pricing spreadsheets, manual invoice preparation and duplicate data entry.

I owned the product and engineering delivery of the ERP that replaced it. This page covers what I did, what coding agents and colleagues did, and the system I built around the agents so the result could be trusted.

## Who did what

My part was stakeholder discovery, requirements, business rules, scope, architecture direction, the agents' operating instructions, review, user testing and acceptance. I held the merge decision.

Coding agents wrote most of the code and tests, and drafted most of the documents, including the decision records. The rule was that an agent could propose a decision and never accept one.

Colleagues contributed application code, identity and infrastructure work, and deployment. An intern I directed built the service that triages incoming defect reports with an agent, and installed the dedicated pipeline runners.

I did not read every line. Review was of behaviour in the running application, of diffs at checkpoints, and of what the pipeline reported. That is why the rest of this page is about checks.

## The system around the agents

**Instructions the agents load.** One file sets the rules of the repository: the module boundaries, how a decision gets recorded, what an agent may never do. A permission policy enforces the parts that can be enforced mechanically, and a few skills carry the repeatable workflows. See [`CLAUDE.md`](../CLAUDE.md) and the [agent configuration](../.claude/README.md).

**Pointers in the code.** Agents lose time hunting for context, so the code carried comments that pointed to the rule or decision behind it. A session could start in one file and reach the reasoning without searching.

**Lanes and review.** Work was split into scoped lanes in separate worktrees, with a coordinating session reviewing diffs at checkpoints and raising anything that needed a decision. See [working with coding agents](process/working-with-coding-agents.md).

**Gates in the pipeline.** A merge request that touched protected paths had to meet rules a script checked, and the script read the commit trailers to see whether an agent had co-written it. On my own branches that showed as a warning, not a block. Documentation had to stay consistent with the code. Structural tests failed the build when a convention was broken. See the [pipeline gates](../ci-gates/).

**Failures became rules.** When something went wrong, the usual fix was a dated rule in the instructions or a new check, so there was something in place to catch it the next time.

## The lesson that changed acceptance

In late August 2026 the tests were green and the pipeline was green. Then I started writing training tours for each role and found workflows that had a working API and passing tests and no screen a person could use. Seven turned up while I wrote the tours. I ordered an audit of every role's work, and it found 20 more.

Agents built the missing screens. They also built a check that fails the build when a write route has no page that calls it, and the definition of done changed: a workflow is done when the person who owns it can complete it in a browser. See [the audit](process/ui-completeness-audit.md) and the [definition of done](process/definition-of-done.md).

Passing checks are evidence about the implementation. Acceptance is a decision about whether someone can do their job, and it stayed with me.

## Results

The first business line went live in October 2026. As of 20 November the team uses the ERP from quoting through receivables. Its general-ledger export loads into the company's existing accounting system automatically.

Discovery estimated a saving of 20 to 40 staff hours a week for that business line. In production use the saving is 25, by my report from a before-and-after comparison of staff hours. I first reported it in October 2026 and it is still the figure as of 20 November. It has not been audited.

Agents co-authored 86.6% of the non-merge commits, and I made 97.6% of the merges. The [metrics page](metrics.md) gives every number with its scope, date and source.

## What is in this repository

The runnable quote-to-order edition of the application is here, with fictional data, beside the engineering system and the product record: the agents' instructions and configuration, the pipeline gates with their tests, the decision records, the process documents and the requirements. The [README](../README.md) says how to run it and what to try.
