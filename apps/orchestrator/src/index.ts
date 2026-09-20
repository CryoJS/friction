/**
 * Friction orchestrator.
 *   POST /scans          { url, repo?, autoPr? }
 *                                      -> { scanId } at once; crawl, then up to MAX_SCAN_TASKS tasks, one run each, in the background.
 *                                         `repo` must be on the allow-list; with `autoPr`, one draft PR per fixable task at the end
 *   POST /scans/:scanId/stop           -> stops an active scan
 *   POST /runs           { url, task } -> { runId } at once; one agent runs in the background
 *   POST /suggest-tasks  { url }       -> three candidate tasks (convenience only)
 *   POST /runs/:runId/fixes/:findingId/pull-request
 *                                      -> opens a DRAFT PR for a verified, mapped fix.
 *                                         Only ever called by the user's click.
 *   GET  /health                       -> live or mock, which env vars are missing, and the repositories a scan may choose
 *   GET  /runs/:runId/live-view        -> a freshly minted Browserbase live view URL for whatever
 *                                         session that run has open right now, or nulls if none.
 *                                         Never stored: the URL is signed and dies with the session.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import {
  CreateRunRequestSchema,
  CreateScanRequestSchema,
  SuggestTasksRequestSchema,
  formatIssues,
  isAllowedOrigin,
  matchAllowedRepo,
  mayManageConnection,
  normalizeTargetUrl,
  type CreateRunResponse,
  type CreateScanResponse,
  type LiveViewResponse,
  type OpenPullRequestResponse,
  type OrchestratorHealth,
} from "@friction/shared";
import { config, githubConnection } from "./config";
import { NO_LIVE_VIEW, mintLiveView } from "./liveView";
import { PullRequestError, openPullRequest } from "./pr";
import { RunManager } from "./runManager";
import { ScanManager } from "./scanManager";
import { suggestTasks } from "./suggest";
import { Semaphore, errorMessage, log } from "./util";
import { WorkerClient } from "./workerClient";

const worker = new WorkerClient(config.workerUrl);
/** One pool for every browser this process opens: primary runs, fix verifications and scan crawls alike. */
const sessions = new Semaphore(config.maxSessions);
const runs = new RunManager(config, worker, sessions);
const scans = new ScanManager(config, worker, runs, sessions);
const app = express();

app.use(express.json({ limit: "64kb" }));

// Same CORS policy as the Worker: localhost on any port, and *.pages.dev.
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin as string);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  // Names only. The token never leaves this process.
  const login = githubConnection.login;
  const body: OrchestratorHealth = {
    ok: true,
    mode: config.mode,
    missingEnv: config.missingEnv,
    repos: config.allowedRepos,
    githubDryRun: config.githubDryRun,
    github: { source: githubConnection.source, ...(login ? { login } : {}) },
  };
  res.json(body);
});

/* GitHub, connected with a button (githubConnection.ts). Reading the status is open, like /health, and carries names only. */
app.get("/github", (_req, res) => {
  res.json(githubConnection.status());
});

/**
 * Managing the connection is for this machine only. This process has no login:
 * without the guard, anyone who could reach it could tick every repository the
 * token can write to, and the allow-list would mean nothing.
 */
function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (mayManageConnection({ remoteAddress: req.socket.remoteAddress, origin: req.headers.origin })) return next();
  log("http", `refused ${req.method} ${req.path} from ${req.socket.remoteAddress ?? "?"} (origin ${req.headers.origin ?? "none"})`);
  res.status(403).json({ error: "The GitHub connection can only be managed from the machine the orchestrator runs on." });
}

app.post("/github/connect", localOnly, async (_req, res) => {
  res.json(await githubConnection.start());
});

app.post("/github/allowed", localOnly, async (req, res) => {
  const repos: unknown = (req.body as { repos?: unknown } | undefined)?.repos;
  if (!Array.isArray(repos) || repos.length > 100 || !repos.every((slug) => typeof slug === "string" && slug.length <= 200)) {
    res.status(400).json({ error: "repos: expected up to 100 owner/name strings" });
    return;
  }
  res.json(await githubConnection.setAllowed(repos as string[]));
});

app.post("/github/disconnect", localOnly, (_req, res) => {
  res.json(githubConnection.disconnect());
});

/**
 * Polled by the control room while it is showing a run. Cheap and side-effect
 * free: it reads this process's registry of open sessions, and only calls
 * Browserbase when there is one.
 */
app.get("/runs/:runId/live-view", async (req, res) => {
  // No browser of our own in mock mode, so never a live view.
  const body: LiveViewResponse = config.mode === "mock" ? NO_LIVE_VIEW : await mintLiveView(config, req.params.runId);
  // The URL is short-lived by design; a cache would hand out dead ones.
  res.setHeader("Cache-Control", "no-store");
  res.json(body);
});

