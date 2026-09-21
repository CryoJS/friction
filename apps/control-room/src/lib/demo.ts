import {
  GOLDEN_RUN_ID,
  OVERLAY_VERSION,
  assembleScanReport,
  buildReportFromSnapshot,
  findingsFromEvents,
  mockScreenshotDataUri,
  toAnnotationFinding,
  type AnnotationFinding,
  type AnnotationsResponse,
  type Anchor,
  type FixListResponse,
  type RunSnapshot,
  type ScanReportResponse,
  type ScanTreeResponse,
  type ScanTreeTask,
  type Severity,
  type StepEvent,
  type StepPayload,
} from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";

/** The static site's one runnable scan. It is the same fixture the Worker serves as `golden`. */
export const DEMO_SCAN_ID = GOLDEN_RUN_ID;
const DEMO_SCAN_PREFIX = `${DEMO_SCAN_ID}-run-`;

const DEMO_TASKS = [
  {
    title: "Find a winter jacket and add it to the cart",
    whyCritical: "A first-time visitor should be able to find a jacket and add it to the cart without repeating a click or guessing what went wrong.",
    successCheck: "The item is added to the cart and the agent can explain every blocking interaction.",
  },
  {
    title: "Browse men's jackets and open the right product",
    whyCritical: "Visitors need a clear path from the category page to a product that matches their intent.",
    successCheck: "The agent reaches the Alpine Down Parka product page without getting blocked by interruptions.",
  },
  {
    title: "Choose a size and add the jacket to the cart",
    whyCritical: "The primary call to action should explain what is missing when a required option has not been selected.",
    successCheck: "The selected jacket and size appear in the cart after one clear action.",
  },
  {
    title: "Continue shopping without losing the page context",
    whyCritical: "Unexpected overlays and slow navigation make visitors lose confidence before they reach a product.",
    successCheck: "The agent can dismiss interruptions and keep moving through the shopping flow.",
  },
  {
    title: "Complete the first-time visitor shopping path",
    whyCritical: "The full journey should be short, understandable, and resilient when an interaction does not work immediately.",
    successCheck: "The agent finishes the journey or clearly reports the exact friction that prevented completion.",
  },
] as const;

/** The hosted showcase replays the fixture locally, so these timings make each phase visible over about one minute. */
const DEMO_CRAWL_MS = 8000;
const DEMO_TASK_GAP_MS = 3000;
const DEMO_PRIMARY_MS = 29000;
const DEMO_VERIFY_MS = 11000;
const DEMO_TASK_TOTAL_MS = DEMO_PRIMARY_MS + DEMO_VERIFY_MS;
const DEMO_SCAN_TOTAL_MS = DEMO_CRAWL_MS + (DEMO_TASKS.length - 1) * DEMO_TASK_GAP_MS + DEMO_TASK_TOTAL_MS;

/** Five task slots make the static canvas read like a complete site-wide scan. */
function taskRunIdsForScan(scanId: string): string[] {
  return DEMO_TASKS.map((_, index) => `${scanId}-task-${index}`);
}

export const DEMO_TASK_RUN_IDS = taskRunIdsForScan(DEMO_SCAN_ID);

let nextDemoRun = 0;

/** Creates a fresh URL-safe scan id so every static demo launch starts over. */
export function createDemoScanId(): string {
  nextDemoRun += 1;
  const scanId = `${DEMO_SCAN_PREFIX}${nextDemoRun}`;
  demoScanStarts.set(scanId, Date.now());
  return scanId;
}

/** The click time is timer zero. A bookmark/reload starts its clock on first read. */
const demoScanStarts = new Map<string, number>();
const snapshotUrls = new Map<string, string>();

export function isDemoScanId(scanId: string): boolean {
  return scanId === DEMO_SCAN_ID || /^golden-run-\d+$/.test(scanId);
}

export function isDemoRunId(runId: string): boolean {
  if (runId === DEMO_SCAN_ID) return true;
  const match = /^(.*)-task-[0-4]$/.exec(runId);
  return Boolean(match?.[1] && isDemoScanId(match[1]));
}

function scanStartedAt(scanId: string): number {
  const existing = demoScanStarts.get(scanId);
  if (existing !== undefined) return existing;
  const created = Date.now();
  demoScanStarts.set(scanId, created);
  return created;
}

function taskInfoForRun(runId: string): { scanId: string; index: number } | null {
  const match = /^(.*)-task-([0-4])$/.exec(runId);
  const scanId = match?.[1];
  if (!scanId || !isDemoScanId(scanId)) return null;
  return { scanId, index: Number(match[2]) };
}

