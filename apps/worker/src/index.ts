/**
 * Friction data plane: D1 for run metadata / events / findings, R2 for
 * evidence screenshots, SSE for the live control room.
 *
 * Nothing here talks to the orchestrator. Replay (GET /api/runs/:id), the
 * report and evidence all keep working when the orchestrator is dead.
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { demoShopResponse } from "@friction/shared/demo-shop";
import {
  CreateRunRequestSchema,
  CreateScanRequestSchema,
  FixUpsertSchema,
  GOLDEN_EVIDENCE_PREFIX,
  GOLDEN_RUN_ID,
  OVERLAY_VERSION,
  RunPatchSchema,
  ScanPatchSchema,
  TaskPullRequestSchema,
  assembleReport,
  assembleScanReport,
  buildReportFromSnapshot,
  formatIssues,
  isAllowedOrigin,
  normalizeTargetUrl,
  parseAnnotationsQuery,
  parseEventBatch,
  renderMockScreenshot,
  SNAPSHOT_CSP,
  toAnnotationFinding,
  type AnnotationsResponse,
  type CreateRunResponse,
  type CreateScanResponse,
  type FixListResponse,
  type PostFixResponse,
  type PostEventsResponse,
  type RunListResponse,
  type RunSnapshot,
  type ScanListResponse,
} from "@friction/shared";
import { getGoldenRun, rebaseGoldenRun } from "@friction/shared/golden";
import {
  countEvents,
  createRun,
  ensureSchema,
  getEvents,
  getFixes,
  getReportRows,
  getRun,
  insertEvents,
  listRuns,
  patchRun,
  upsertFix,
} from "./db";
import { createScan, getLatestScanByHost, getRunScanLink, getScan, getScanFindingRows, getScanTree, listScans, patchScan, upsertTaskPullRequest } from "./scanDb";
import type { AppEnv } from "./env";
import { broadcast } from "./hub";
import { handleStream } from "./stream";

const app = new Hono<AppEnv>();

/**
 * The annotation overlay's only endpoint, called by a bookmarklet running on
 * the user's OWN site, so it is the one route with an open CORS policy. The
 * global policy in isAllowedOrigin() below stays restricted: widening it
 * would open every mutating route on this Worker.
 *
 * This MUST be registered before the global cors() middleware. Hono's
 * cors() answers an OPTIONS preflight itself and never calls next(), so
 * whichever cors() middleware is outermost (registered first) is the one
 * that resolves the preflight — the global one would otherwise shadow this
 * one for every OPTIONS request, including OPTIONS /api/annotations, and
 * the bookmarklet's declared allowHeaders would never take effect for any
 * fetch that triggers a preflight. Being outermost also means, for a plain
 * GET, this middleware's header write on the way back out happens last and
 * so still wins over the global middleware's.
 */
app.use("/api/annotations", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], allowHeaders: ["Content-Type"], maxAge: 3600 }));

/* CORS: open to localhost (any port) and *.pages.dev. */
app.use(
  "*",
  cors({
    origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Last-Event-ID"],
    maxAge: 86_400,
  }),
);

app.use("/api/*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

app.onError((err, c) => {
  console.error("[worker] unhandled:", err);
  return c.json({ error: err instanceof Error ? err.message : "internal error" }, 500);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

app.get("/", (c) => c.json({ name: "friction-worker", ok: true }));
app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

async function readJson(req: Request): Promise<unknown | undefined> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------- runs */

app.post("/api/runs", async (c) => {
  const parsed = CreateRunRequestSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: formatIssues(parsed.error.issues) }, 400);
  const url = normalizeTargetUrl(parsed.data.url);
  if (!url) return c.json({ error: "url: not a valid http(s) URL" }, 400);

  const { scan } = parsed.data;
  if (scan && !(await getScan(c.env.DB, scan.scanId))) return c.json({ error: `scan ${scan.scanId} not found` }, 404);
  const run = await createRun(c.env.DB, { url, task: parsed.data.task, scan });
  const body: CreateRunResponse = { runId: run.id };
  return c.json(body, 201);
});

app.get("/api/runs", async (c) => {
  const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query("limit") ?? "20", 10) || 20));
  const body: RunListResponse = { runs: await listRuns(c.env.DB, limit) };
  return c.json(body);
});

