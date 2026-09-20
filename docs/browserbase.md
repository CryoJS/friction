# How Friction uses Browserbase

Friction takes a URL, decides the most critical tasks a visitor must be able to
complete, and has an AI agent attempt each one on the live site. Friction it
finds is ranked into a site report; for the worst findings Friction proposes a
fix and **proves** it by re-running the same task in a fresh browser with the
fix installed, then opens a draft pull request.

Every one of those steps happens in a browser we do not own and cannot trust —
someone else's production website, driven by a model. Browserbase is what makes
that safe to do, repeatedly, in parallel, in front of an audience.

---

## At a glance

| Browserbase capability | Where it runs | Why it is the right tool |
| --- | --- | --- |
| **Fetch API** (`fetchAPI.create`) | `crawl.ts` stage 1, via `fetchPage.ts` | Survey ~20 pages of a site for ~$0.02 and **zero sessions**, to decide which pages deserve a real browser |
| **Sessions** | every agent run, every fix verification, every regression test | One disposable, isolated browser per run; nothing leaks between them |
| **Contexts** (`persist: false`) | created and deleted per session | Cookies, cache and storage start genuinely clean, so a verification proves the *fix*, not a warm cache |
| **Live view** (`sessions.debug`) | `liveView.ts`, embedded in the control room | The audience watches the agent work, live, in the browser it is actually driving |
| **Session replay** | linked from every finished run | Evidence after the fact: the report links to the recording of the run that produced it |
| **`solveCaptchas`, `blockAds`** | `browserSettings` on every session | Real sites have both; neither should end a QA run |
| **Concurrency + 429 backoff** | `browser.ts`, `util.ts` `Semaphore` | A scan is ~25 browser runs; the pool is sized to the plan and waits out the limit rather than failing |
| **Stagehand** (`@browserbasehq/stagehand`) | attaches to our session over CDP | `act()`, `observe()` and a real accessibility tree, on a session whose lifecycle we still control |

SDK: `@browserbasehq/sdk` ^2.16.0 and `@browserbasehq/stagehand` 3.7.3.

---

## 1. The cost ladder: Fetch before Browsers

The most recent change to the crawl is the clearest example of using Browserbase
the way its own docs recommend — **Search → Fetch → Browsers**, cheapest rung
first.

The crawl used to open a full session to read a landing page and five linked
pages. Most of that is static HTML that no browser was needed for. Now
(`apps/orchestrator/src/crawl.ts`):

1. **Fetch the landing page** with `bb.fetchAPI.create({ url, format: "raw" })`.
   No session, no minutes, about a tenth of a cent.
2. **Parse its navigation** and Fetch up to `CRAWL_FETCH_MAX` (default 20)
   same-origin pages in parallel, five at a time.
3. **Score each page** (`pageSurvey.ts`) on two axes:
   - `interactive` — forms, buttons, inputs, selects, and cart / checkout /
     signup / search wording. These are the flows the agent will be asked to
     drive.
   - `jsShell` — under 500 characters of body text *and* either a known mount
     node (`#root`, `#__next`, `#app`) or markup that is mostly `<script>`.
     Fetch does not execute JavaScript, so this is Friction noticing that what
     it fetched is **not** what a visitor sees.
4. **Spend a session only where it is earned.** Client-rendered shells and
   pages that answered 502 *must* be rendered; the highest-scoring interactive
   pages are *worth* rendering. Everything else keeps its fetched HTML.
5. One session is opened and navigated to at most `CRAWL_SESSION_MAX` (default
   3) of those pages, because the scan holds exactly one slot of the shared
   session pool.

The result is surfaced in the product, not just the logs — the scan panel says:

> Surveyed 18 pages via Fetch, opened 1 browser session for 2 of them.

Fetch's documented failure modes are treated as **routing decisions rather than
errors**: a 502 (the content limit, which differs by plan) or a timeout returns
`{ needsBrowser: true }`, and that page goes to the browser pass. The crawl can
never fail because Fetch failed — every path falls back to the original
session-based crawl, untouched. `CRAWL_FETCH_MAX=0` turns the pre-pass off
entirely.

A site that used to cost 1 session and 6 page loads to understand now typically
costs 1 session, 2 page loads and 18 fetches — a wider survey for less money.

---

## 2. One disposable browser per run

`apps/orchestrator/src/browser.ts` is the only place a session is created, and
every consumer goes through it.

```
bb.contexts.create({ projectId })          // fresh context, persist: false
bb.sessions.create({ projectId, browserSettings: { context, viewport,
                     blockAds: true, solveCaptchas: true, recordSession: true } })
new Stagehand({ env: "BROWSERBASE", browserbaseSessionID: session.id })
```

Why a **new context per session** rather than one shared browser: Friction's
whole claim is that a verified fix caused the improvement. If the verification
run reused the primary run's cookies, storage or cache, that claim would be
worthless. `persist: false` means the context is created, used once, and
deleted.

Session settings we rely on:

- `solveCaptchas: true` — a QA agent that dies on an interstitial captcha tests
  nothing. Browserbase handles it and the run continues.
- `blockAds: true` — ad iframes are noise in the accessibility tree and a source
  of false "dead click" findings.
- `recordSession: true` — every run gets a replay URL.
- `viewport: 1280×720`, fixed, because every screenshot bounding box Friction
  stores as evidence is relative to it.
- `keepAlive: false` and `api_timeout` derived from the run's own budget, so a
  hung run cannot hold a slot past its deadline.
- `region` is configurable (`BROWSERBASE_REGION`) to put the browser near the
  site under test.

**Sessions are opened for:** the crawl's browser pass, each of a scan's 5 task
agents, each fix verification (up to `VERIFY_MAX_RUNS`, default 4, per task),
two per regression test (one on the unpatched site, one patched), and the
`/suggest-tasks` convenience endpoint. A full scan is roughly 25 browser runs.