/** Replays the fixture's event order at showcase speed and stops at "now". */
function eventsAt(runId: string, taskStartedAt: number, now: number): RunSnapshot["events"] {
  const golden = getGoldenRun();
  const primary = golden.events.filter((event) => event.lane === "primary");
  const verify = golden.events.filter((event) => event.lane === "verify");
  const primaryStart = primary[0]?.ts ?? golden.run.createdAt;
  const primaryEnd = primary[primary.length - 1]?.ts ?? primaryStart;
  const verifyStart = verify[0]?.ts ?? primaryEnd;
  const verifyEnd = verify[verify.length - 1]?.ts ?? verifyStart;
  const primarySpan = Math.max(1, primaryEnd - primaryStart);
  const verifySpan = Math.max(1, verifyEnd - verifyStart);

  return golden.events
    .map((event) => {
      const relative =
        event.lane === "primary"
          ? ((event.ts - primaryStart) / primarySpan) * DEMO_PRIMARY_MS
          : DEMO_PRIMARY_MS + ((event.ts - verifyStart) / verifySpan) * DEMO_VERIFY_MS;
      return { ...event, runId, ts: taskStartedAt + Math.max(0, relative) };
    })
    .filter((event) => event.ts <= now);
}

function dynamicTaskSnapshot(runId: string, now: number): RunSnapshot {
  const info = taskInfoForRun(runId);
  if (!info) return getGoldenRun();

  const golden = getGoldenRun();
  const taskStartedAt = scanStartedAt(info.scanId) + DEMO_CRAWL_MS + info.index * DEMO_TASK_GAP_MS;
  const taskElapsed = now - taskStartedAt;
  const events = eventsAt(runId, taskStartedAt, now);
  const primaryStepCount = events.filter((event) => event.lane === "primary" && event.type === "step").length;
  const hasStarted = taskElapsed >= 0;
  const primaryDone = taskElapsed >= DEMO_PRIMARY_MS;
  const complete = taskElapsed >= DEMO_TASK_TOTAL_MS;
  const copy = DEMO_TASKS[info.index] ?? DEMO_TASKS[0];

  return {
    run: {
      ...golden.run,
      id: runId,
      task: copy.title,
      status: !hasStarted ? "pending" : complete ? "completed" : primaryDone ? "verifying" : "running",
      state: !hasStarted ? "idle" : complete ? "failed" : "running",
      createdAt: taskStartedAt,
      completedAt: complete ? taskStartedAt + DEMO_TASK_TOTAL_MS : null,
      outcome: complete ? "failure" : null,
      totalSteps: primaryStepCount,
      durationMs: complete ? DEMO_PRIMARY_MS : null,
    },
    events,
    source: "fixture",
  };
}

export function getDemoSnapshot(runId = DEMO_SCAN_ID): RunSnapshot {
  const id = isDemoRunId(runId) ? runId : DEMO_SCAN_ID;
  return id === DEMO_SCAN_ID ? getGoldenRun() : dynamicTaskSnapshot(id, Date.now());
}

export function getDemoTree(scanId = DEMO_SCAN_ID): ScanTreeResponse {
  const now = Date.now();
  const startedAt = scanStartedAt(scanId);
  const snapshot = getGoldenRun();
  const elapsed = Math.max(0, now - startedAt);
  const pages = pagesFromSnapshot(snapshot);
  const pagesRead = elapsed < DEMO_CRAWL_MS ? Math.floor((elapsed / DEMO_CRAWL_MS) * (pages.length + 1)) : pages.length;
  const tasks: ScanTreeTask[] =
    elapsed < DEMO_CRAWL_MS
      ? []
      : taskRunIdsForScan(scanId).map((runId, index) => {
          const taskSnapshot = dynamicTaskSnapshot(runId, now);
          const findings = findingsFromEvents(taskSnapshot.events);
          const copy = DEMO_TASKS[index] ?? DEMO_TASKS[0];
          return {
            index,
            runId,
            title: copy.title,
            whyCritical: copy.whyCritical,
            successCheck: copy.successCheck,
            status: taskSnapshot.run.status,
            state: taskSnapshot.run.state,
            stepCount: taskSnapshot.run.totalSteps ?? primarySteps(taskSnapshot).length,
            findingCount: findings.length,
            worstSeverity: findings.length > 0 ? (Math.max(...findings.map((finding) => finding.severity)) as Severity) : null,
          };
        });
  const complete = elapsed >= DEMO_SCAN_TOTAL_MS;

  const result: ScanTreeResponse = {
    scan: {
      id: scanId,
      url: snapshot.run.url,
      status: elapsed < DEMO_CRAWL_MS ? "crawling" : complete ? "completed" : "running",
      message:
        elapsed < DEMO_CRAWL_MS
          ? "Surveying the site and finding critical paths."
          : complete
            ? "Mock scan complete: five isolated browser tasks replayed with evidence."
            : "Running five isolated browser tasks and collecting evidence.",
      pages: pages.slice(0, pagesRead),
      taskSource: elapsed < DEMO_CRAWL_MS ? null : "mock",
      createdAt: startedAt,
      completedAt: complete ? startedAt + DEMO_SCAN_TOTAL_MS : null,
      repo: null,
      autoPr: false,
      survey: null,
    },
    tasks,
  };
  return result;
}

