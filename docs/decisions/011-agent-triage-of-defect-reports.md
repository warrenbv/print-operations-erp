# 011. Agent triage of defect reports

Status: Accepted, with one amendment described below. Decided by Warren Vogel, project owner and technical lead.

An intern built the service, working under Warren's direction. Warren specified it and set its phases and limits.

## Context

Testing with staff was about to start, and the training tours ended with "email your results to the owner." Reports would land in one inbox, screenshots attached to nothing, and someone would type each failure into an issue by hand. The testers had no code host accounts and would not use a tool that needed one. The agents already worked from issues, and a person clicked every merge ([008](008-operating-model-for-coding-agents.md)). The front door and the trigger were missing.

## Decision

Defects arrive as tickets raised by email, and every comment on a ticket goes back to the tester. An intake service starts one headless agent run per phase, one run at a time. Labels choose the phase, and each phase ends by adding the label that starts the next. Its rules are a skill in the repository.

| Phase | Does | Tools | Caps |
| --- | --- | --- | --- |
| 1. Triage | Reads report and screenshots, classifies defect or feature request with cited evidence, checks duplicates, rewrites as a story | File reading and issue commands. No edits, git or other commands | 30 min, 80 turns |
| 2. Investigate | Reproduces with an existing test, posts the root cause, judges whether the fix is only a fix | Adds git and the package runner. No edits | 30 min, 120 turns |
| 3. Remediate | Writes the fix and opens it as a draft merge request | Adds editing and creating merge requests | 2 h, 400 turns |

Any tool not on a phase's list is denied. Merging, approving, marking ready, closing issues and web access are denied in every phase. The turn cap is a second guard against loops. Each issue gets one remediation attempt.

A person decides on a likely feature request, which is parked with no milestone so no agent picks it up. A person also decides when a promise is unclear, when a fix needs a migration, a new screen, a permission change, a protected path or an unmade decision, and anything done on the running system. Marking ready and merging stay human.

The first version made the owner's label the gate before code was touched. The next day Warren amended it. That label was a recurring owner action guarding the wrong risk, which was a feature request built as a defect, so the gate moved to classification.

## Read-only diagnostics

Phases 2 and 3 later gained read access to the running system. The agent reads untrusted input, since anyone who can send an email can put text and images in front of it. An allowlist on the agent's side is not a wall, because the package runner can start any program. So the read-only limit is enforced on the server side, out of the session's reach. What a session writes carries field names, counts and error text, never customer names, addresses or prices.

## Alternatives considered

- **A hosted tracker as the front door.** It could not reach the on-premises code host without a mirror and a sync.
- **One session for all phases.** It would hold the widest tool list from the first turn.
- **Keyword classification.** Testers write "should" about defects and "wrong" about wishes.
- **Full autonomy, including merge.** The merge click is the review.

## Consequences

- A misclassification either builds an unwanted fix, which the owner closes, or parks a real defect, which the owner releases. Both are visible on the issue.
- Incoming email, a machine to patch, an agent subscription with usage limits, and more draft merge requests on the shared runner.

## Status

The service is live and in regular use. Phase 1 ran on real tickets from 10 September 2026, and the later phases first ran on a live ticket on 13 October 2026.

As of 20 November 2026 Warren reports that it has handled about 30 to 40 tickets. By his account it has classified each one correctly as a defect or a feature request, and for defects it starts the headless sessions that investigate and propose a fix without anyone prompting it. For feature requests it carries a conversation with the person who raised the ticket over email, passing their guidance and screenshots to the agent and its questions back.

The ticket count is his estimate, not a count taken from the tracker.

## Where to see it

The triage skill is [`.claude/skills/triage/SKILL.md`](../../.claude/skills/triage/SKILL.md). The intake service's code is not in this edition.
