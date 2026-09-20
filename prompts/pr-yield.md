Raise Friction's pull request yield. Scan pull requests work (one draft PR per task, see `prompts/scan-auto-pr.md` and README pipeline step 5), but most tasks that FOUND problems still end with no PR. Make more of them end with a PR, without shipping fixes that were not proven.

Branch: `feat/pr-yield`, from `feat/scan-auto-pr` (or main once that is merged).

## The evidence (three live scans of the northpeak store, 2026-09-19)

25 tasks. 13 found nothing: correct, leave them alone. The other 12 had findings and produced 21 proposed fixes:

| What happened to the fix | Count |
| --- | --- |
| rejected: "<category> still fires" | 11 |
| rejected: "The agent never reached the page where <category> happened" | 5 |
| verified, but never mapped to a source file | 2 |
| verified and mapped: became a PR or a preview | 2 |
| verified total | 4 of 21 |

So 12 tasks with problems gave 2 pull requests. Where the yield is lost, in order:

1. **Verification slots go to findings a DOM patch cannot fix.** `selectTopFindings` ranks by severity, confidence, hit count. That picks `step_budget`, `loop` and `long_wait`: symptoms (the agent wandered, the server was slow), not causes. 9 of the 21 fixes were for those three categories; 1 was verified, and it could not be mapped because it has no element. Meanwhile the `dead_click` that caused the wandering sat below the cut (`VERIFY_TOP_N` is 2).
2. **The verdict rejects runs that plainly got better.** Real rejections: "the agent completed the task in 2 steps, down from 15 steps" (never reached the page, because the fix removed the need to); "completed the task in 2 steps, down from 5" (long_wait still fired once). `judgeVerification` only accepts failure->success, or zero hits of the category on a page the verify run reached.
3. **One shot per finding.** A rejected fix is never retried, though the rejection note says exactly what is still wrong ("dead_click still fires (2 times)").
4. **Mapping needs an element.** `searchTermsFor` uses the finding's selector and label. Findings without one (loop, long_wait), or with a structural xpath, yield no search terms, so a verified fix stays unmapped.

