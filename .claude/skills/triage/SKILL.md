---
name: triage
description: Turn an emailed defect report into a story the docket can take — read the report and its screenshots, split a results blob, classify it as a defect or a feature request, check for duplicates, rewrite it in the story shape. Phase 2 finds the root cause and scopes the fix. Never writes code. Started headless by the intake service as `/triage <iid> [--investigate] --owners <a,b> --attachments <dir>`.
disable-model-invocation: true
---

# Triage — read the report, write the story, never touch the code

> **In this edition.** This skill is kept as the agents ran it on the original project. It drives an issue tracker and a code platform through `glab`, and neither is part of this repository, so its commands and some of the scripts and guides it names do not exist here. It is set so that Claude does not start it by itself. Do not push branches or open merge requests from it.

This session is not a working session. Nobody is there to answer a question,
there is no branch, and what you produce is a comment and some labels rather
than a merge request. `docket` is the session that writes code; this one hands
it something worth writing.

Two decision records govern this skill: one on defect intake and agent triage,
and one that moved remediation onto the triage verdict. The second moved the
gate: the labels you add carry a defect to the next phase, and the human review
is the feature-request fork in step 4. A third governed read-only diagnostic
access for phase 2. Decision record 011
(`docs/decisions/011-agent-triage-of-defect-reports.md`) covers all three, with
the details of that access removed. The service that starts you
is the intake service, and its runbook carries the tool allowlist you are
running under.

## How you are invoked

| Prompt                        | Phase           | Started by                                                                                        |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `/triage <iid>`               | 1 — triage      | an issue opened carrying `intake`                                                                 |
| `/triage <iid> --investigate` | 2 — investigate | `triage:ready`, which phase 1 adds itself so nobody has to, or `triage:investigate` added by hand |

Both prompts also carry `--owners <a,b>`: the tracker usernames to mention
wherever a decision is the owner's. Without the flag, mention the project owner
and say in the comment that the flag was missing.

Both also carry `--attachments <dir>`: the directory the intake service has already
filled with this issue's screenshots. It is yours to read and never to write.
Without the flag, say so in your run comment and triage on the text alone.

You run under `--permission-mode dontAsk`: every tool outside your phase's
allowlist is denied outright, and there is nobody to approve one. **Phase 1 has
no `Edit`, no `Write`, no `git` and no `Skill`.** That is the security boundary,
not a hurdle — do not plan a step that needs a tool you were not given.

**Every run ends with a comment on the issue.** A silent run is a failure, and
so is one whose conclusion only exists in the transcript on the triage machine.

## Rules that bind both phases

- **Never edit a tracked file, never create a branch, never open an MR.** The
  checkout you are standing in must be as clean when you finish as when you
  started.
- **Never close an issue.** A duplicate gets a comment and a label; closing it
  is a person's call, and the tool is denied so you cannot do it by accident.
- **One comment per decision.** Not a running commentary, and not five notes
  where one paragraph would do.
- **Absolute paths only, and no `cd &&`.** You may be started from a directory
  you did not choose.
- **No customer names, prices or account figures in a title.** They travel into
  emails and issue lists. The body may repeat what the tester wrote, since the
  tester already has it. It never adds a value read from production.
- **Never add `triage:remediate` to a report you did not classify as a defect**
  — with a promise cited from step 4, or one of its no-promise-needed reasons.
- **One remediation attempt per issue.** If the issue already carries a merge
  request or a note from a failed phase 3, stop and mention the owners.
- **Say when you cannot.** A report you cannot make sense of gets a comment
  naming what is missing. Guessing at a story is worse than saying "not enough
  to go on".

## Phase 1 — triage

### 1. Read the report, and look at the screenshots

```bash
glab issue view <iid> --comments
```

The intake service has already downloaded every attachment on the issue into the
directory `--attachments` names. **`Glob` that directory and `Read` every file
in it.** Half of these reports _are_ the screenshot, and a report triaged
without looking at it is a report you guessed at.

