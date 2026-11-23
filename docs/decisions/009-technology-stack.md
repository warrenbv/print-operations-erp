# 009. The technology stack

Status: Accepted. Decided by Warren Vogel, project owner and technical lead.

The language, database and deployment records were written when the repository was set up, in a commit co-authored by a coding agent. The sign-in, ORM and tooling records followed five days later.

## Context

- **On premises, on the local network.** No mandatory cloud services. Any cloud dependency needs its own justified record.
- **A small team.** The charter planned for two to five developers. The ORM record describes two or three who also did requirements and testing. IT was the project owner's responsibility as well.
- **A long life.** The system was meant to become the company's main ERP, with modules later lifted to other parts of the business.
- **Existing systems.** Every member of staff already had an account in the company directory.
- **Coding agents.** Much of the code would be AI-assisted, and colleagues' agents would work from the same repository.

## Decision

| Layer | Choice | Alternatives | Reason |
| --- | --- | --- | --- |
| Language | TypeScript end to end | .NET or Python, with React | Contracts shared, not duplicated. |
| Web | Next.js and React, server-first | Not recorded | Mature, large talent pool. See 004. |
| API | NestJS | Not recorded | Its modules map onto the business modules. |
| API style | REST and JSON | GraphQL, tRPC | Inspectable, with explicit module contracts. |
| Database | PostgreSQL, a schema per module | MySQL, SQL Server, SQLite | Schemas fit module isolation. No licence cost. |
| Data access | Drizzle | Prisma, raw SQL | The compiler enforces the boundary. See 010. |
| Decimals | big.js | See 003 | No floating point in money. |
| Validation | Zod | Plain types, class-validator | One declaration is check and type. |
| Tests | Vitest, Playwright | Jest | Native TypeScript and ESM. |
| Documents | @react-pdf/renderer | Not covered here | Server-side PDFs. |
| Repository | pnpm, Turborepo, Node.js 22 LTS | Not recorded | Fast installs, cached tasks. See 001. |
| Deployment | Docker Compose, on premises | Bare metal, Kubernetes, cloud | Reproducible, simple for a small team. |
| Sign-in | The company directory over LDAPS | Local accounts, self-hosted OIDC | No second password, no stored passwords. |

## The instructive choices

**TypeScript everywhere.** The records name drifting type definitions between front end and back end as a recurring source of bugs in multi-language stacks. .NET fitted the existing servers but meant two languages, and its SDK was not installed. The costs accepted were Node's ecosystem churn, handled by pinning versions, and types that vanish at runtime. That second cost is why Zod sits at every boundary.

**REST over tRPC.** tRPC was judged elegant but binds client and server into one TypeScript build, against explicit, language-agnostic module contracts. GraphQL was rejected as infrastructure for a problem a small internal application does not have.

**The directory, not local accounts.** Authentication goes to the directory. Authorisation stays in the ERP, because roles are business concepts that should not need a directory change. Local accounts would mean a second password per employee and offboarding that does not follow the directory, a permanent cost for a small IT function. The cost accepted is a hard runtime dependency. If the directory is unreachable nobody can sign in, so a local break-glass administrator was decided separately.

Kubernetes was rejected as operational overhead unjustified at this scale. Running PostgreSQL in house means owning its backups. Docker was not on every development machine, so development uses an embedded PostgreSQL that needs no administrator rights.

## Where to see it

- [`package.json`](../../package.json) and [`.nvmrc`](../../.nvmrc): the pinned package manager and Node version.
- [`packages/types/src/`](../../packages/types/src/): Zod contracts with inferred types.
- [`packages/db/src/`](../../packages/db/src/): the per-module database handle and migrations.
- [`modules/identity/src/providers/ldap-client.ts`](../../modules/identity/src/providers/ldap-client.ts) and [`modules/identity/src/adapters/ldapts-client.ts`](../../modules/identity/src/adapters/ldapts-client.ts): the directory client's port and the adapter that binds. The demo signs in through the local provider instead.
- [`scripts/db/embedded-postgres.mjs`](../../scripts/db/embedded-postgres.mjs): the development database.
