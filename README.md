# Friction

Give it a URL. Friction reads the site, picks the 10 most critical tasks to QA, and has three AI personas attempt each one, each in its own isolated Browserbase browser, on the live site: 30 runs. Friction is detected as it happens, shown as a live node tree (site → tasks → persona runs), and merged into one site-wide report that ranks each issue by severity and by how many runs hit it, with screenshot evidence. Built for Hack the North 2026.

Setup, env vars, deploy commands and the demo runbook: **[SETUP.md](SETUP.md)**.

## Architecture

```
control-room (Vite/React) --POST /scans--> orchestrator (Node/Express) --scans, runs, events, evidence--> worker (Cloudflare)
        ^                                    | crawl, 10 tasks, 30 persona sessions from one pool          | D1: scans, runs, personas, events, findings
        +--- scan tree (poll) / SSE per run / replay / reports / evidence ---------------------------------+ R2: screenshots
```

**Scans.** The home page has one field and one button. **Scan & test** POSTs `{url}` to the orchestrator (`POST /scans`), which creates the scan on the Worker and returns its id at once. One browser session reads the landing page and up to five same-origin navigation pages (`crawl.ts`). One Structured Outputs call turns that into up to 10 ranked tasks, each with why it is critical and what success looks like (`taskGen.ts`). Each task then becomes an ordinary run, as below, and its planner judges completion against that success check. All 30 personas queue for one process-wide pool of `MAX_SESSIONS` browser sessions, most critical task first; a persona waiting for a session shows as **Queued**. The scan page (`?scan=<id>&node=<nodeId>`) draws the site, its tasks and their persona runs as a React Flow node tree. It polls `GET /api/scans/:id` every 2s, streams only the persona node you select (the same SSE and `PersonaColumn` a run uses), and shows `GET /api/scans/:id/report`. There, findings from every run are merged into issues by category, page and element, and ranked by severity, then by how many of the 30 runs hit them (`packages/shared/src/scanReport.ts`). If the site cannot be read or the model call fails, the scan runs 10 generic tasks and says so. In mock mode the crawl is scripted, the tasks are canned and every run replays the golden run.

Each run works as follows:

1. The run is created on the Worker with `{url, task}` (plus its scan link when it belongs to a scan) and gets a `runId` at once. The orchestrator's `POST /runs {url, task}` still starts a single run directly; the UI no longer calls it, but scripts and `smoke-local.ts` do.
2. Three personas run concurrently (`Promise.all`), each in its own Browserbase **session** inside its own **context**, so no cookies leak between them.
3. Each persona loops, capped at 15 steps: **observe** (screenshot + Stagehand's accessibility tree pruned to interactive elements and headings), **plan** (OpenAI Responses API: image input, strict function call), **act** (Stagehand), **capture** (screenshot to R2, step event to the Worker).
4. After every step the **pure detectors** in `packages/shared/src/friction.ts` run over the events so far. Each new candidate gets one Structured Outputs call that writes only the judgement. Hybrid on purpose: detection is deterministic and free, the model never decides *whether* something happened.
5. The Worker validates every event with zod, stores it in **D1**, mirrors friction into `findings`, and fans out to SSE clients from an in-memory `Map` (no Durable Object). It also tails D1, so delivery survives the producer and the viewer landing on different isolates.
6. A single run's control room (`?run=<id>`, linked from every task's panel on the scan page) renders three live columns (Browserbase live view, current action and rationale, timeline, severity-coloured alerts) and a Report tab with each finding's screenshot and the target's bbox drawn over it.
7. **Replay is a first-class mode.** `?replay=1` fetches `GET /api/runs/:id` once and plays it back client-side: no orchestrator, no OpenAI, no Browserbase, no wifi.
8. Every layer has a fallback, so the demo cannot strand you: no producer -> the Worker streams `fixtures/golden-run.json`; no Worker -> the control room plays the copy compiled into its bundle; no API keys -> the orchestrator replays the golden run through the *real* pipeline.
9. `packages/shared` is the single source of truth: zod event contracts, personas, detectors, report assembly, the fixture. All three apps import its TypeScript source directly; there is no build step.
10. The OpenAI model is read from `OPENAI_MODEL` and nowhere else. No model name appears in this repo.

## Who owns what

