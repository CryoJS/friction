# Set up Friction

This guide gets the project running locally. You can explore the complete demo without API keys; live browser runs are optional.

## Prerequisites

- Node.js 22.12 or newer
- pnpm 11 (`corepack enable` will use the version pinned in `package.json`)

Install dependencies from the repository root:

```bash
pnpm install
```

## Quick start

You do not need an `.env` file for the credential-free demo. Install dependencies and start the complete local stack:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). With no complete set of live credentials, the orchestrator automatically runs in mock mode and replays the golden run through the real control room, Worker, event stream, findings, and verification pipeline. You can also enter a URL to exercise the scan flow in mock mode.

To configure live browser runs, copy the template and fill in the values you need, then restart `pnpm dev`:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

To run the services separately:

```bash
pnpm dev:worker         # http://localhost:8787
pnpm dev:orchestrator   # http://localhost:8788
pnpm dev:control-room   # http://localhost:5173
```

## Environment variables

Only the orchestrator needs secrets. Put them in the root `.env` or in `apps/orchestrator/.env`; the app level file takes precedence. Start with **[.env.example](.env.example)** and only fill in the values for the mode you want.

### Credential free mode

Leave the file unchanged, or set:

```dotenv
FRICTION_MOCK=1
```

This is the recommended way to review the UI and the end to end demo. It makes no paid API calls.

### Live browser runs

Set these values, then restart the orchestrator:

```dotenv
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=your_model_name
BROWSERBASE_API_KEY=your_browserbase_key
BROWSERBASE_PROJECT_ID=your_browserbase_project_id
```

`OPENAI_MODEL` is deliberately required and has no hardcoded default. The selected model must support image input, function calling, and Structured Outputs. To use a locally installed Chrome or Edge instead of Browserbase, set `BROWSER_ENV=LOCAL` and optionally provide `LOCAL_BROWSER_PATH`.

The local defaults are:

```dotenv
WORKER_URL=http://127.0.0.1:8787
PORT=8788
```

Visit [http://localhost:8788/health](http://localhost:8788/health) to see the active mode and missing configuration.

### Optional GitHub pull requests

Pull requests are disabled unless GitHub credentials are configured. Use a fine grained token scoped to the target repository:

```dotenv
GITHUB_TOKEN=your_token
GITHUB_OWNER=your_account_or_org
GITHUB_REPO=your_repository
GITHUB_BASE_BRANCH=main
GITHUB_DRY_RUN=1
```

Keep `GITHUB_DRY_RUN=1` while evaluating the integration. Friction previews the branch, files, title, and body without pushing anything. Remove it only when you are ready to allow draft PR creation. The local orchestrator has no authentication, so do not expose it publicly with a write capable token configured.

## Useful checks

```bash
pnpm typecheck
pnpm test
```

The repository also includes smoke commands for the real browser loop and scan pipeline. They require the Worker to be running unless noted:

```bash
pnpm --filter @friction/orchestrator smoke
pnpm --filter @friction/orchestrator smoke:scan
pnpm --filter @friction/orchestrator smoke:pr-test
```

## Deploy the static golden-run demo with Cloudflare Pages

This is the public website path. It is intentionally only a polished showcase of the bundled golden run, so it needs no OpenAI key, Browserbase account, Worker, D1 database, R2 bucket, Node orchestrator, or secret environment variables.

You can build and preview the exact static artifact locally:

```bash
pnpm build:demo
pnpm preview:demo
```

Create a **Cloudflare Pages** project from the repository and use:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` (the repository root) |
| Build command | `pnpm build:demo` |
| Build output directory | `apps/control-room/dist` |

Leave the deploy command empty. Under **Environment variables**, add these build variables for Production (and Preview if you want preview deployments):

```dotenv
NODE_VERSION=22.12.0
PNPM_VERSION=11.4.0
```

These are tool versions, not secrets. Do not add API keys or `VITE_WORKER_URL` / `VITE_ORCHESTRATOR_URL`; `pnpm build:demo` sets demo mode during the build.

The animated preview on the landing page replays data from `fixtures/golden-run.json`, and demo mode removes backend polling and live scan controls so visitors see a deliberate showcase instead of failed requests.

The full URL scan form is available in the local app from `pnpm dev`; it is deliberately omitted from this public static build.

## Demo flow

For the complete local walkthrough:

1. Run `pnpm dev` and open [http://localhost:5173](http://localhost:5173).
2. Enter `http://127.0.0.1:8787/demo-shop` and start a scan.
3. Open a task node and let the live event stream show the agent navigating.
4. Open the report and show ranked findings, screenshot evidence, and fix verification.
5. If GitHub is configured, preview the draft PR and generated regression test.

The public Cloudflare Pages build is the lightweight showcase described above; it does not run scans. Mock mode is the fastest and cheapest way to explore the complete product locally.