export function getDemoScanReport(scanId = DEMO_SCAN_ID): ScanReportResponse {
  const now = Date.now();
  const taskSnapshots = taskRunIdsForScan(scanId).map((runId) => getDemoSnapshot(runId));
  const findings = taskSnapshots.flatMap((snapshot) => findingsFromEvents(snapshot.events).map((finding) => ({ ...finding, runId: snapshot.run.id })));
  const result = assembleScanReport({
    tree: getDemoTree(scanId),
    findings,
    evidence: taskSnapshots.flatMap(primarySteps),
    now,
  });
  return result;
}

export function getDemoRunReport(runId = DEMO_SCAN_ID) {
  return buildReportFromSnapshot(getDemoSnapshot(runId));
}

export function getDemoFixes(runId = DEMO_SCAN_ID): FixListResponse {
  const latest = new Map<string, FixListResponse["fixes"][number]>();
  for (const event of getDemoSnapshot(runId).events) {
    if (event.type !== "fix") continue;
    latest.set(event.payload.findingId, {
      ...event.payload,
      id: `${event.runId}:${event.payload.findingId}`,
      runId: event.runId,
      newFileContent: null,
      sourceSha: null,
      createdAt: event.ts,
      updatedAt: event.ts,
    });
  }
  return { fixes: [...latest.values()] };
}

export function getDemoAnnotations(scanId: string): AnnotationsResponse {
  const taskSnapshots = taskRunIdsForScan(scanId).map((runId) => getDemoSnapshot(runId));
  const findingsById = new Map<string, { finding: ReturnType<typeof findingsFromEvents>[number]; snapshot: RunSnapshot }>();
  for (const snapshot of taskSnapshots) {
    for (const finding of findingsFromEvents(snapshot.events)) {
      if (!findingsById.has(finding.id)) findingsById.set(finding.id, { finding, snapshot });
    }
  }
  const findings: AnnotationFinding[] = [...findingsById.values()].map(({ finding, snapshot }) => {
    const steps = new Map(primarySteps(snapshot).map((step) => [step.seq, step] as const));
    const step = steps.get(finding.evidenceSeq);
    const fixes = new Map(getDemoFixes(snapshot.run.id).fixes.map((fix) => [fix.findingId, fix] as const));
    const base = toAnnotationFinding({ ...finding, runId: snapshot.run.id }, step, "https://static.invalid/evidence", fixes.get(finding.id)?.patchJs ?? null);
    const page = step?.payload.url ?? snapshot.run.url;
    return {
      ...base,
      url: page,
      anchor: demoAnchorForStep(step),
      evidenceUrl: step ? mockScreenshotDataUri(step.payload) : null,
      snapshotUrl: demoSnapshotUrl(page),
    };
  });
  const startedAt = scanStartedAt(scanId);
  const tree = getDemoTree(scanId);
  const result = {
    scanId,
    scannedAt: tree.scan.completedAt ?? startedAt,
    url: tree.scan.url,
    overlayVersion: OVERLAY_VERSION,
    findings,
  };
  return result;
}

/** Lets static issue cards render golden evidence without asking the Worker for R2. */
export function goldenPayloadForScreenshot(screenshotKey: string): StepPayload | null {
  if (!screenshotKey.startsWith("golden/")) return null;
  return getGoldenRun().events.find((event): event is StepEvent => event.type === "step" && event.payload.screenshotKey === screenshotKey)?.payload ?? null;
}

function primarySteps(snapshot: RunSnapshot): StepEvent[] {
  return snapshot.events
    .filter((event): event is StepEvent => event.lane === "primary" && event.type === "step")
    .sort((left, right) => left.ts - right.ts || left.seq - right.seq);
}

