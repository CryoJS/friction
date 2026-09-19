# Friction

Give it a URL and a task. One AI agent, a competent first-time visitor, attempts the task on the live site in an isolated Browserbase browser. Friction is detected as it happens, streamed to a control room, and ranked in a report with screenshot evidence. Then Friction proposes a fix for the worst findings, **proves** whether it works by re-running the same task in a fresh browser with the fix installed, and, for a verified fix, can open a draft pull request against your repository. Built for Hack the North 2026.

Setup, env vars, deploy commands and the demo runbook: **[SETUP.md](SETUP.md)**.

## Architecture

```
control-room (Vite/React) --POST /runs--> orchestrator (Node/Express) --events, fixes, evidence--> worker (Cloudflare)
        ^        \--"Open pull request"-->   | Browserbase + Stagehand + OpenAI; GitHub (PAT)     | D1: runs, events, findings, fixes
        +------------- SSE / replay / report / evidence --------------------------------------------+ R2: screenshots
```

1. The control room POSTs `{url, task}` to the orchestrator, which creates the run on the Worker and returns a `runId` at once.
2. One agent runs in lane **`primary`**, in its own Browserbase **session** inside a fresh **context**, capped at 15 steps: **observe** (screenshot + Stagehand's accessibility tree pruned to interactive elements and headings), **plan** (OpenAI Responses API: image input, strict function call, one neutral system prompt), **act** (Stagehand), **capture** (screenshot to R2, step event to the Worker).
3. After every step the **pure detectors** in `packages/shared/src/friction.ts` run over the events so far. Findings are deduplicated by category + selector; a repeat raises the finding's `hitCount` ("the agent hit this 3 times") instead of adding a new one. Each new finding gets one Structured Outputs call that writes only the judgement.
4. **Fix verification** (`fixer.ts`, `verify.ts`), for the top `VERIFY_TOP_N` findings, one at a time: a model proposes a small JS patch; a **brand-new** session installs it with `page.addInitScript()` before the first navigation (so the fix is there from first paint), and the identical task is re-run in lane **`verify`**. Verified = the outcome went from failure/timeout to success, or the category no longer fires where it did; otherwise rejected, with the reason. The patch only changes the DOM in Friction's own disposable browser, never your site.
5. **Pull requests** (`repo.ts`, `pr.ts`): a verified fix is mapped to one source file with GitHub code search (selector and visible text, never the browser's DOM), and a model writes the complete new file. Only a click on **Open pull request** commits it to `friction/fix-<findingId>` and opens a **draft** PR. Never merged, never force-pushed.
6. The Worker validates every event with zod, stores it in **D1**, mirrors primary-lane friction into `findings`, keeps fixes in `fixes`, and fans out to SSE clients from an in-memory `Map` (no Durable Object). It also tails D1, so delivery survives the producer and the viewer landing on different isolates. The stream ends when the run is `completed`, after verification.
7. The control room shows one live pane during the run; once a fix is being verified, a second pane appears beside it. The Report leads with each fix's **Before / After** comparison (both lanes, rendered by the same component), then the ranked findings with screenshot evidence.
8. **Replay is a first-class mode.** `?replay=1` fetches `GET /api/runs/:id` once and plays it back client-side: no orchestrator, no OpenAI, no Browserbase, no wifi.
9. Every layer has a fallback: no producer -> the Worker streams `fixtures/golden-run.json` (which includes one verified and one rejected fix); no Worker -> the control room plays the copy compiled into its bundle; no API keys -> the orchestrator replays the golden run, verification included, through the *real* pipeline.
10. `packages/shared` is the single source of truth: zod event contracts, the agent, detectors, the pure rules of verification and PRs (`fixes.ts`), report assembly, the fixture. All three apps import its TypeScript source directly; there is no build step.
11. The OpenAI model is read from `OPENAI_MODEL` and nowhere else. No model name appears in this repo.

## Who owns what

| Dev | Area | Path | Notes |
| --- | --- | --- | --- |
| **A** | Orchestrator | `apps/orchestrator` | Browserbase sessions, Stagehand, OpenAI planner + judge + fixer, the agent loop, verification, repo mapping, PRs, `/suggest-tasks`. Tune prompts in `planner.ts` and `fixer.ts`; page-side measurement lives in `pageScripts.ts` |
| **B** | Worker | `apps/worker` | Hono routes, D1 schema and queries (`db.ts`), SSE (`stream.ts`, `hub.ts`), R2 evidence, report, deploys |
| **C** | Control room | `apps/control-room` | React UI. State is one reducer (`lib/runState.ts`) fed by `hooks/useRunStream.ts`. Works against the fixture with nothing else running |
| **D** | Shared, friction, demo | `packages/shared`, `fixtures/`, `scripts/` | Contracts, detectors + tests, verification rules + tests, the golden run, the demo shop, the demo itself |

The contract between everyone is `packages/shared/src/events.ts`. Change it there, run `pnpm typecheck`, and every app tells you what broke.

## What is verified, and what is not

Verified by running it:

- `pnpm typecheck` and `pnpm test` (the detectors reproduce every friction occurrence recorded in the fixture, incrementally, in both lanes; plus the rules of dedupe, verification verdicts, patch validation, repo search ranking, generated-file checks and the PR body).
- The **real browser loop and real verification**, via `pnpm --filter @friction/orchestrator smoke`: local Chromium sessions through the real `runAgent` against the demo shop, all expected findings from real browser signals, then two fixes through the real `verifyFix`: a genuine patch installed with `addInitScript` in a fresh session comes back **verified**, an inert one **rejected**.
- The whole pipeline in mock mode, end to end through Worker, D1, SSE and the control room: primary run, both verifications, verdicts computed by the real detectors, the run completing, the stream ending.

**Not verified, because no credentials existed when this was built:** the OpenAI calls (planner, judge, fixer, source generation, suggest-tasks), Browserbase session creation, and every GitHub call (code search, reading, branch, commit, draft PR). They type-check against the installed SDKs (`openai` 6, `@browserbasehq/sdk`, Stagehand 3.7.3, `@octokit/rest` 22) and were written from those type definitions, but they have never executed. Start with `BROWSER_ENV=LOCAL` and a throwaway repository so only one unknown is in play at a time.

## Decisions worth knowing

- **Stagehand is pinned to 3.7.3, not 4.x.** v4 validates `modelName` against a closed allow-list at runtime, which cannot coexist with "the model comes from an env var", and it needs Node 22.18+. v3 attaches to an existing Browserbase session over CDP, as the design calls for. Stagehand v3 replaced its Playwright layer with a CDP-native driver that keeps the Playwright-style page API.
- **Targets resolve in two tiers.** The planner cites an element id from Stagehand's accessibility snapshot; we map it to its XPath and pass Stagehand a ready-made `Action`, so `act()` needs no second model call. `stagehand.observe()` is the fallback when the id is stale.
- **Screenshots are downscaled in the browser** (CDP clip scale, 1280x720 -> 768x432) for the model; full size goes to R2. The two captures must never run concurrently, and the clip is document-relative, not viewport-relative. Both are commented where they matter; both were found by testing.
- **The in-memory SSE `Map` holds queues, not streams.** Workers forbid one request from writing to another's response, so each connection drains its own queue. Connections recycle themselves before the free plan's 50-D1-queries-per-request limit.

### Deviations from the original contract

All additive; consumers must tolerate their absence.

- `actionType` gains **`"press"`**: the agent may choose the keyboard, and `keyboard_trap` fires only when it actually pressed Tab.
- The step payload gains optional `value`, `viewport` (so a bbox scales onto any screenshot size) and **`signals`**: the raw observations the detectors need (URL after, error texts, overlay appeared, keys pressed, focus moved, same-name count). The base payload could not express them.
- The friction payload gains optional `summary`, `whyItMatters`, `judgedBy`; `status` gains `message`; `done` gains `summary`. `findings` gains two nullable columns for the first two.
- A ninth detector, `ambiguous_label`, since the category existed without one.
- The persona system is gone. The envelope's `personaId` became `lane` (`"primary"` or `"verify"`), plus an optional `fixId` on verify-lane events. The `personas` table is dropped; the primary session and outcome live on `runs`.
- `fix` joins the event union. Fix events are written by the Worker (`POST /api/runs/:id/fixes`), which assigns their seq. The fix payload gains optional `category`, `note`, and the verify session's `liveViewUrl` / `replayUrl`; the `fixes` table also holds `source_sha`, so a PR never overwrites a file that changed since the fix was generated.
- The friction payload gains `findingId`, `findingKey`, `selector`, `hitCount`, `lastSeq` (dedupe); the status payload gains `session` (how a verify lane's live view reaches the UI).
- Migrations: `0002_lanes.sql` (personas -> lanes; lossy for old three-persona runs, see SETUP.md) and `0003_fixes.sql`. The spec named the fixes migration `0002_fixes.sql`; it is `0003` because the lane change needed its own migration first.
