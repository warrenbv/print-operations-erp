---
name: blocked
description: What to do with a blocked work item or a spec that seems wrong — ask a person first (a lane asks its orchestrator, a solo session asks the owner directly, with a recommendation), record the answer on the issue, and only park the question in the open-decisions register when nobody in the session can answer it. Use on any blocker, failed Definition-of-Ready check, or spec contradiction.
disable-model-invocation: true
---

# Blocked — ask, never re-spec

> **In this edition.** This skill is kept as the agents ran it on the original project. It drives an issue tracker and a code platform through `glab`, and neither is part of this repository, so its commands and some of the scripts and guides it names do not exist here. It is set so that Claude does not start it by itself. Do not push branches or open merge requests from it.

**Hard rule first (CLAUDE.md §10): blocked ≠ re-spec.**
Never narrow acceptance criteria, requirements, or scope to route around a
blocker — not "temporarily", not "just to keep moving". A wall you hit is a
decision someone owns; your job is to put it in front of them cleanly.

**Second rule: ask first.** A row in the open-decisions
register is not how a question is asked. It is where a question is parked when
nobody in the session can answer it.

## 1. Ask

- **A lane with an orchestrator:** stop at the nearest gate and put the question
  in the report's Questions. The orchestrator answers it from the repo's own
  decisions (decision records, business rules, resolved open decisions, rulings
  on issues) or takes it to the project owner.
- **A session with no orchestrator, and the orchestrator itself:** ask the
  project owner directly, in the conversation.

Ask it so it can be answered in a word:

- State the **question**, in plain words. Never just a register number — a
  number alone tells the reader nothing.
- What the code or the spec does **today**, in one or two sentences.
- The **options**, a line each.
- Your **recommendation**, first, with the one reason that decides it.
- What it **blocks**, or that it blocks nothing.

Carry on with every part of the item that does not depend on the answer.

## 2. Record the ruling where the work needs it

When the answer comes, write it down **with the words used and the date**:

```bash
glab issue note <iid> --message "<the question, the ruling quoted, the date>"
```

Build any note that contains backticks from a file, not an inline shell string.
Cite the issue from the code comment or the merge request that depends on the ruling. If a
register row already exists for the question, resolve that row in the same
change and update the pages that link to it.

Then carry on. Nothing else is owed.

## 3. Park it — only when nobody in the session can answer

Park the question when it waits on somebody who is not in the session (another
person's answer, a supplier, a measurement nobody has taken), or when the owner
says to park it.

1. **Note on the issue:** what is blocked, why (quote the conflicting sources if
   the spec seems wrong), what is needed, and who decides (the "Who decides"
   conventions in the open-decisions register).
2. **Add the row** to the register's Open table (deliberately unguarded —
   parking must stay frictionless). Next free number; the register's columns:
   ID · Decision · Options / what's needed · Who decides · Blocks · Resolve by.
   Reference the row's number in the issue note. Commit it as
   `docs(open-decisions): raise <number> <topic>` — on the current branch if one
   is open, otherwise a small `docs/` branch.
3. **Label it and keep ownership:**

   ```bash
   glab issue update <iid> --label blocked
   ```

   Leave the issue assigned — it stays in your lane; the label plus the register
   row is the signal that it is waiting.

4. **Tell the owner it is parked**, in one line, with who it waits on. A parked
   question he has not heard about is a question nobody is chasing.

## 4. Park the work and move on

If the item cannot move at all without the answer and there is work in progress,
run the `wrap-up` skill in draft mode (push the branch, leave the merge request a Draft
noting the blocker). Then run the `docket` skill to pick up your next item.