function pagesFromSnapshot(snapshot: RunSnapshot): Array<{ url: string; title: string }> {
  const pages = new Map<string, string>();
  for (const step of primarySteps(snapshot)) {
    const url = step.payload.url;
    if (!pages.has(url)) pages.set(url, titleForUrl(url));
  }
  return [...pages.entries()].map(([url, title]) => ({ url, title }));
}

function titleForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/") return "Northpeak home";
    const slug = parsed.pathname.split("/").filter(Boolean).pop() ?? "page";
    return slug
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  } catch {
    return url;
  }
}

function demoAnchorForStep(step: StepEvent | undefined): Anchor | null {
  const label = step?.payload.targetLabel.trim();
  if (!step || !label) return null;
  const tag = label.toLowerCase() === "alpine down parka" ? "a" : "button";
  return {
    xpath: "",
    tag,
    role: tag === "a" ? "link" : "button",
    name: label,
    text: label,
    attrs: {},
    ordinal: 0,
    path: new URL(step.payload.url).pathname,
  };
}

function demoSnapshotUrl(url: string): string {
  const cached = snapshotUrls.get(url);
  if (cached) return cached;
  const html = syntheticSnapshotHtml(url);
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  snapshotUrls.set(url, dataUrl);
  return dataUrl;
}

function syntheticSnapshotHtml(url: string): string {
  const product = url.includes("/products/");
  const base = escapeHtml(url);
  const content = product
    ? `
      <main class="page product-page">
        <p class="eyebrow">Men's jackets</p>
        <h1>Alpine Down Parka</h1>
        <p class="price">$249.00</p>
        <p class="copy">A warm, lightweight winter layer for cold-weather days.</p>
        <form class="product-form">
          <fieldset><legend>Colour</legend><label><input type="radio" checked /> Black</label></fieldset>
          <fieldset><legend>Size</legend><button type="button">S</button><button type="button">M</button><button type="button">L</button></fieldset>
          <button class="add" type="button">Add to cart</button>
        </form>
      </main>`
    : `
      <main class="page collection-page">
        <p class="eyebrow">Men's collection</p>
        <h1>Jackets &amp; Coats</h1>
        <a class="product-card" href="/products/alpine-down-parka">
          <span class="product-image"></span><strong>Alpine Down Parka</strong><span>$249.00</span>
        </a>
        <div class="modal" role="dialog" aria-label="Get 10% off your first order">
          <strong>Get 10% off your first order</strong>
          <p>Join the list for early access and occasional offers.</p>
          <button type="button">No thanks</button>
        </div>
      </main>`;
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${base}"><style>
    *{box-sizing:border-box}body{margin:0;background:#f7f4ee;color:#1d1d1b;font:16px/1.5 system-ui,sans-serif}
    header{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 64px;background:#fff;border-bottom:1px solid #ddd}
    header strong{font-size:20px}nav{display:flex;gap:28px}nav a{color:#1d1d1b;text-decoration:none}
    .page{max-width:1000px;margin:0 auto;padding:72px 64px;position:relative}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:#6d6a62}
    h1{font-size:48px;line-height:1.05;margin:12px 0 36px}.product-card{display:grid;grid-template-columns:280px 1fr;gap:18px;align-items:center;color:#1d1d1b;text-decoration:none;font-size:20px}
    .product-image{display:block;height:250px;border-radius:16px;background:linear-gradient(135deg,#b7c6d1,#34414a)}.product-card span:last-child{grid-column:2;font-size:16px;color:#6d6a62}
    .product-page{max-width:920px}.price{font-size:24px}.copy{max-width:480px;color:#6d6a62}.product-form{margin-top:44px;max-width:520px;display:grid;gap:24px}fieldset{border:0;padding:0;display:flex;gap:10px;align-items:center}legend{font-weight:700;margin-right:12px}.product-form button{border:1px solid #aaa;background:#fff;border-radius:8px;padding:10px 18px;font:inherit}.product-form .add{background:#1d1d1b;color:#fff;border-color:#1d1d1b;padding:14px 22px}
    .modal{position:absolute;right:64px;top:210px;width:300px;padding:24px;border-radius:16px;background:#fff;box-shadow:0 16px 44px #1d1d1b2e}.modal p{color:#6d6a62}.modal button{border:0;background:transparent;text-decoration:underline;padding:0;font:inherit}
  </style></head><body><header><strong>Northpeak</strong><nav><a href="/collections/men">Men</a><a href="/collections/women">Women</a><a href="/about">About</a></nav></header>${content}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
