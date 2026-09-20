/**
 * Seeds ONE completed scan of the local demo shop so the annotation overlay
 * can be driven end to end with no OpenAI, no Browserbase and no keys.
 *
 *   pnpm --filter @friction/worker dev          (must already be running)
 *   pnpm --filter @friction/orchestrator seed:annotations
 *
 * What is real here: the anchors. Every one is captured by the orchestrator's
 * own locateScript() -- the exact string the agent runs mid-run -- evaluated
 * in a real browser against the real demo-shop DOM. The events then go through
 * the real POST /api/runs/:id/events, the real zod contracts and real D1, so
 * GET /api/annotations answers from the same path a live scan would fill.
 *
 * What is NOT real: which elements are flagged. A live run picks those with a
 * model and the detectors; here they are scripted, exactly as smoke-local.ts
 * scripts its planner. This seeds a fixture, it does not test the agent.
 */
import { chromium, type Page } from "@playwright/test";
import { evidenceKey, type Anchor, type RunEvent } from "@friction/shared";
import { locateScript } from "../src/pageScripts";
import { CAPTURE_SNAPSHOT } from "../src/snapshot";

const WORKER = (process.env.WORKER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const SHOP = `${WORKER}/demo-shop`;

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${WORKER}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Absolute XPath of an element, in the shape actor.ts passes locateScript (no "xpath=" prefix). */
const XPATH_SRC = `(el) => {
  const parts = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
    let i = 1;
    for (let s = n.previousSibling; s; s = s.previousSibling) if (s.nodeType === 1 && s.nodeName === n.nodeName) i++;
    parts.unshift(n.nodeName.toLowerCase() + "[" + i + "]");
  }
  return "/" + parts.join("/");
}`;

interface Located {
  found: boolean;
  label: string;
  anchor: Anchor | null;
}

/** The real capture path: absolute XPath -> the orchestrator's locateScript -> an Anchor. */
async function capture(page: Page, selector: string, nth = 0): Promise<Anchor> {
  const xpath = await page.evaluate<string, [string, number, string]>(
    ([sel, idx, src]) => {
      const el = document.querySelectorAll(sel)[idx];
      if (!el) throw new Error(`no element matched ${sel}[${idx}]`);
      return (0, eval)(`(${src})`)(el) as string;
    },
    [selector, nth, XPATH_SRC],
  );
  const located = (await page.evaluate(locateScript(xpath))) as Located;
  if (!located.found || !located.anchor) throw new Error(`locateScript found nothing at ${xpath}`);
  console.log(`  anchor  ${selector}[${nth}] -> ${located.anchor.tag}[role=${located.anchor.role}] "${located.anchor.name}" ordinal=${located.anchor.ordinal}`);
  return located.anchor;
}

async function putEvidence(page: Page, runId: string, seq: number): Promise<string> {
  const key = evidenceKey(runId, "primary", seq, "png");
  const shot = await page.screenshot({ type: "png" });
  const res = await fetch(`${WORKER}/api/evidence/${key}`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: new Uint8Array(shot) });
  if (!res.ok) throw new Error(`PUT evidence -> ${res.status}`);
  return key;
}

/** The same HTML snapshot the agent captures mid-run, so the embedded viewer has a page to show. */
async function putSnapshot(page: Page, runId: string, seq: number): Promise<string> {
  const key = evidenceKey(runId, "primary", seq, "html");
  const html = (await page.evaluate(CAPTURE_SNAPSHOT)) as string;
  if (!html) return "";
  const res = await fetch(`${WORKER}/api/evidence/${key}`, { method: "PUT", headers: { "Content-Type": "text/html" }, body: html });
  if (!res.ok) throw new Error(`PUT snapshot -> ${res.status}`);
  return key;
}

/* ------------------------------------------------------------ the scripted scan */

interface SeedFinding {
  /** null seeds a finding with no anchor: the "unlocated" panel row the spec requires. */
  selector: string | null;
  nth?: number;
  category: "dead_click" | "retry" | "ambiguous_label" | "modal_interrupt" | "loop" | "long_wait" | "error_text";
  severity: 1 | 2 | 3 | 4 | 5;
  summary: string;
  whyItMatters: string;
  recommendation: string;
  hitCount?: number;
}