| Dev | Area | Path | Notes |
| --- | --- | --- | --- |
| **A** | Orchestrator | `apps/orchestrator` | Browserbase sessions, Stagehand, OpenAI planner + judge, persona loop, scans (`crawl.ts`, `taskGen.ts`, `scanManager.ts`), `/suggest-tasks`. Tune prompts in `planner.ts`; page-side measurement lives in `pageScripts.ts` |
| **B** | Worker | `apps/worker` | Hono routes, D1 schema and queries (`db.ts`), SSE (`stream.ts`, `hub.ts`), R2 evidence, report, deploys |
| **C** | Control room | `apps/control-room` | React UI in the dusk design system (`DESIGN.md`). A run's state is one reducer (`lib/runState.ts`) fed by `hooks/useRunStream.ts`; a scan polls `hooks/useScan.ts` and draws `components/scan/`. Single runs work against the fixture with nothing else running |
| **D** | Shared, friction, demo | `packages/shared`, `fixtures/`, `scripts/` | Contracts, personas, detectors + tests, the golden run, the demo shop, the demo itself |

The contract between everyone is `packages/shared/src/events.ts`. Change it there, run `pnpm typecheck`, and every app tells you what broke.

## What is verified, and what is not

Verified by running it:

- `pnpm typecheck` (4 packages, strict) and `pnpm test` (42 detector tests: the detectors reproduce exactly the 11 findings recorded in the fixture, incrementally, on the very event that evidences each; plus unit tests for the scan contracts and the merged site report).
- Every Worker route, including idempotent event posts, partial batches, SSE backlog + live push + resume-from-cursor, and all three fixture fallbacks.
- The control room in live, fixture-stream, replay and fully-offline modes, including a Worker killed and restarted mid-stream (the client resumed from event 51 of 65 with no gaps or duplicates).
- The **real browser loop**, via `pnpm --filter @friction/orchestrator smoke`: three concurrent local Chromium sessions through the real `runPersona` (Stagehand snapshot and `act`, screenshots to R2, events to D1) against the demo shop, with all seven expected findings detected from real browser signals.
- Crash isolation: a session that never opens and a model outage mid-run each end in `failed` + `done` for that persona while the third finishes normally.
- A full mock scan, via `pnpm --filter @friction/orchestrator smoke:scan`: a scripted crawl, 10 tasks and 30 persona runs through the real pipeline, and a merged report in which one issue is hit by at least 10 of the 30 runs. The scan page was checked in a browser at desktop width and at 375px.

**Not verified, because no `OPENAI_MODEL` or Browserbase credentials existed when this was built:** the four OpenAI calls (planner, judge, suggest-tasks, scan task generation), the live crawl, and Browserbase session creation. They type-check against the installed SDKs (`openai` 6, `@browserbasehq/sdk` 2.20, Stagehand 3.7.3) and were written from those type definitions, not from memory, but they have never executed. Expect to spend your first hour with real keys here. Start with `BROWSER_ENV=LOCAL` so only one unknown is in play at a time.

## Decisions worth knowing

- **Stagehand is pinned to 3.7.3, not 4.x.** v4 validates `modelName` against a closed allow-list at runtime, which cannot coexist with "the model comes from an env var", and it needs Node 22.18+. v3 attaches to an existing Browserbase session over CDP, as the design calls for. Stagehand v3 replaced its Playwright layer with a CDP-native driver that keeps the Playwright-style page API.
- **Targets resolve in two tiers.** The planner cites an element id from Stagehand's accessibility snapshot; we map it to its XPath and pass Stagehand a ready-made `Action`, so `act()` needs no second model call. `stagehand.observe()` is the fallback when the id is stale.
- **Screenshots are downscaled in the browser** (CDP clip scale, 1280x720 -> 768x432) for the model; full size goes to R2. The two captures must never run concurrently, and the clip is document-relative, not viewport-relative. Both are commented where they matter; both were found by testing.
- **The in-memory SSE `Map` holds queues, not streams.** Workers forbid one request from writing to another's response, so each connection drains its own queue. Connections recycle themselves before the free plan's 50-D1-queries-per-request limit.

### Deviations from the original contract

All additive; consumers must tolerate their absence.

- `actionType` gains **`"press"`**: the keyboard persona can only press keys, and `keyboard_trap` has to know one was pressed.
- The step payload gains optional `value`, `viewport` (so a bbox scales onto any screenshot size) and **`signals`**: the raw observations the detectors need (URL after, error texts, overlay appeared, keys pressed, focus moved, same-name count). The base payload could not express them.
- The friction payload gains optional `summary`, `whyItMatters`, `judgedBy`; `status` gains `message`; `done` gains `summary`. `findings` gains two nullable columns for the first two.
- A ninth detector, `ambiguous_label`, since the category existed without one.
