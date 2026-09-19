# Friction: setup

Everything below works **before any API key exists**. With no keys the orchestrator runs in mock mode and replays the golden run through the real pipeline (Worker, D1, R2, SSE, detectors).

## Prerequisites

- **Node 22.12+** (`.nvmrc` says 22). The spec said Node 20, but Node 20 is end-of-life and `wrangler` 4 and `vitest` 5 both require 22. The orchestrator's own runtime dependencies still support 20.19+ if you ever deploy it on its own.
- **pnpm 11** (`corepack enable` picks the pinned version up from `package.json`).
- For live runs: an OpenAI key, a Browserbase key and project id. For deploys: a Cloudflare account.

```bash
pnpm install
```

> pnpm 11 fails the install if a dependency has an unreviewed install script. The decisions live in `pnpm-workspace.yaml` (`allowBuilds`). If you add a dependency and `pnpm install` exits 1 with `ERR_PNPM_IGNORED_BUILDS`, add the package there with `true` or `false`.

## Run it locally (three terminals, or one)

```bash
pnpm dev                 # all three apps at once
# or individually:
pnpm dev:worker          # Cloudflare Worker   http://localhost:8787  (local D1 + R2, no Cloudflare login needed)
pnpm dev:orchestrator    # Node orchestrator   http://localhost:8788
pnpm dev:control-room    # Vite + React UI     http://localhost:5173
```

Open http://localhost:5173.