/**
 * The orchestrator reports the primary session's live_view_url / session_id /
 * replay_url as it comes up, and marks the run verifying / completed.
 */
app.patch("/api/runs/:id", async (c) => {
  const runId = c.req.param("id");
  const parsed = RunPatchSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: formatIssues(parsed.error.issues) }, 400);
  if (!(await getRun(c.env.DB, runId))) return c.json({ error: `run ${runId} not found` }, 404);

  const run = await patchRun(c.env.DB, runId, parsed.data);
  if (run) broadcast(runId, { kind: "run", run });
  return c.json({ run });
});

/** Single event or array. Valid events are stored even if others in the batch are not. */
app.post("/api/runs/:id/events", async (c) => {
  const runId = c.req.param("id");
  const raw = await readJson(c.req.raw);
  if (raw === undefined) return c.json({ error: "body must be JSON" }, 400);

  const batch = parseEventBatch(raw);
  const events = batch.events.filter((event, index) => {
    if (event.type === "fix") {
      // The Worker assigns fix events their seq; accepting one here could collide with it.
      batch.rejected.push({ index, error: `fix events go to POST /api/runs/${runId}/fixes` });
      return false;
    }
    if (event.runId === runId) return true;
    batch.rejected.push({ index, error: `runId "${event.runId}" does not match /api/runs/${runId}` });
    return false;
  });
  if (events.length === 0) {
    const body: PostEventsResponse = { accepted: 0, duplicates: 0, rejected: batch.rejected };
    return c.json(body, 400);
  }
  if (!(await getRun(c.env.DB, runId))) return c.json({ error: `run ${runId} not found` }, 404);

  const { inserted, duplicates, runChanged } = await insertEvents(c.env.DB, runId, events);
  for (const { rowId, event } of inserted) broadcast(runId, { kind: "event", rowId, event });
  if (runChanged) {
    const run = await getRun(c.env.DB, runId);
    if (run) broadcast(runId, { kind: "run", run });
  }

  const body: PostEventsResponse = { accepted: inserted.length, duplicates, rejected: batch.rejected };
  return c.json(body);
});

/**
 * Upsert the fix for one finding. Stores the row (including the complete new
 * file content, when sent), records a `fix` event in the verify lane with a
 * Worker-assigned seq, and broadcasts it. Returns both, seq included.
 */
app.post("/api/runs/:id/fixes", async (c) => {
  const runId = c.req.param("id");
  const parsed = FixUpsertSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: formatIssues(parsed.error.issues) }, 400);
  if (!(await getRun(c.env.DB, runId))) return c.json({ error: `run ${runId} not found` }, 404);

  const { fix, event, rowId } = await upsertFix(c.env.DB, runId, parsed.data);
  broadcast(runId, { kind: "event", rowId, event });
  const body: PostFixResponse = { fix, event };
  return c.json(body);
});

app.get("/api/runs/:id/fixes", async (c) => {
  const runId = c.req.param("id");
  if (runId === GOLDEN_RUN_ID) {
    // The fixture has fix events, not rows: the latest event per finding is the row.
    const latest = new Map<string, FixListResponse["fixes"][number]>();
    for (const e of getGoldenRun().events) {
      if (e.type !== "fix") continue;
      latest.set(e.payload.findingId, { ...e.payload, id: `${runId}:${e.payload.findingId}`, runId, newFileContent: null, sourceSha: null, createdAt: e.ts, updatedAt: e.ts });
    }
    const body: FixListResponse = { fixes: [...latest.values()] };
    return c.json(body);
  }
  if (!(await getRun(c.env.DB, runId))) return c.json({ error: `run ${runId} not found` }, 404);
  const body: FixListResponse = { fixes: await getFixes(c.env.DB, runId) };
  return c.json(body);
});

/**
 * REPLAY. Reads D1 only, so it works with the orchestrator dead. A run nobody
 * ever produced events for resolves to the golden run, same as its stream did.
 */
