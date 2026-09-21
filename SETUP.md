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

Copy the environment template before starting the apps:

```bash
cp .env.example .env
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
```

The template is intentionally safe to copy as is. With no credentials filled in, Friction runs in mock mode and replays the golden run through the real control room, Worker, event stream, findings, and verification pipeline.

Start all three local apps:

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). Choose **Replay the golden run** for the fastest demo, or enter a URL and choose **Scan & test** to exercise the scan flow in mock mode.

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

## Deploying the demo

The Worker can be deployed to Cloudflare and serves the built in demo shop at `/demo-shop`:

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create friction
pnpm exec wrangler r2 bucket create friction-evidence
pnpm db:migrate:remote
pnpm deploy:worker
```

After deployment, set `WORKER_URL` to the Worker URL. The control room can be built and deployed to Cloudflare Pages with `VITE_WORKER_URL` and `VITE_ORCHESTRATOR_URL` in `apps/control-room/.env.production`:

```dotenv
VITE_WORKER_URL=https://friction-worker.<your-subdomain>.workers.dev
VITE_ORCHESTRATOR_URL=http://127.0.0.1:8788
```

```bash
pnpm deploy:pages
```

For a hosted live scan, the orchestrator still needs to run somewhere that can reach the Worker, OpenAI, Browserbase, and any configured GitHub repository.

## Demo flow

For a polished walkthrough, point Friction at the deployed `/demo-shop` route or use the built in replay:

1. Show the URL input and start a scan.
2. Open a task node and let the live event stream show the agent navigating.
3. Open the report and show a repeated issue with screenshot evidence.
4. Open the fix card and compare the primary and verification lanes.
5. If GitHub is configured, preview or open the draft PR with its regression test.

Live scans use one browser run per generated task and may run additional verification sessions. Mock mode is the fastest and cheapest way to explore the product.
