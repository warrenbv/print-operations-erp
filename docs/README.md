# Documents

Everything in this repository that is meant to be read, grouped by the question it answers. The [main README](../README.md) has the short version, how to run the application and a walkthrough.

## The story

| Document | What it covers | Time |
| --- | --- | --- |
| [Delivering an ERP with coding agents](product-ownership.md) | The project in one page: the problem, who did what, the system around the agents, the result | 5 min |
| [Problem and process](product/problem-and-process.md) | The business problem, quote to order before and after, the reported result | 3 min |
| [Metrics](metrics.md) | Every number, with its scope, date and source | 3 min |

## How it was delivered with coding agents

| If you want to see | Go to | Time |
| --- | --- | --- |
| A failure the tests did not catch, and what it changed | [The UI completeness audit](process/ui-completeness-audit.md) | 3 min |
| How the agents were instructed and constrained | [`CLAUDE.md`](../CLAUDE.md), the instructions file, and [`.claude/`](../.claude/README.md): the permission policy, workflow skills and the hook, adapted from the files the agents worked under | 5 min |
| Checks that gate agent-written changes | [`ci-gates/`](../ci-gates/): the merge gate and documentation checks, with their tests | 5 min |
| Tests that fail the build when a convention is broken | The `every-…` tests in [`apps/api/test/`](../apps/api/test/) and [`apps/web/src/app/`](../apps/web/src/app/), such as [every write route has a screen](../apps/api/test/every-write-route-has-a-screen.test.ts) | 5 min |
| How the work was run day to day | [Working with coding agents](process/working-with-coding-agents.md): lanes, instructions, what gated a merge, what stayed a human decision | 5 min |
| When a piece of work counted as finished | [Definition of done](process/definition-of-done.md) | 3 min |
| How agent-written code was verified, layer by layer | [Verifying agent-written code](process/verifying-agent-written-code.md): the checks a change met, in order, what each caught and what stayed a human decision | 5 min |
| The orchestration model: a coordinating session directing scoped builder lanes | [Decision record 008](decisions/008-operating-model-for-coding-agents.md) | 3 min |
| Agents connected to the issue tracker | [Agent triage of defect reports](decisions/011-agent-triage-of-defect-reports.md) | 4 min |
| Agents and CI: what was measured and what changed | [The pipeline restructure](process/pipeline-restructure.md): what slowed the pipeline, what changed, and the result with its shared credit | 4 min |

## How it is implemented

| If you want to see | Go to | Time |
| --- | --- | --- |
| How the code is organised and how a request travels | [Architecture](architecture.md): the layout, what a module contains, where storage is chosen, how the schema is migrated and where each kind of test lives | 5 min |
| One module, layer by layer | [`modules/orders/`](../modules/orders/README.md): domain rules, ports, services, adapters and schema | 5 min |
| Both storage adapters held to one contract | [`modules/orders/test/contracts/`](../modules/orders/test/contracts/), run against the in-memory and the PostgreSQL adapter by [`repository-contracts.test.ts`](../modules/orders/test/repository-contracts.test.ts) | 3 min |
| The application's entry points | The web app in [`apps/web/`](../apps/web/README.md), the API in [`apps/api/`](../apps/api/README.md) and the launcher [`scripts/demo.mjs`](../scripts/demo.mjs) | 5 min |
| Roles, sessions, which routes need what, and the limits | [Security and access](security-and-access.md) | 5 min |
| Architecture decisions, including how the stack was chosen | [Decision records](decisions/): eleven decisions, each with the options rejected and the cost | 10 min |

## The product record

| Document | What it covers |
| --- | --- |
| [Requirements](product/requirements.md) | The twelve rules of the quote-to-order journey, each with where to see it in the demo |
| [Decision traces](product/decisions.md) | Four business decisions that shaped the journey, with the options and who decided |
| [Roles](product/roles.md) | Who acts in the journey, what each needs, and what each may and may not do |
| [Scope and deferrals](product/scope-and-deferrals.md) | What the first release left out and why, and what this edition leaves out |
| [UX direction](product/ux-direction.md) | The UX review, the three directions mocked up, and the principles that were built |

The [product folder](product/) has its own index.

The decision records and several process pages end with links into the code under "Where to see it".
