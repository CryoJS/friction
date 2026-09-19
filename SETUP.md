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
| Exercise the whole pipeline with no keys | Start all three apps, enter any URL and task, **Start run** (mock mode) |
| Test the real browser loop with no keys | `pnpm --filter @friction/orchestrator smoke` (Worker must be running; drives a local Chrome/Edge with a scripted planner against the built-in demo shop) |
| Do a real run | Fill in `.env` (below), restart the orchestrator, **Start run** |
| Replay a past run | Landing page > **Replay**, or `/?run=<id>&replay=1` |

### Checks

```bash
pnpm typecheck           # all four packages, TypeScript strict
pnpm test                # friction detector unit tests against the fixture
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
| `MAX_STEPS` | | `15` | Can lower the hard cap of 15, never raise it |
| `AGENT_TIMEOUT_MS` | | `300000` | Wall-clock budget per agent run (primary or verify) |
| `VERIFY_TOP_N` | | `2` | How many top findings (by severity) get a fix proposed and verified. Each is a full extra browser run. `0` turns verification off |
| `GITHUB_TOKEN` | PRs | | Personal access token with contents and pull-request write access to the one repository below. No GitHub App, no OAuth |
| `GITHUB_OWNER` | PRs | | Owner (user or org) of the repository verified fixes are mapped to |
| `GITHUB_REPO` | PRs | | Repository name |
| `GITHUB_BASE_BRANCH` | | repo default | Branch that fix branches start from and draft PRs target |
| `STAGEHAND_MODEL` | | `OPENAI_MODEL` | Model for Stagehand's `observe()` fallback |
| `OPENAI_REASONING_EFFORT` | | unset | Only for reasoning models that accept it |
| `OPENAI_IMAGE_DETAIL` | | `high` | `high`, `low` or `auto` |
| `BROWSERBASE_REGION` | | unset | e.g. `us-east-1` |

`GET http://localhost:8788/health` tells you the mode and exactly which variables are missing.

### Fix verification and pull requests

After the run, the top `VERIFY_TOP_N` findings each get a proposed fix: a small JavaScript patch. It is installed with `page.addInitScript()` into a **brand-new** Browserbase session (fresh context, clean cookies) before the first page loads, and the same task is re-run in the `verify` lane. The patch only ever changes the DOM inside Friction's own disposable browser; it never touches your site, server or repository. The fix is **verified** when the task went from failure/timeout to success, or the finding's category no longer fires on the page where it happened; otherwise it is **rejected**, and says why.

With `GITHUB_*` set, a verified fix is mapped to a source file with GitHub code search (from the element's selector and visible text, never from the browser's DOM), and a model writes the complete new file (never a diff). Nothing is committed until someone clicks **Open pull request** in the report: that creates `friction/fix-<findingId>`, commits the one file (refusing if the file changed since), and opens a **draft** PR. Friction never merges or force-pushes. Without `GITHUB_*` set, verified fixes simply stay unmapped.

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

Local dev does not strictly need the first one: if the Worker finds a database missing a migration it applies it itself, in order, and records it in `d1_migrations` (the table wrangler uses), so both paths are safe in either order. `0003_fixes.sql` adds the `fixes` table and `events.fix_id`.

`0002_lanes.sql` replaces the three-persona schema with lanes. It is lossy for runs recorded before it: their "cautious" persona becomes the primary lane and the other two personas' events are dropped (R2 screenshots are untouched). Local D1 and R2 state lives in `apps/worker/.wrangler/state` and survives restarts; delete that folder to start clean.

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
3. If you want to go live and the network cooperates, start a run. If it does not, `FRICTION_MOCK=1` gives a live-looking run through the real pipeline.
4. If even the Worker is dead, the control room notices and plays the golden run compiled into its own bundle.

Things that bite:

- **Browserbase concurrency.** A run holds one session at a time (verification runs open their own, one after another). "Suggest tasks" opens another; on a plan that caps concurrency, session creation returns 429 and the orchestrator waits and retries.
- **Bot protection.** Big retail sites may CAPTCHA a cloud browser. Rehearse on your real target, and keep `/demo-shop` as the target that always works.
- **`OPENAI_MODEL` unset** puts the orchestrator in mock mode. Check `/health`.