---

## 3. Concurrency, and respecting the plan's limit

Browserbase plans cap concurrent sessions, so the orchestrator treats sessions
as a scarce pooled resource rather than something to allocate freely.

- A process-wide `Semaphore` (`util.ts`) of `MAX_SESSIONS` gates **every**
  session — crawl, primary runs and verifications alike. A run waiting for one
  shows as **Queued** in the UI instead of failing.
- A scan enters the pool in task-rank order, so the most critical task gets a
  browser first.
- `sessions.create` returning **429** is not an error: `browser.ts` backs off
  (4s, 8s, 12s, 16s) and retries up to five times, logging the wait.
- `withTimeoutDisposing` (`util.ts`) handles the subtle case: a session-open
  that resolves *after* its deadline still created a real remote browser that
  nobody is holding. It would sit there burning a concurrency slot until the
  provider reaped it, so the late arrival is disposed explicitly.
- Every session is released deliberately —
  `sessions.update(id, { status: "REQUEST_RELEASE" })` followed by
  `contexts.delete(...)` — rather than being left to time out.

---

## 4. Live view: the demo, and why it is minted late

The control room embeds Browserbase's live view so you watch the agent click
through the site in real time.

The non-obvious part (`apps/orchestrator/src/liveView.ts`):
`debuggerFullscreenUrl` is **not** a page address. It is a signed, time-limited
URL pinned to one page target of one live session, and the iframe that loads it
is a real DevTools frontend holding a WebSocket. Minting it at session-create,
storing it in the database, and rendering it minutes later hands DevTools a
socket it cannot open — "Debugging connection was closed".

So Friction stores it **nowhere**. Each open session registers itself in an
in-memory map; `GET /runs/:runId/live-view` calls `sessions.debug()` and mints a
fresh URL for whatever is open *at that instant*, preferring `pages[0]` (the tab
the agent drives) over the session-level URL. No open session returns null,
which is how the UI knows to drop the iframe rather than show a dead one.

After the run, the report links the **session replay** at
`browserbase.com/sessions/<id>` — so a finding is backed by both the screenshot
evidence in R2 and the full recording of the session that produced it.

---

## 5. Stagehand on a session we own

Friction uses Stagehand by attaching it to a session it created itself
(`browserbaseSessionID`), rather than letting Stagehand create one. That keeps
context isolation, the release path and the pool accounting in our hands while
still getting Stagehand's ergonomics:

- `page.snapshot()` for the **real accessibility tree**, which `a11y.ts` prunes
  to interactive elements plus headings. This is what the planner model reads —
  far cheaper and far more reliable than asking a model to read a DOM dump.
- `stagehand.observe()` as the fallback when a planned target's element id has
  gone stale between observe and act.
- `disableAPI: true` — act/observe run in our process with our own OpenAI key,
  so there is one model configuration and one bill.

---

## 6. The part Browserbase makes possible at all: proving a fix

This is the feature that would not exist without disposable remote browsers.

For a finding, a model proposes a small JS patch. Friction then opens a
**brand-new session in a fresh context**, installs the patch with
`page.addInitScript()` **before the first navigation** — so the fix is present
from first paint, and the agent never meets the broken page — and re-runs the
*identical* task with the same step cap. The two runs are then compared
(`judgeVerification`): a fix is verified only if the outcome went from
failure to success, or the friction category stopped firing, or the task
completed in meaningfully fewer steps.

The safety property matters and is worth stating plainly: **the patch only ever
changes the DOM inside Friction's own disposable Browserbase session.** It never
reaches the user's site, their server, their users or their repository. The
session is deleted afterwards. A fix reaches a pull request only after it has
been proven this way — there is no unverified mode.

The same mechanism writes the regression test that ships in the pull request:
two more fresh sessions run the candidate test, once against the site as it is
(it must **fail**, proving it reproduces the problem) and once with the verified
patch installed (it must **pass**, proving it recognises the fix). A test that
cannot tell the two apart is thrown away.

---

## 7. Where we deliberately do *not* use it

- **Mock mode** (`FRICTION_MOCK=1`, or no keys) replays a recorded golden run
  through the real pipeline — Worker, D1, R2, SSE, detectors — with no
  Browserbase and no OpenAI. The repo runs end to end before a single API key
  exists, and it is the fallback if venue Wi-Fi blocks the API during a demo.
- **`BROWSER_ENV=LOCAL`** drives a local Chrome for prompt development, so
  iterating on prompts does not spend session minutes. No live view, no replay.
- **Fetch is crawl-only.** It is never used in verification, never in the agent
  loop, never in the bookmarklet — those need a real browser by definition, and
  a static fetch would silently prove nothing.

---

## File map

| File | Browserbase surface |
| --- | --- |
| `apps/orchestrator/src/browser.ts` | contexts, sessions, settings, 429 backoff, release |
| `apps/orchestrator/src/fetchPage.ts` | Fetch API client, concurrency, 502 → `needsBrowser` |
| `apps/orchestrator/src/pageSurvey.ts` | scoring fetched HTML: does this page need a browser? |
| `apps/orchestrator/src/crawl.ts` | the Fetch → Browsers ladder |
| `apps/orchestrator/src/liveView.ts` | `sessions.debug()`, minted per request |
| `apps/orchestrator/src/verify.ts` | fresh session + `addInitScript` fix proof |
| `apps/orchestrator/src/prTest.ts` | two sessions per regression test |
| `apps/orchestrator/src/util.ts` | `Semaphore`, `withTimeoutDisposing` |
| `apps/orchestrator/src/scanManager.ts` | session budget across a scan |

Environment variables and the full runbook: [SETUP.md](../SETUP.md).
