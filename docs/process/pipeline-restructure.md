# The pipeline restructure

In September 2026 several agents and developers were pushing merge requests at once, and every pipeline ran on one shared runner. The pipeline definition is kept as [`ci-gates/pipeline.reference.yml`](../../ci-gates/pipeline.reference.yml).

## What was wrong

Warren Vogel identified runner capacity as the bottleneck and asked for dedicated runners. He also commissioned a review of the pipeline, written by a coding agent, dated 21 September and covering 23 days. Its figures are recorded in the original repository, in the pipeline's comments and commit messages.

- **The stages were the order.** An install job held the runner for a median 3 min 16 s before anything else could start, and proved nothing the other jobs did not. The longest job in each stage set the start of the next. The critical path was 20 min 47 s against 36 min 20 s of total job time.
- **Retrying was free and hid a flake.** One suite produced 28 of the 102 hard failures in the window, 27% of all red, and nobody chased it for twelve days because clicking retry was cheaper than reading the trace.
- **Documentation paid for code checks.** The heavy jobs cost about fourteen of a pipeline's twenty runner-minutes. On one busy day, documentation-only merge requests queued behind 26 code merge requests and each burned all twenty.
- **Nothing tested the merged result.** On 10 September a broken browser journey sat on the main branch for hours. Two branches had each passed alone, and the journeys had never run on the main branch.

## What changed

August fixes let a superseded pipeline be cancelled mid-run, stopped the browser job building a second time, and ran browser jobs one at a time because they shared fixed ports. Then:

- **Heavy jobs skip documentation-only changes** (9 September, on Warren's direction). The check is an allowlist of documentation file shapes, so any unrecognised path runs everything. It is [`ci-gates/docs-only.mjs`](../../ci-gates/docs-only.mjs).
- **Every job starts at once** (21 September). The install job was dropped, and only the browser job waits for the build. The recorded cost: a red lint no longer stops the build, about 8.6 runner-hours over the 23 days, 7.7% of the total.
- **The browser journeys run on the main branch after each merge**, and the image publish waits for them.
- **Retries cover machine failures only**, at most two, so a flaky test still shows as red.
- **Dedicated runners**, installed from 24 September by an intern working under Warren's direction.

Warren read the review and directed the change.

## The result

Two kinds of figure, kept apart.

**What the repository records.** The commit for the 21 September change projects a critical path of build 4 min 32 s plus browser tests 5 min 50 s. It is a projection made at the time, never re-measured.

**What was measured afterwards.** From the code host's pipeline history, the median time from push to finished pipeline was 88 min 56 s between 10 and 21 September 2026, and 10 min 17 s between 24 September and 2 October. Flaky failures fell from 52 across the 400 pipelines of the 23 days the review covered to 1 of 104 afterwards. In the days between, with the restructure in place but not yet the dedicated runners, the median was 71 min 4 s.

The credit is shared. Warren identified the bottleneck, requested the runners and directed the restructure. The intern installed the runners, and the dedicated hardware accounts for most of the gain.

## What was not solved

- Merge-request pipelines still test the branch, not the merged result. The main-branch journeys find a clash only after merge, so agents still rebased and re-ran first.
- Test and browser jobs still ran one at a time. The comments said this would last until the new runners were live, and no later change removed it.
- The documentation-only check treats agent skills and settings as prose, so a permission change alone skips the heavy jobs.
- The measured figures come from a one-off report built from the code host, not from anything in the repository.