interface SeedTask {
  path: string;
  task: string;
  whyCritical: string;
  successCheck: string;
  findings: SeedFinding[];
}

const TASKS: SeedTask[] = [
  {
    path: "/products/alpine-down-parka",
    task: "Add the Alpine Down Parka to the cart",
    whyCritical: "Adding to cart is the one step every purchase goes through.",
    successCheck: "The cart shows the Alpine Down Parka.",
    findings: [
      {
        selector: "#add",
        category: "dead_click",
        severity: 4,
        summary: 'Clicked "Add to cart" and nothing happened: no cart change, no message, no DOM mutation.',
        whyItMatters: "The shopper believes the item is in their cart and leaves without buying. This is the last step before revenue.",
        recommendation: 'Disable "Add to cart" until a size is chosen, or show an inline error naming the missing choice.',
        hitCount: 3,
      },
      {
        selector: "#add",
        category: "retry",
        severity: 3,
        summary: 'The same "Add to cart" button was clicked 3 times in a row with no response.',
        whyItMatters: "Repeated clicks are what a confused shopper does right before abandoning the page.",
        recommendation: "Give the button a visible pending or error state so the second click is never needed.",
        hitCount: 3,
      },
      {
        selector: "header nav a",
        nth: 1,
        category: "ambiguous_label",
        severity: 2,
        summary: 'The "Women" navigation link goes to /collections/mens-jackets.',
        whyItMatters: "A link whose destination contradicts its label loses trust and sends shoppers to the wrong catalogue.",
        recommendation: "Point the link at the women's collection, or rename it to match where it goes.",
      },
    ],
  },
  {
    path: "/search?q=jacket",
    task: "Find and open a waterproof jacket from search",
    whyCritical: "Search is the fastest path to a product and the one most shoppers use.",
    successCheck: "A product page is open for a jacket from the results.",
    findings: [
      {
        selector: ".card button",
        nth: 1,
        category: "ambiguous_label",
        severity: 3,
        summary: 'All four search results expose a button named "Select options" — nothing tells them apart.',
        whyItMatters: "Screen-reader users hear the same name four times and cannot tell which product a button belongs to.",
        recommendation: 'Include the product name in the accessible name, e.g. "Select options for Summit Insulated Jacket".',
        hitCount: 2,
      },
      {
        selector: null,
        category: "loop",
        severity: 2,
        summary: "The agent moved between the results list and two product pages without stock ever being visible in the listing.",
        whyItMatters: "Pogo-sticking between list and detail is pure wasted effort and a common reason shoppers give up.",
        recommendation: "Show size availability on the result card so the listing answers the question.",
      },
    ],
  },
  {
    path: "/",
    task: "Browse the winter edit from the home page",
    whyCritical: "The home page is where most first-time visitors land.",
    successCheck: "A collection page is open showing winter products.",
    findings: [
      {
        selector: "a.card",
        nth: 1,
        category: "ambiguous_label",
        severity: 3,
        summary: 'The "Women" category card links to /collections/mens-jackets, as do "Kids" and "Sale".',
        whyItMatters: "Every category card lands on the same men's collection, so browsing by category cannot work at all.",
        recommendation: "Give each category card its own collection URL.",
        hitCount: 2,
      },
      {
        selector: ".hero a",
        category: "long_wait",
        severity: 3,
        summary: 'Following "Shop the Winter Edit" took 5.6s to respond.',
        whyItMatters: "A six-second wait on the first link a visitor takes reads as a broken site.",
        recommendation: "Serve the collection page from cache or stream it; keep the first response under one second.",
      },
    ],
  },
];

/* ------------------------------------------------------------------------ run it */

const browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const { scanId } = await api<{ scanId: string }>("/api/scans", "POST", { url: SHOP });
console.log(`scan ${scanId}`);
await api("/api/scans/" + scanId, "PATCH", { status: "running", message: "Seeded from the demo shop" });