**Say what each screenshot shows**, in a sentence, in your run comment. That is
the only evidence anyone has that you looked at it, and it is what tells the
tester their picture arrived.

**An empty directory is a fact, not a silence.** Say plainly that no screenshots
reached you, then triage on the text alone. It means the issue carried no
attachment, or the intake service could not fetch one — its own note on the issue says
which, and neither is something you can fix from here.

**Do not fetch an upload yourself.** You may call
`glab api projects/:id/uploads/...`, but only unquoted and unredirected, so the
bytes would land in your transcript and never in a file you could `Read`. The
intake service fetches them for you;
route around nothing.

### 2. Learn the vocabulary before you rewrite anything

Read the project's writing rules, and the test-day training guide
for how testers actually talk: `ZZ TEST` prefixes on throwaway records,
Pass / Fail / Not tested, and the "Copy my results" blob below. A tester writing
"the credit banner" means a specific banner on a specific screen; find it rather
than paraphrasing.

### 3. A "Copy my results" blob is many reports in one email

The tours' Copy my results button writes exactly this shape:

```
ERP test results - <the tour's title>
Tested on: <date>
Tested by: <often blank>

Passed 9, failed 2, not tested 4, of 15.

3. Quote a customer on credit hold
   Fail
   the banner said approved but the quote stayed locked

4. Add a contact to a customer
   Pass

Anything else worth saying:
```

When you see it: **every `Fail` becomes its own issue** in the story shape
below, created with `glab issue create` and linked back to this one by number.
`Pass` and `Not tested` lines are summarised in a single comment — a summary
that hides what was never tested reads as a clean sweep. The original issue
keeps the tester's text and the summary comment naming the issues you raised;
it is not itself a story, so leave it on `intake` alone.

### 4. Defect, feature request, or unclear?

One verdict, and your run comment cites the evidence for it (the remediation
decision, decision 1). A verdict without its evidence is a guess.

| Verdict                              | What settles it                                                                                                                                                                                                                                                        | Then                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Defect, no promise needed            | An error, crash, 500 or error boundary; a wrong figure against a documented rule such as a tax rate or a pricing sheet; data entered and not saved; a role seeing, or not seeing, what the security and access design says it should; a relay step that cannot hand off | Step 5                                          |
| Defect against a promise             | The tour step the tester was on (the training tours), the matching journey in `e2e/`, or the closed story's acceptance criteria promises the behaviour, and the system does otherwise                                                                                 | Step 5, quoting that step or spec line          |
| Feature request                      | Nothing promises it, or the open-decisions register or the deferred-and-future list defers it                                                                                                                                                                         | The fork below                                  |
| Unclear whether it was ever promised | You looked for a promise and cannot tell                                                                                                                                                                                                                               | `triage:owner-review`, mention the owners, stop |
| Unclear what happened                | No screen named, or no expected-versus-actual                                                                                                                                                                                                                          | Step 6                                          |

Words are hints, never the decision: "should be able to" and "would be nice"
point at a feature, "wrong", "blank" and "didn't save" point at a defect, and
the evidence decides. Split a mixed report — the defect part becomes the defect
story, the feature part its own issue, never "while you're in there". And never
ask a tester a scope question: they know what they expected, not what was
promised.

**The feature-request fork.** Rewrite the issue — or create one, for a `Fail`
line out of a blob — in the shape of the feature issue template, title
`[FEAT] <capability>`. Labels `triage:feature-request` and `optional`. No
milestone, no `Must`/`Should`/`Could`, and never `triage:ready`: the docket
reads only the current sprint, so nothing picks it up. Then one comment,
mentioning the owners: what you checked, what the system does today, why it is
not a defect. The tracker's email intake sends that same comment to the tester, so write it
for both of them. Stop there.

### 5. Duplicate?

Search by the screen and by the exact words the tester quoted from it:

```bash
glab issue list --search "<the words on the screen>"
```

A likely duplicate gets one comment linking both issues and saying which is
which, the label `triage:duplicate`, and **stops there**. Do not merge the two
reports yourself.

### 6. Not enough to reproduce?

No screen named, or no expected-versus-actual: post **one** comment asking for
the specific missing thing — not a questionnaire — label `triage:needs-info`,
and stop. The email intake sends your comment to the tester, and their reply comes
back as a note on the same issue, which starts a fresh session.

### 7. Otherwise, rewrite it in the story shape

Title: `<screen or area>: <one line>`. Body: the fields in the defect issue
template, with the tester's original text quoted at the bottom, untouched.

Naming the suspected module — the labels below already exist:

| What you have             | Where it maps                                                   |
| ------------------------- | --------------------------------------------------------------- |
| a screen the tester names | `apps/web/src/app/nav/nav-map.ts` — nav items to route paths    |
| a route or an API error   | `apps/api/README.md` § Controllers by module — prefix to module |

Severity is one of three, in the words the business uses: **blocks the relay**
(work cannot move to the next person), **wrong figure** (a number or document
is incorrect), **cosmetic**.

Labels: `triage:ready`, `bug`, plus the module label. Milestone: the current
sprint, which you resolve the way `docket` §2 does but within your allowlist —

```bash
glab issue list --per-page 100 -O json \
  --jq '[.[].milestone | select(. != null) | {title, start_date, due_date}] | unique_by(.title)'
```

— then take the one whose `start_date` ≤ today ≤ `due_date`.

### 8. Report what you decided

One paragraph, plain words, on the issue: what you concluded and why. The
readers are the tester and the owner, not a log parser. Then stop — no file has
been edited and no branch exists, which is how it should end.

## Phase 2 — investigate and scope

Started by `triage:ready`, which phase 1 adds itself, or by `triage:investigate`
added by hand. You gain `git`, `pnpm` and read-only diagnostic access; you
still have no `Edit` and no `Write`.

The `--attachments` directory is filled for you again, with the same files
phase 1 saw plus anything attached since. Read it yourself rather than trusting
phase 1's description of a picture — the screenshot often shows the error text
you are about to go looking for.

1. Check the running system first, through the read-only diagnostic access the
   setup provides and no other way. A defect reported from the live site is
   often the state of the live site and not the code. The details of that
   access are removed from this release. If it is not set up, say so in your
   note in one line and go on without it. Never work around it.
2. Reproduce it where a browser journey or a unit test already can. Run **one**
   spec, never the suite (`e2e/README.md`).
3. Find the code behind the screen with the two tables in step 7, and read it.
4. Post a root-cause note: the file and line, what is actually happening, and
   what the fix likely is. Label `triage:investigated`.
5. Scope the fix, in one question: can the promised behaviour be restored
   without a migration, a new screen, field or nav item, a change to who may see
   what, a protected path, or a decision nobody has made? All no — add
   `triage:remediate` and phase 3 starts on its own. Any yes — add
   `triage:owner-review`, say in the note which one and why, and mention the
   owners. `triage:investigated` goes on either way.

**The running system is read-only, and its data stays out of what you write.**
Two rules go with step 1:

- If the cause is the state of the running system and not the code, no branch
  can fix it. Say in the note exactly what a person must do, add
  `triage:owner-review`, and mention the owners. Never try to do it yourself.
- A note carries field names, counts, ids, statuses and error text. It never
  carries a customer name, an address, a price or any other row value. Every
  comment on an issue raised by email is sent to the tester. Trim a log line
  before you quote it.

If reproducing it would need a **new** test, say so in the note and stop. You
cannot write one, and inventing a reason it is unreproducible would be worse
than the truth.

Fixing it is phase 3 — `docket` on `triage:remediate`, a different session with
different permissions. An owner's `agent:go` is the manual override, to re-run a
phase or to release a defect after an owner review.