app.get("/api/runs/:id", async (c) => {
  const runId = c.req.param("id");
  if (runId === GOLDEN_RUN_ID) return c.json(getGoldenRun());

  const run = await getRun(c.env.DB, runId);
  if (!run) return c.json({ error: `run ${runId} not found` }, 404);

  const events = await getEvents(c.env.DB, runId);
  if (events.length === 0) return c.json(rebaseGoldenRun({ runId, run, startTs: run.createdAt }));

  const snapshot: RunSnapshot = { run, events, source: "live" };
  return c.json(snapshot);
});

app.get("/api/runs/:id/stream", (c) => handleStream(c));

app.get("/api/runs/:id/report", async (c) => {
  const runId = c.req.param("id");
  if (runId === GOLDEN_RUN_ID) return c.json(buildReportFromSnapshot(getGoldenRun()));

  const run = await getRun(c.env.DB, runId);
  if (!run) return c.json({ error: `run ${runId} not found` }, 404);
  if ((await countEvents(c.env.DB, runId)) === 0) {
    return c.json(buildReportFromSnapshot(rebaseGoldenRun({ runId, run, startTs: run.createdAt })));
  }

  const rows = await getReportRows(c.env.DB, runId);
  return c.json(assembleReport({ run, findings: rows.findings, events: rows.events, source: "live" }));
});

/* ------------------------------------------------------------------- scans */

app.get("/api/runs/:id/scan", async (c) => {
  const link = await getRunScanLink(c.env.DB, c.req.param("id"));
  return link ? c.json(link) : c.json({ error: "this run is not a task of a scan" }, 404);
});

app.post("/api/scans", async (c) => {
  const parsed = CreateScanRequestSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: formatIssues(parsed.error.issues) }, 400);
  const url = normalizeTargetUrl(parsed.data.url);
  if (!url) return c.json({ error: "url: not a valid http(s) URL" }, 400);

  const scan = await createScan(c.env.DB, url, { repo: parsed.data.repo, autoPr: parsed.data.autoPr });
  const body: CreateScanResponse = { scanId: scan.id };
  return c.json(body, 201);
});

app.get("/api/scans", async (c) => {
  const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query("limit") ?? "20", 10) || 20));
  const body: ScanListResponse = { scans: await listScans(c.env.DB, limit) };
  return c.json(body);
});

/** The orchestrator reports crawl progress, task source and status as the scan moves. */
app.patch("/api/scans/:id", async (c) => {
  const parsed = ScanPatchSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: formatIssues(parsed.error.issues) }, 400);
  const scan = await patchScan(c.env.DB, c.req.param("id"), parsed.data);
  if (!scan) return c.json({ error: `scan ${c.req.param("id")} not found` }, 404);
  return c.json(scan);
});

/** The tree the canvas polls: tasks in rank order, each with its run's live state. */
app.get("/api/scans/:id", async (c) => {
  const scan = await getScan(c.env.DB, c.req.param("id"));
  if (!scan) return c.json({ error: `scan ${c.req.param("id")} not found` }, 404);
  return c.json(await getScanTree(c.env.DB, scan));
});

/** Upsert one task's pull request outcome (the orchestrator). The tree the canvas polls carries them. */
app.post("/api/scans/:id/pull-requests", async (c) => {
  const parsed = TaskPullRequestSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: formatIssues(parsed.error.issues) }, 400);
  const scanId = c.req.param("id");
  if (parsed.data.scanId !== scanId) return c.json({ error: `scanId: expected ${scanId}` }, 400);
  if (!(await getScan(c.env.DB, scanId))) return c.json({ error: `scan ${scanId} not found` }, 404);
  const pullRequest = await upsertTaskPullRequest(c.env.DB, parsed.data);
  if (!pullRequest) return c.json({ error: `run ${parsed.data.runId} is not a task of scan ${scanId}` }, 404);
  return c.json({ pullRequest });
});

app.get("/api/scans/:id/report", async (c) => {
  const scan = await getScan(c.env.DB, c.req.param("id"));
  if (!scan) return c.json({ error: `scan ${c.req.param("id")} not found` }, 404);
  const [tree, rows] = await Promise.all([getScanTree(c.env.DB, scan), getScanFindingRows(c.env.DB, scan.id)]);
  return c.json(assembleScanReport({ tree, findings: rows.findings, evidence: rows.evidence }));
});