app.post("/runs", async (req, res) => {
  const parsed = CreateRunRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatIssues(parsed.error.issues) });
    return;
  }
  const url = normalizeTargetUrl(parsed.data.url);
  if (!url) {
    res.status(400).json({ error: "url: not a valid http(s) URL" });
    return;
  }
  try {
    const body: CreateRunResponse = { runId: await runs.start(url, parsed.data.task) };
    res.status(201).json(body);
  } catch (err) {
    // Only reachable if the Worker refused to create the run. The control room then falls back on its own.
    log("http", `could not start a run: ${errorMessage(err)}`);
    res.status(502).json({ error: `Worker unreachable at ${config.workerUrl}: ${errorMessage(err)}` });
  }
});

app.post("/scans", async (req, res) => {
  const parsed = CreateScanRequestSchema.safeParse(req.body);
  const url = parsed.success ? normalizeTargetUrl(parsed.data.url) : null;
  if (!url) {
    res.status(400).json({ error: "url: not a valid http(s) URL" });
    return;
  }
  // This process has no auth: a scan may only name a repository from the allow-list, never a free-text one.
  const requested = parsed.success ? parsed.data.repo : undefined;
  const repo = requested === undefined ? undefined : matchAllowedRepo(config.allowedRepos, requested);
  if (repo === null) {
    res.status(400).json({ error: `repo: ${requested} is not one of this orchestrator's allowed repositories` });
    return;
  }
  try {
    const body: CreateScanResponse = { scanId: await scans.start(url, { repo, autoPr: repo !== undefined && parsed.success && parsed.data.autoPr === true }) };
    res.status(201).json(body);
  } catch (err) {
    log("http", `could not start a scan: ${errorMessage(err)}`);
    res.status(502).json({ error: `Worker unreachable at ${config.workerUrl}: ${errorMessage(err)}` });
  }
});

app.post("/scans/:scanId/stop", async (req, res) => {
  const stopped = await scans.stop(req.params.scanId);
  if (!stopped) {
    res.status(409).json({ error: "This scan is no longer running." });
    return;
  }
  res.status(202).json({ scanId: req.params.scanId });
});

app.post("/suggest-tasks", async (req, res) => {
  const parsed = SuggestTasksRequestSchema.safeParse(req.body);
  const url = parsed.success ? normalizeTargetUrl(parsed.data.url) : null;
  if (!url) {
    res.status(400).json({ error: "url: not a valid http(s) URL" });
    return;
  }
  res.json(await suggestTasks(config, url));
});

app.post("/runs/:runId/fixes/:findingId/pull-request", async (req, res) => {
  const { runId, findingId } = req.params;
  try {
    const prUrl = await openPullRequest({ runId, findingId, worker, config, workerUrl: config.workerUrl });
    const body: OpenPullRequestResponse = { prUrl };
    res.status(201).json(body);
  } catch (err) {
    log("pr", `could not open a pull request for ${runId}/${findingId}: ${errorMessage(err)}`);
    res.status(err instanceof PullRequestError ? err.status : 502).json({ error: errorMessage(err) });
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: errorMessage(err) });
});

// A run must never be able to take the process down with it.
process.on("unhandledRejection", (reason) => log("process", `unhandled rejection: ${errorMessage(reason)}`));
process.on("uncaughtException", (err) => log("process", `uncaught exception: ${errorMessage(err)}`));

app.listen(config.port, () => {
  log("http", `orchestrator on http://localhost:${config.port}  ->  Worker ${config.workerUrl}`);
  // Names only, as everywhere: whose connection it is and what it may touch, never the token.
  const { source, login } = githubConnection;
  log("http", `GitHub: ${source === "connection" ? `connected as ${login}` : source === "env" ? "GITHUB_TOKEN from the environment" : "not connected"}; scans may target ${config.allowedRepos.join(", ") || "no repository"}`);
  // A stored connection may have been revoked since the last run. Never throws.
  void githubConnection.revalidate();
  if (config.mode === "mock") {
    const why = config.missingEnv.length > 0 ? `missing ${config.missingEnv.join(", ")}` : "FRICTION_MOCK is set";
    log("http", `MOCK MODE (${why}): runs replay the golden fixture through the real pipeline.`);
  } else {
    log("http", `LIVE MODE: ${config.browserEnv} browsers, model from OPENAI_MODEL, ${config.maxSessions} browser sessions at a time.`);
  }
  void worker.healthy().then((ok) => {
    if (!ok) log("http", `WARNING: the Worker at ${config.workerUrl} is not answering. Start it with: pnpm dev:worker`);
  });
});