Re-derive these numbers yourself before changing anything (`GET /api/scans`, then each run's `/fixes`), and report the before/after in the same table.

## Read first

`packages/shared/src/fixes.ts` (`selectTopFindings`, `judgeVerification`, `describeComparison`, `searchTermsFor`, `rankSearchHits`), `fixes.test.ts`, `apps/orchestrator/src/runManager.ts` (`verifyTopFindings`, `mapToSource`), `fixer.ts` (`proposeAndReport`, the proposer's prompt and input), `verify.ts`, `repo.ts` (`findSourceFile`), `packages/shared/src/scanPr.ts` (`planTaskPullRequests`), `friction.ts` (the categories and what each detector measures).

Run `pnpm typecheck && pnpm test` first and record the baseline (control-room fails typecheck only in `components/ui/*` and `lib/utils.ts`; that is pre-existing, do not fix it or add to it).

## House rules (unchanged)

Contracts are zod schemas in `packages/shared`, every change additive and optional, old scans and `fixtures/golden-run.json` still parse. The OpenAI model comes from `OPENAI_MODEL` only: no model name anywhere. Everything runs end to end in mock mode with no keys. Nothing throws out of a background job. Every outbound call has a timeout and bounded retries. Match the surrounding code. No new dependencies.

## Decisions (made; tell me if you find one is wrong)

1. **The invariant stands: only a verified fix reaches a PR.** "More aggressive" means more fixes get a fair verification and more verified fixes get mapped. It never means shipping a fix that was not shown to help. Do not add an "unverified PR" mode.
2. **Spend verification on causes, not symptoms.** Split the categories into *fixable* (an element misbehaves: `dead_click`, `error_text`, `modal_interrupt`, `keyboard_trap`, `ambiguous_label`, `retry`) and *symptom* (`loop`, `step_budget`, `long_wait`). Selection takes fixable findings first, by the existing ranking; a symptom finding is only verified if slots are left over. Within a run, two findings on the same selector are one cause: verify the higher-ranked one only. Keep it a pure function with tests; the report's ranking does not change.
3. **A symptom can be credited to the fix of its cause.** When a fixable finding's fix is verified and a symptom finding of the same run no longer fires in that verify run, the PR body says so ("Also resolved: step_budget, loop") instead of listing the symptom as found-not-fixed. No separate fix is proposed for it.
4. **Widen the verdict, carefully.** Add a third way to be verified: the primary run and the verify run BOTH reached an outcome, the verify outcome is no worse, the category's hits went down (or the page was never needed), and steps dropped by at least 30% and at least 2. The note must state both numbers ("completed the task in 2 steps, down from 15; dead_click no longer needed to be passed"). An errored run, an inactive patch, or a worse outcome is still rejected. "No change from before" is still rejected. Every new branch of `judgeVerification` gets tests written from the real rejection notes in the table above.
5. **One retry, with the rejection as feedback.** When a fixable finding's fix is rejected with "still fires" and the patch was active, propose once more, giving the proposer the previous patch and the rejection note, and verify again. At most one retry per finding, and only while the run's total verifications stay under a cap (`VERIFY_MAX_RUNS`, default 4). Each verification is a full browser run: state the added time and cost in SETUP.md's "Scans: time and cost". The retry reuses the same fix row (same `findingId`), it does not create a second one.
6. **`VERIFY_TOP_N` default goes from 2 to 3**, still capped at 5 by config.
7. **Mapping gets fallbacks, in this order, stopping at the first that yields a file:** the finding's selector and label (today); selectors and quoted strings taken from the VERIFIED patch's own `querySelector`/`closest`/`matches` calls (the patch was proven to touch the right element); visible text of the evidence step's target; the page route of the finding's URL mapped to a routes/pages path (`/products/x` -> search `products` within `src/pages`, `app`, `routes`). Every fallback still goes through `rankSearchHits` and `committablePathProblem`: text from the scanned site never chooses a file directly. Log which fallback hit. Pure helpers in `packages/shared`, unit-tested.
8. **Say why there is no PR.** A task that found problems and ends `nothing_to_fix` must show, per finding, the furthest stage it reached and why it stopped: not selected (symptom / below the cut / same cause as fN), proposed but invalid patch, rejected (note), verified but unmapped (which search terms were tried). Today findings that were never selected are invisible in the PR panel. Extend `notFixed` reasons in `planTaskPullRequests`' input rather than adding a new table.

## Also fix (found while diagnosing)

`MAX_SCAN_TASKS` went from 10 to 5 on main. `TaskPullRequestSchema.taskIndex` and `CoveredBySchema` are bounded by `MAX_SCAN_TASKS - 1`, and the Worker re-parses stored rows on read (`toPullRequest` in `scanDb.ts`), so every recorded pull request of tasks 6-10 of older scans silently disappeared from the tree. A stored record must never stop parsing because a tuning constant changed: bound those two fields by a fixed historical maximum (9), keep `MAX_SCAN_TASKS` for how many tasks a NEW scan runs, and add a test that a task-index-9 record parses while `MAX_SCAN_TASKS` is 5. Check `ScanTaskLinkSchema` and `parseScanNode` for the same coupling.

## Phases (run each before starting the next; stop at a boundary if budget runs low and say which)

1. **Shared, pure:** the fixable/symptom split and new selection; the widened verdict; patch-derived and route-derived search terms; the schema bound fix. Tests first, from the real cases above.
2. **Orchestrator:** selection and the retry loop in `verifyTopFindings`; symptom crediting; mapping fallbacks in `findSourceFile`; the per-finding "why no PR" reasons.
3. **Control room and PR body:** "Also resolved", and the fuller found-not-fixed list in the task's pull request card. No new UI dependencies.
4. **Docs:** README "Fix verification" and "What is verified", SETUP env table (`VERIFY_TOP_N`, `VERIFY_MAX_RUNS`) and time/cost.

## Verification you owe me

Run it; do not reason about it.

1. Unit tests for every new pure function, including: a run with `step_budget` sev 4 and `dead_click` sev 3 verifies the dead_click first; two findings on one selector verify once; each of the five real "never reached the page" notes is judged correctly under the new rule (the 2-steps-down-from-15 success is verified; the 15-vs-15 timeout is not); a retry never exceeds the cap.
2. Mock mode, no keys: `smoke:scan`, `smoke:scan-pr` and `smoke:github-fake` still pass. The golden run's verdicts must not change (f13 verified, f15 rejected) unless you can show the new rule is right about f15 and update the fixture's expectations deliberately.
3. If live keys and `GITHUB_DRY_RUN=1` are set: ask me, then run ONE live scan of `https://northpeak-store.northpeak-store-htn26.workers.dev/` against `Kevin-Kolyakov/northpeak-store-test` and report the yield table next to the baseline one above. Start the orchestrator with `pnpm --filter @friction/orchestrator start`, not the watch script: a `node --watch` restart kills in-flight scans.
4. `pnpm typecheck && pnpm test` against your recorded baseline.

## Out of scope

Shipping unverified fixes. Multi-file fixes. Changing the detectors or severities. Auto-merge. Anything in `prompts/scan-auto-pr.md`'s out-of-scope list.