/** See the app.use("/api/annotations", cors(...)) registration near the top of the file for why this route's CORS is open and why ordering matters. */
app.get("/api/annotations", async (c) => {
  const query = parseAnnotationsQuery({ host: c.req.query("host"), token: c.req.query("token") });
  if (!query.ok) return c.json({ error: query.error }, 400);

  const scan = query.by === "token" ? await getScan(c.env.DB, query.value) : await getLatestScanByHost(c.env.DB, query.value);
  if (!scan) return c.json({ error: `no completed Friction scan for ${query.value}` }, 404);

  const rows = await getScanFindingRows(c.env.DB, scan.id);
  const steps = new Map(rows.evidence.map((e) => [`${e.runId}:${e.seq}`, e]));
  const evidenceBase = new URL("/api/evidence", c.req.url).toString();

  const body: AnnotationsResponse = {
    scanId: scan.id,
    scannedAt: scan.completedAt ?? scan.createdAt,
    url: scan.url,
    overlayVersion: OVERLAY_VERSION,
    findings: rows.findings.map((f) => toAnnotationFinding(f, steps.get(`${f.runId}:${f.evidenceSeq}`), evidenceBase)),
  };
  return c.json(body);
});

/* ---------------------------------------------------------------- evidence */

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
  html: "text/html; charset=utf-8",
};

function validKey(key: string): boolean {
  return key.length > 0 && key.length <= 512 && /^[A-Za-z0-9._/-]+$/.test(key) && !key.includes("..") && !key.startsWith("/");
}

function contentTypeFor(key: string, declared?: string | null): string {
  if (declared && /^image\/[a-z0-9.+-]+$/i.test(declared)) return declared;
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

app.put("/api/evidence/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!validKey(key)) return c.json({ error: "invalid key" }, 400);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty body" }, 400);
  if (body.byteLength > MAX_EVIDENCE_BYTES) return c.json({ error: "evidence too large" }, 413);

  const contentType = contentTypeFor(key, c.req.header("Content-Type")?.split(";")[0]?.trim());
  await c.env.EVIDENCE.put(key, body, { httpMetadata: { contentType } });
  return c.json({ key, bytes: body.byteLength, contentType }, 201);
});

app.get("/api/evidence/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!validKey(key)) return c.json({ error: "invalid key" }, 400);

  const object = await c.env.EVIDENCE.get(key);
  if (!object) {
    // The golden run has no binaries: its evidence is rendered from the step itself.
    const golden = key.startsWith(GOLDEN_EVIDENCE_PREFIX)
      ? getGoldenRun().events.find((e) => e.type === "step" && e.payload.screenshotKey === key)
      : undefined;
    if (golden?.type !== "step") return c.json({ error: "evidence not found" }, 404);
    return new Response(renderMockScreenshot(golden.payload), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=300",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const isSnapshot = key.endsWith(".html");
  return new Response(object.body, {
    headers: {
      "Content-Type": contentTypeFor(key, object.httpMetadata?.contentType),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: object.httpEtag,
      // Evidence is only ever shown in <img>. Never let an uploaded SVG run script.
      "Content-Security-Policy": isSnapshot ? SNAPSHOT_CSP : "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/* --------------------------------------------------------------- demo shop */

/**
 * A shop with deliberate, documented friction (see shared/demoShop.ts), served
 * from the Worker so it has a public URL that Browserbase sessions can reach.
 * A demo target nobody else can change, rate-limit or put behind a CAPTCHA.
 */
const DEMO_BASE = "/demo-shop";
const demoShop = async (c: Context<AppEnv>): Promise<Response> => {
  const url = new URL(c.req.url);
  const page = demoShopResponse(url.pathname, url.search, DEMO_BASE);
  if (page.delayMs > 0) await new Promise((done) => setTimeout(done, page.delayMs));
  return c.html(page.html, page.status as 200 | 404);
};
app.get(DEMO_BASE, demoShop);
app.get(`${DEMO_BASE}/*`, demoShop);

export default app;