| You want to... | Do this |
| --- | --- |
| See the UI with zero setup | Click **Replay the golden run**, or open `/?run=golden&replay=1` |
| Exercise the whole pipeline with no keys | Start all three apps, enter any URL, **Scan & test** (mock mode: a scripted crawl, 5 canned tasks, 5 runs that replay the golden run, fix verification included, through the real pipeline), or run `pnpm --filter @friction/orchestrator smoke:scan` |
| Test the real browser loop with no keys | `pnpm --filter @friction/orchestrator smoke` (Worker must be running; drives a local Chrome/Edge with a scripted planner against the built-in demo shop) |
| Do a real scan | Fill in `.env` (below), restart the orchestrator, **Scan & test**. Read [Scans: time and cost](#scans-time-and-cost) first |
| Reopen a scan | Landing page > **Recent scans**, or `/?scan=<id>` (add `&node=t2` to select a task) |
| Watch one run of a scan in full | Select its task node, then **Open full control room**, or open `/?run=<id>` |
| Replay a past run | `/?run=<id>&replay=1` |

### Checks

```bash
pnpm typecheck           # all four packages, TypeScript strict
pnpm test                # detector tests against the fixture, plus verification, scan contract and merged-report tests
pnpm golden:generate     # regenerate fixtures/golden-run.json (deterministic)
```

## Environment variables

Only the orchestrator needs secrets. Copy `.env.example` to `.env` at the repo root (or `apps/orchestrator/.env`, which wins). Real environment variables win over both files.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | live | | OpenAI Responses API |
| `OPENAI_MODEL` | live | **none, on purpose** | The model. Never hardcoded. Needs image input, function calling and Structured Outputs |
| `BROWSERBASE_API_KEY` | live* | | Browserbase sessions |
| `BROWSERBASE_PROJECT_ID` | live* | | Browserbase project |
| `WORKER_URL` | | `http://127.0.0.1:8787` | Where the Worker is |
| `PORT` | | `8788` | Orchestrator port |
| `BROWSER_ENV` | | `BROWSERBASE` | `LOCAL` drives a local Chrome/Edge instead (*then the Browserbase vars are not needed). No live view or session replay |
| `LOCAL_BROWSER_PATH` | | auto-detected | Chrome/Edge binary for `BROWSER_ENV=LOCAL` |
| `FRICTION_MOCK` | | off | `1` forces mock mode even with keys set |
| `MOCK_SPEED` | | `3` | Mock mode playback speed |
| `MAX_SESSIONS` | | `5` | Browser sessions open at once across every run and scan (1-100): a scan's crawl, every primary run and every fix verification take one. Set it to your Browserbase plan's concurrency limit. `PERSONA_CONCURRENCY` is still read as a fallback |
| `MAX_STEPS` | | `15` | Can lower the hard cap of 15, never raise it |
| `AGENT_TIMEOUT_MS` | | `300000` | Wall-clock budget per agent run (primary or verify) |
| `VERIFY_TOP_N` | | `2` | How many top findings (by severity) get a fix proposed and verified. Each is a full extra browser run. `0` turns verification off |
| `GITHUB_TOKEN` | PRs | | Personal access token. Use a **fine-grained** one scoped to exactly the repositories below, with Contents and Pull requests set to read and write and nothing else. It never leaves the orchestrator. No GitHub App, no OAuth |
| `GITHUB_OWNER` | PRs | | Owner (user or org) of the repository verified fixes are mapped to |
| `GITHUB_REPO` | PRs | | Repository name |
| `GITHUB_BASE_BRANCH` | | repo default | Branch that fix branches start from and draft PRs target |
| `GITHUB_ALLOWED_REPOS` | | | More repositories a scan may choose, comma-separated `owner/name`. With `GITHUB_OWNER/GITHUB_REPO` they are the whole list: the scan form offers them (from `GET /health`, which never carries the token) and the orchestrator refuses any other with 400 |
| `GITHUB_DRY_RUN` | | off | `1`: pull requests are previewed, never pushed. GitHub is still read (the file, open PRs); nothing is written, by a scan or by a click. Mock mode and a missing token are dry runs too |
| `GITHUB_API_URL` | | api.github.com | REST base URL, for GitHub Enterprise Server |
| `STAGEHAND_MODEL` | | `OPENAI_MODEL` | Model for Stagehand's `observe()` fallback |
| `OPENAI_REASONING_EFFORT` | | unset | Only for reasoning models that accept it |
| `OPENAI_IMAGE_DETAIL` | | `high` | `high`, `low` or `auto` |
| `BROWSERBASE_REGION` | | unset | e.g. `us-east-1` |

`GET http://localhost:8788/health` tells you the mode and exactly which variables are missing.

### Fix verification and pull requests

After the run, the top `VERIFY_TOP_N` findings each get a proposed fix: a small JavaScript patch. It is installed with `page.addInitScript()` into a **brand-new** Browserbase session (fresh context, clean cookies) before the first page loads, and the same task is re-run in the `verify` lane. The patch only ever changes the DOM inside Friction's own disposable browser; it never touches your site, server or repository. The fix is **verified** when the task went from failure/timeout to success, or the finding's category no longer fires on the page where it happened; otherwise it is **rejected**, and says why.

With `GITHUB_*` set, a verified fix is mapped to a source file with GitHub code search (from the element's selector and visible text, never from the browser's DOM), and a model writes the complete new file (never a diff). Nothing is committed until someone clicks **Open pull request** in the report: that creates `friction/fix-<findingId>`, commits the one file (refusing if the file changed since), and opens a **draft** PR. Friction never merges or force-pushes. Without `GITHUB_*` set, verified fixes simply stay unmapped.

**Scan pull requests.** With a repository connected, the scan form shows a **Repository** select (with "None") and, once one is chosen, "Open draft pull requests automatically", ticked by default. Such a scan maps its fixes to that repository and, when every run is over, opens one draft PR per task that has a verified, mapped fix: `friction/scan-<scanId>-task-<n>`, one commit per file, serially, in task order. Unticked, it behaves as above: a click per fix. A file already rewritten by an earlier task's PR, or by an open `friction/` PR from an earlier scan, is recorded as covered and not committed again. Each task's outcome is stored in the Worker (`task_pull_requests`), so the canvas shows it with the orchestrator down.

**The orchestrator has no auth.** Anyone who can reach it can start scans, and with a write token configured, make it open draft PRs against any repository on the allow-list. That is why a scan picks from an allow-list instead of typing `owner/repo`, why the token should be fine-grained and scoped to exactly those repositories, and why **the orchestrator must not be exposed publicly while `GITHUB_TOKEN` can write**. Run it on localhost or a private network, or set `GITHUB_DRY_RUN=1`.

**No GitHub call has run against the real API.** Make the first one deliberate: a throwaway repository, `GITHUB_DRY_RUN=1` first (reads only), then one scan without it.

Mock mode verifies too: it replays the golden run's recorded verification runs through the real detectors, so the verdicts are computed, not copied.

Control room (`apps/control-room/.env.local`, build-time):

| Variable | Default |
| --- | --- |
| `VITE_WORKER_URL` | `http://localhost:8787` |
| `VITE_ORCHESTRATOR_URL` | `http://localhost:8788` |

The Worker needs no secrets.

## D1 migrations

```bash
pnpm db:migrate:local    # wrangler d1 migrations apply friction --local
pnpm db:migrate:remote   # wrangler d1 migrations apply friction --remote
```

Local dev does not strictly need the first one: if the Worker finds a database missing a migration it applies it itself, in order, and records it in `d1_migrations` (the table wrangler uses), so both paths are safe in either order. `0003_fixes.sql` adds the `fixes` table and `events.fix_id`; `0004_scans.sql` adds `scans` and `scan_tasks`; `0005_task_pull_requests.sql` adds `task_pull_requests` and the nullable `scans.repo` and `scans.auto_pr`.

`0002_lanes.sql` replaces the three-persona schema with lanes. It is lossy for runs recorded before it: their "cautious" persona becomes the primary lane and the other two personas' events are dropped (R2 screenshots are untouched). Local D1 and R2 state lives in `apps/worker/.wrangler/state` and survives restarts; delete that folder to start clean.

## Scans: time and cost

A live scan is up to 5 runs (one per task) of up to 15 steps each, plus up to `VERIFY_TOP_N` verification runs per task, each a full re-run of the task. At the defaults that is up to 15 browser runs and roughly 225 planner calls with a screenshot each, plus a judge call per friction finding, a fixer call per verified finding, one task-generation call, and the crawl's one browser session. With `MAX_SESSIONS=5` the 5 primary runs all get a browser at once, so expect roughly 10-20 minutes per scan; raise `MAX_SESSIONS` to your Browserbase plan's concurrency limit to go faster, or lower `VERIFY_TOP_N` to spend less. Point it at `/demo-shop` first. Mock mode (`FRICTION_MOCK=1`, or no keys) costs nothing and finishes in a few minutes.

## Deploy the Worker

One-time, from `apps/worker`:

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create friction              # paste the printed database_id into wrangler.toml
pnpm exec wrangler r2 bucket create friction-evidence
```

Then, from the repo root:

```bash
pnpm db:migrate:remote
pnpm deploy:worker       # wrangler deploy
```

Point the orchestrator at it: `WORKER_URL=https://friction-worker.<your-subdomain>.workers.dev`.

The deployed Worker also serves the **demo shop** at `/demo-shop`: a small store with deliberate, documented friction (`packages/shared/src/demoShop.ts`). It has a public URL, so Browserbase sessions can reach it, and nobody else can change it, rate-limit it or put a CAPTCHA in front of it.

## Deploy the control room (Cloudflare Pages)

```bash
# apps/control-room/.env.production
VITE_WORKER_URL=https://friction-worker.<your-subdomain>.workers.dev
VITE_ORCHESTRATOR_URL=http://localhost:8788

pnpm deploy:pages        # vite build && wrangler pages deploy dist --project-name friction
```

The first deploy creates the Pages project. CORS on both the Worker and the orchestrator already allows `localhost` and `*.pages.dev`. The orchestrator is a long-running Node process, so it stays on a laptop or a VM; an https Pages site calling `http://localhost:8788` works in Chrome.

## Demo runbook

The demo is **replay**. Live is the bonus.

1. **The night before**, on the demo laptop, do a real run you are happy with. Its events are in local D1 and its screenshots in local R2, both on disk.
2. At demo time open `/?run=<that id>&replay=1`. It needs the local Worker and nothing else: no orchestrator, no OpenAI, no Browserbase, **no wifi**.
3. If you want to go live and the network cooperates, start a scan. If it does not, `FRICTION_MOCK=1` gives a live-looking scan through the real pipeline.
4. If even the Worker is dead, the control room notices and plays the golden run compiled into its own bundle.

Things that bite:

- **Browserbase concurrency.** A scan opens one session to crawl, then one per run and one per fix verification, never more than `MAX_SESSIONS` at once; the rest wait as **Queued**, most critical task first. A single run's sessions (primary, then each verification in turn) share the same pool. On a plan that allows fewer sessions, session creation returns 429 and the orchestrator waits and retries, but set `MAX_SESSIONS` to your plan's limit. `POST /suggest-tasks` (API only now) opens a session outside the pool.
- **The live view goes blank or shows "Debugging connection was closed".** The live view is a real DevTools frontend on a WebSocket, and its URL is signed and dies with the session. The control room mints it on demand (`GET /runs/:runId/live-view` on the orchestrator) and re-checks every 20s, so a live view only appears while a session is genuinely open, and comes down to the last step screenshot when it is not. If the orchestrator is unreachable, you get screenshots instead of a live view.
- **Bot protection.** Big retail sites may CAPTCHA a cloud browser. Rehearse on your real target, and keep `/demo-shop` as the target that always works.
- **`OPENAI_MODEL` unset** puts the orchestrator in mock mode. Check `/health`.
