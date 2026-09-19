/**
 * Friction orchestrator.
 *   POST /runs           { url, task } -> { runId } at once; three personas run in the background
 *   POST /suggest-tasks  { url }       -> three candidate tasks (convenience only)
 *   GET  /health                       -> live or mock, and which env vars are missing
 */
import express, { type NextFunction, type Request, type Response } from "express";
import {
  CreateRunRequestSchema,
  SuggestTasksRequestSchema,
  formatIssues,
  isAllowedOrigin,
  normalizeTargetUrl,
  type CreateRunResponse,
  type OrchestratorHealth,
} from "@friction/shared";
import { config } from "./config";
import { RunManager } from "./runManager";
import { suggestTasks } from "./suggest";
import { errorMessage, log } from "./util";
import { WorkerClient } from "./workerClient";

const worker = new WorkerClient(config.workerUrl);
const runs = new RunManager(config, worker);
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
  const body: OrchestratorHealth = { ok: true, mode: config.mode, missingEnv: config.missingEnv };
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

app.post("/suggest-tasks", async (req, res) => {
  const parsed = SuggestTasksRequestSchema.safeParse(req.body);
  const url = parsed.success ? normalizeTargetUrl(parsed.data.url) : null;
  if (!url) {
    res.status(400).json({ error: "url: not a valid http(s) URL" });
    return;
  }
  res.json(await suggestTasks(config, url));
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: errorMessage(err) });
});

// A persona must never be able to take the process down with it.
process.on("unhandledRejection", (reason) => log("process", `unhandled rejection: ${errorMessage(reason)}`));
process.on("uncaughtException", (err) => log("process", `uncaught exception: ${errorMessage(err)}`));

app.listen(config.port, () => {
  log("http", `orchestrator on http://localhost:${config.port}  ->  Worker ${config.workerUrl}`);
  if (config.mode === "mock") {
    const why = config.missingEnv.length > 0 ? `missing ${config.missingEnv.join(", ")}` : "FRICTION_MOCK is set";
    log("http", `MOCK MODE (${why}): runs replay the golden fixture through the real pipeline.`);
  } else {
    log("http", `LIVE MODE: ${config.browserEnv} browsers, model from OPENAI_MODEL, ${config.personaConcurrency} personas at a time.`);
  }
  void worker.healthy().then((ok) => {
    if (!ok) log("http", `WARNING: the Worker at ${config.workerUrl} is not answering. Start it with: pnpm dev:worker`);
  });
});