for (const [index, spec] of TASKS.entries()) {
  const url = `${SHOP}${spec.path}`;
  console.log(`\ntask ${index + 1}: ${spec.task}\n  ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const { runId } = await api<{ runId: string }>("/api/runs", "POST", {
    url,
    task: spec.task,
    scan: { scanId, taskIndex: index, whyCritical: spec.whyCritical, successCheck: spec.successCheck },
  });

  const ts = Date.now();
  const events: RunEvent[] = [{ runId, lane: "primary", seq: 0, ts, type: "status", payload: { state: "running", currentSeq: 0 } }];

  // seq 1 is the navigation every finding on this page can point at for evidence.
  const navKey = await putEvidence(page, runId, 1);
  events.push({
    runId,
    lane: "primary",
    seq: 1,
    ts: ts + 500,
    type: "step",
    payload: { url, actionType: "navigate", targetLabel: "", selector: "", rationale: `Opening ${spec.path} to begin the task.`, screenshotKey: navKey, bbox: null, durationMs: 800, domChanged: true },
  });

  let seq = 2;
  for (const finding of spec.findings) {
    const anchor = finding.selector === null ? null : await capture(page, finding.selector, finding.nth ?? 0);
    const stepSeq = seq++;
    const screenshotKey = await putEvidence(page, runId, stepSeq);
    const snapshotKey = await putSnapshot(page, runId, stepSeq);
    events.push({
      runId,
      lane: "primary",
      seq: stepSeq,
      ts: ts + stepSeq * 1000,
      type: "step",
      payload: {
        url,
        actionType: anchor ? "click" : "scroll",
        targetLabel: anchor?.name ?? "",
        selector: anchor ? `xpath=${anchor.xpath}` : "",
        rationale: finding.summary,
        screenshotKey,
        bbox: null,
        durationMs: finding.category === "long_wait" ? 5600 : 400,
        domChanged: false,
        ...(anchor ? { anchor } : {}),
        ...(snapshotKey ? { snapshotKey } : {}),
      },
    });
    events.push({
      runId,
      lane: "primary",
      seq: seq++,
      ts: ts + stepSeq * 1000 + 50,
      type: "friction",
      payload: {
        category: finding.category,
        severity: finding.severity,
        evidenceSeq: stepSeq,
        recommendation: finding.recommendation,
        confidence: 0.9,
        summary: finding.summary,
        whyItMatters: finding.whyItMatters,
        judgedBy: "heuristic",
        findingId: `f${stepSeq}`,
        findingKey: `${finding.category}|${anchor?.xpath ?? ""}`,
        selector: anchor ? `xpath=${anchor.xpath}` : "",
        hitCount: finding.hitCount ?? 1,
        lastSeq: stepSeq,
        ...(anchor ? { anchor } : {}),
      },
    });
  }

  events.push({
    runId,
    lane: "primary",
    seq: seq,
    ts: ts + 20_000,
    type: "done",
    payload: { outcome: "failure", totalSteps: seq, frictionCount: spec.findings.length, durationMs: 20_000, summary: "Could not complete the task." },
  });

  const posted = await api<{ accepted: number; rejected: unknown[] }>(`/api/runs/${runId}/events`, "POST", events);
  console.log(`  run ${runId}: ${posted.accepted} events accepted, ${posted.rejected.length} rejected`);
  if (posted.rejected.length > 0) console.log(`  REJECTED: ${JSON.stringify(posted.rejected).slice(0, 500)}`);
  await api(`/api/runs/${runId}`, "PATCH", { status: "completed" });
}

await api(`/api/scans/${scanId}`, "PATCH", { status: "completed", message: "Seeded scan complete" });
await browser.close();

const host = new URL(SHOP).hostname;
const annotations = await api<{ findings: { category: string; anchor: unknown }[] }>(`/api/annotations?host=${host}`, "GET");
const pinned = annotations.findings.filter((f) => f.anchor).length;
console.log(`\nGET /api/annotations?host=${host} -> ${annotations.findings.length} findings, ${pinned} with an anchor`);
console.log(`scan page: http://localhost:5173/?scan=${scanId}`);
console.log(`annotate:  ${SHOP}/products/alpine-down-parka`);
