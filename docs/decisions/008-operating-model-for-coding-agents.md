# 008. How developers and coding agents work in one repository

Status: Accepted. Decided by Warren Vogel, project owner and acting technical lead.

## Context

The first sprint had started, and two or three developers were about to work in the repository at once, each driving coding-agent sessions. The stated goals were these. A developer should be able to open a session, ask for the work queue, and start correct work without hand-holding. Quality should be enforced where changes merge. An agent that hits a wall should escalate instead of quietly changing the scope.

The constraints:

- The self-hosted code platform's free tier could enforce protected branches, one approval rule and merge checks. Required code-owner approvals and per-path approval rules were paid features and could not be relied on.
- Scope lived in one backlog file. The platform's spreadsheet import silently dropped the labels and milestones the backlog generator produced.
- The register of open decisions already gave a blocked question a home. It needed to become binding on agents, not advisory.

## Decision

1. **Assigned lanes first.** At sprint planning Warren assigned each developer a module lane and their sprint issues, and a session found its work through a work-queue skill. The pickup rule was isolated in one section of that skill so it could change cheaply. It did change, a few weeks later, to taking the top ready item, with the claim made by pushing a branch immediately.
2. **Change control in CI.** A job fails any change that touches protected paths unless the author is a governance owner or a governance owner has approved it, checked through the approvals API and failing closed. Protected paths include the decision records, the charter, requirements, the backlog, the agent instructions and CI itself.
3. **Humans merge, always.** Agents open and update merge requests. The merge click is human.
4. **Agent authority limits.** Blocked does not mean re-specify: raise the question and take the next item. Touch protected paths only on explicit human direction. Never accept your own decision record. Never merge. Never touch others' assignments.
5. **Issues sync from the backlog file** through the platform's API, by a script that can be re-run safely.

The change-control rule was later amended. Agents committed under a person's account, so authorship proved nothing for agent-assisted changes. Those changes now show a warning at the merge button listing the protected paths and the agent commits, and the owner's informed merge click is the review.

## Alternatives considered

- **A self-serve pull queue from the start.** Least planning overhead. Rejected at first because Warren wanted control of lanes at sprint planning, and the switch was made cheap on purpose.
- **Label-based authorization for protected paths.** Simplest, but anyone with basic access can apply a label, so an agent could authorize itself. Approvals cannot be forged that way.
- **The platform's paid tier.** Would give enforced code-owner approvals. Rejected as a recurring cost for controls the free tier plus a CI job could deliver.

## Consequences

- Enforcement is mechanical, not a matter of vigilance. Normal feature work stays unblocked, and every change of direction routes through a named person.
- The protected-path list exists in three places that must change together.
- The guard job needs a manual retry after an approval lands.

## Where to see it

The operating practice is described in [Working with coding agents](../process/working-with-coding-agents.md). The agent instructions are [`CLAUDE.md`](../../CLAUDE.md) and the files in [`.claude/`](../../.claude/), and the change-control job is [`ci-gates/governance-guard.mjs`](../../ci-gates/governance-guard.mjs), all adapted for publication. The backlog tooling is not part of this edition. The workflow in this repository runs the tests of the change-control job and the hook, not the job itself.
