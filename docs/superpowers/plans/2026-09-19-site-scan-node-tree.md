# Site Scan + Node Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "URL + task" with one **Scan & test** button. Friction crawls the site, generates the 10 most critical tasks, runs each with the 3 personas (30 runs), and shows everything as a node tree (site → tasks → persona runs) with a side panel and one merged site-wide report.

**Architecture:** A *scan* is the parent of up to 10 ordinary runs. Each run keeps today's contracts unchanged: events, detectors, per-run SSE, `PersonaColumn`. What's new:

- **Shared:** scan contracts and a pure `assembleScanReport`.
- **Worker:** a `scans` table and a `scan_tasks` table, plus routes for them.
- **Orchestrator:** crawl → task generation → fan-out, behind one global browser-session pool.
- **Control room:** a React Flow canvas that polls a compact tree endpoint. The selected persona node uses the existing run stream.

**Tech Stack:**

- TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), pnpm 11 workspaces, vitest
- Cloudflare Worker (Hono, D1, R2)
- Node orchestrator (Express 5, OpenAI Responses API, Stagehand 3.7.3, Browserbase)
- React 19, Vite 8, Tailwind 4, `@xyflow/react` 12

**Spec:** `docs/superpowers/specs/2026-09-19-site-scan-node-tree-design.md`

## Global Constraints

- **Model name:** the OpenAI model is read from `OPENAI_MODEL` only. Never write a model name in code.
- **Imports:** `verbatimModuleSyntax` is on, so type-only imports must use `import type` or inline `type` specifiers.
- **Migrations:** every statement is idempotent (`CREATE ... IF NOT EXISTS`). No `ALTER TABLE`.
- **Existing change in `db.ts`:** keep the uncommitted `\r?\n` schema-split fix in `apps/worker/src/db.ts` (`ensureSchema`).
- **Naming at the boundary:**
  - JSON on the wire is camelCase; D1 columns are snake_case.
  - Mapping happens only in the Worker DB modules (`db.ts`, `scanDb.ts`). SQL lives nowhere else.
- **Persona order:** always `PERSONAS` / `PERSONA_IDS` order (impatient, cautious, keyboard).
- **Limits:**
  - at most 10 tasks per scan (`MAX_SCAN_TASKS = 10`)
  - at most 5 crawled nav links (`MAX_CRAWL_LINKS = 5`)
  - 60 a11y lines per page sent to the model
  - tree polling every 2000 ms
  - `MAX_SESSIONS` defaults to 3, range 1–100; `PERSONA_CONCURRENCY` is still read as a fallback
- **Dependencies:** the only new one is `@xyflow/react` (control room).
- **Offline:** the control room must work offline, so no web fonts and no CDN assets.
- **Mock mode** (no keys, or `FRICTION_MOCK=1`) must run a full scan end to end.
- **Commits:** every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```

## Before Task 1

- [ ] **Branch.** Work on a feature branch (`git switch -c feat/site-scan`), never on `main`.
- [ ] **Uncommitted fix.** `apps/worker/src/db.ts` has an uncommitted fix from the user (the schema split now uses `/\r?\n/`). Do **not** revert it. Ask the user whether to commit it on its own first. Task 3 builds on it either way.

## File Map

| File | Status | Responsibility |
| --- | --- | --- |
| `packages/shared/src/scan.ts` | create | Scan contracts (zod + types), `taskVerdict`, `pickCrawlLinks`, `issueKey`/`issuePath`, node-id helpers, `parseGeneratedTasks` |
| `packages/shared/src/scanReport.ts` | create | `assembleScanReport`: merge findings into ranked issues + summary |
| `packages/shared/src/api.ts` | modify | `CreateRunRequestSchema.scan` (optional link to a scan) |
| `packages/shared/src/index.ts` | modify | export the two new modules |
| `packages/shared/src/scan.test.ts` | create | tests for `scan.ts` |
| `packages/shared/src/scanReport.test.ts` | create | tests for `scanReport.ts` |
| `apps/worker/migrations/0002_scans.sql` | create | `scans`, `scan_tasks` |
| `apps/worker/src/db.ts` | modify | multi-migration `ensureSchema`, export `toEvent`/`newId`, `createRun` scan link |
| `apps/worker/src/scanDb.ts` | create | scan SQL: create/get/patch/list, tree, report rows |
| `apps/worker/src/index.ts` | modify | `/api/scans*` routes; `POST /api/runs` scan link |
| `apps/orchestrator/src/config.ts` | modify | `maxSessions` replaces `personaConcurrency` |
| `apps/orchestrator/src/util.ts` | modify | Semaphore doc comment |
| `apps/orchestrator/src/runManager.ts` | modify | split into `create` / `execute`; shared session pool |
| `apps/orchestrator/src/planner.ts` | modify | `successCheck` in `PlanRequest` + prompt |
| `apps/orchestrator/src/personaRunner.ts` | modify | pass `successCheck` to the planner |
| `apps/orchestrator/src/workerClient.ts` | modify | `createScan`, `patchScan`, `createRun(..., scan?)` |
| `apps/orchestrator/src/pageScripts.ts` | modify | `NAV_LINKS` page script |
| `apps/orchestrator/src/crawl.ts` | create | one session: landing + ≤5 nav pages |
| `apps/orchestrator/src/taskGen.ts` | create | one Structured Outputs call → tasks; generic fallback tasks |
| `apps/orchestrator/src/scanManager.ts` | create | scan lifecycle |
| `apps/orchestrator/src/index.ts` | modify | `POST /scans`, wiring |
| `apps/orchestrator/scripts/smoke-scan.ts` | create | end-to-end mock scan check |
| `apps/orchestrator/package.json` | modify | `smoke:scan` script |
| `apps/control-room/package.json` | modify | `@xyflow/react` |
| `apps/control-room/src/lib/api.ts` | modify | scan endpoints; drop start-run / suggest calls |
| `apps/control-room/src/lib/useQuery.ts` | modify | `scan`, `node` in the URL |
| `apps/control-room/src/lib/scan.ts` | create | small UI helpers for scans |
| `apps/control-room/src/lib/scanLayout.ts` | create | tree → React Flow nodes/edges (pure) |
| `apps/control-room/src/hooks/useScan.ts` | create | poll the tree |
| `apps/control-room/src/hooks/useScanReport.ts` | create | fetch the merged report |
| `apps/control-room/src/components/badges.tsx` | modify | `StateBadge` `idleLabel` |
| `apps/control-room/src/components/scan/IssueCard.tsx` | create | one merged issue |
| `apps/control-room/src/components/scan/RootPanel.tsx` | create | site report panel |
| `apps/control-room/src/components/scan/TaskPanel.tsx` | create | task panel |
| `apps/control-room/src/components/scan/PersonaPanel.tsx` | create | persona run panel (live stream) |
| `apps/control-room/src/components/scan/SidePanel.tsx` | create | picks the panel for the selected node |
| `apps/control-room/src/components/scan/nodes.tsx` | create | `RootNode`, `TaskNode`, `PersonaNode` |
| `apps/control-room/src/components/scan/ScanGraph.tsx` | create | React Flow canvas |
| `apps/control-room/src/components/scan/ScanBar.tsx` | create | top bar |
| `apps/control-room/src/components/scan/ScanPage.tsx` | create | page composition |
| `apps/control-room/src/components/Header.tsx` | modify | logo only |
| `apps/control-room/src/components/Landing.tsx` | rewrite | big URL field, one button, recent scans |
| `apps/control-room/src/App.tsx` | modify | routing: scan / run / home |
| `README.md`, `SETUP.md`, `.env.example` | modify | docs |

---

### Task 1: Shared scan contracts and pure helpers

**Files:**
- Create: `packages/shared/src/scan.ts`
- Modify: `packages/shared/src/api.ts` (`CreateRunRequestSchema`)
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/scan.test.ts`

**Interfaces:**
- Consumes: `PERSONA_IDS`, `isTerminalState`, `FrictionCategory`, `PersonaId`, `PersonaState`, `Severity` from `./events`; `ReportEvidence` (type only) from `./api`.
- Produces (all exported from `@friction/shared`):
  - `SCAN_STATUSES`, `ScanStatus`, `TASK_SOURCES`, `TaskSource`, `MAX_SCAN_TASKS`, `MAX_CRAWL_LINKS`
  - `ScanTaskLinkSchema`, `ScanTaskLink`
  - `CreateScanRequestSchema`, `CreateScanRequest`, `CreateScanResponse`
  - `CrawledPageSchema`, `CrawledPage`, `ScanRecord`, `ScanPatchSchema`, `ScanPatch`
  - `GeneratedTaskSchema`, `GeneratedTask`, `parseGeneratedTasks(input: unknown): GeneratedTask[]`
  - `ScanTreePersona`, `ScanTreeTask`, `ScanTreeResponse`, `ScanListItem`, `ScanListResponse`
  - `TaskVerdict`, `taskVerdict(states: readonly PersonaState[]): TaskVerdict`, `isScanFinished(status: ScanStatus): boolean`
  - `pickCrawlLinks(baseUrl: string, hrefs: readonly string[], max?: number): string[]`
  - `issuePath(url: string | null): string`, `normalizeIssueLabel(label: string): string`, `issueKey(category: FrictionCategory, url: string | null, label: string): string`
  - `ScanNode`, `parseScanNode(id: string | null | undefined): ScanNode`, `scanNodeId(node: ScanNode): string`
  - report shapes: `ScanIssueOccurrence`, `ScanIssue`, `ScanReportSummary`, `ScanReportTask`, `ScanReportResponse`
  - `CreateRunRequestSchema` gains `scan?: ScanTaskLink`

**Circular imports:** `scan.ts` must import from `./api` with `import type` only. `api.ts` imports `ScanTaskLinkSchema` from `./scan` at runtime, so a runtime import in the other direction would create a cycle.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/scan.test.ts`:

```ts
/**
 * Scan helpers: the pure pieces the orchestrator, the Worker and the control
 * room have to agree on.
 *
 *   pnpm test
 */
import { describe, expect, it } from "vitest";
import {
  CreateRunRequestSchema,
  MAX_SCAN_TASKS,
  ScanPatchSchema,
  isScanFinished,
  issueKey,
  issuePath,
  normalizeIssueLabel,
  parseGeneratedTasks,
  parseScanNode,
  pickCrawlLinks,
  scanNodeId,
  taskVerdict,
  type GeneratedTask,
} from "./index";

const task = (title: string): GeneratedTask => ({ title, whyCritical: "It matters.", successCheck: "The page shows it." });

describe("parseGeneratedTasks", () => {
  it("keeps valid tasks in order", () => {
    const tasks = [task("Add a jacket to the cart"), task("Find the returns policy")];
    expect(parseGeneratedTasks({ tasks })).toEqual(tasks);
  });

  it("drops invalid entries instead of rejecting the batch", () => {
    const parsed = parseGeneratedTasks({ tasks: [task("Find the returns policy"), { title: "x", whyCritical: "", successCheck: "" }, "nope", null] });
    expect(parsed.map((t) => t.title)).toEqual(["Find the returns policy"]);
  });

  it("drops duplicate titles, ignoring case", () => {
    expect(parseGeneratedTasks({ tasks: [task("Find the returns policy"), task("find the RETURNS policy")] })).toHaveLength(1);
  });

  it(`caps at ${MAX_SCAN_TASKS}`, () => {
    const many = Array.from({ length: 14 }, (_, i) => task(`Open product number ${i + 1}`));
    expect(parseGeneratedTasks({ tasks: many })).toHaveLength(MAX_SCAN_TASKS);
  });

  it("trims whitespace", () => {
    expect(parseGeneratedTasks({ tasks: [{ title: "  Find the returns policy ", whyCritical: " x ", successCheck: " y " }] })).toEqual([
      { title: "Find the returns policy", whyCritical: "x", successCheck: "y" },
    ]);
  });

  it("returns nothing for input that is not { tasks: [...] }", () => {
    expect(parseGeneratedTasks(null)).toEqual([]);
    expect(parseGeneratedTasks({ tasks: "nope" })).toEqual([]);
    expect(parseGeneratedTasks([task("Find the returns policy")])).toEqual([]);
  });
});

describe("taskVerdict", () => {
  it("is pending while any persona is still going, or before there are any", () => {
    expect(taskVerdict([])).toBe("pending");
    expect(taskVerdict(["succeeded", "running", "succeeded"])).toBe("pending");
    expect(taskVerdict(["idle", "idle", "idle"])).toBe("pending");
  });

  it("is pass when every persona succeeded", () => {
    expect(taskVerdict(["succeeded", "succeeded", "succeeded"])).toBe("pass");
  });

  it("is partial when some succeeded", () => {
    expect(taskVerdict(["succeeded", "failed", "timeout"])).toBe("partial");
    expect(taskVerdict(["failed", "succeeded", "succeeded"])).toBe("partial");
  });

  it("is fail when none succeeded", () => {
    expect(taskVerdict(["failed", "timeout", "failed"])).toBe("fail");
  });
});

describe("pickCrawlLinks", () => {
  const base = "https://shop.example/";

  it("keeps same-origin page links in navigation order, deduplicated by path, capped", () => {
    const hrefs = [
      "/products",
      "https://shop.example/products/",
      "https://other.example/x",
      "mailto:hi@shop.example",
      "#top",
      "/login",
      "/my-account",
      "/guide.pdf",
      "/about?ref=nav#team",
      "/help",
      "/pricing",
      "/blog",
      "/careers",
    ];
    expect(pickCrawlLinks(base, hrefs)).toEqual([
      "https://shop.example/products",
      "https://shop.example/about?ref=nav",
      "https://shop.example/help",
      "https://shop.example/pricing",
      "https://shop.example/blog",
    ]);
  });

  it("skips auth and account paths but not words that merely contain them", () => {
    expect(pickCrawlLinks(base, ["/sign-in", "/signup", "/auth/callback", "/reset-password", "/accounting", "/authors"])).toEqual([
      "https://shop.example/accounting",
      "https://shop.example/authors",
    ]);
  });

  it("never returns the base page itself", () => {
    expect(pickCrawlLinks(base, ["/", "https://shop.example", "/#main"])).toEqual([]);
  });

  it("treats http and https as different origins", () => {
    expect(pickCrawlLinks(base, ["http://shop.example/help"])).toEqual([]);
  });

  it("honours max and survives a bad base URL", () => {
    expect(pickCrawlLinks(base, ["/a", "/b", "/c"], 2)).toEqual(["https://shop.example/a", "https://shop.example/b"]);
    expect(pickCrawlLinks("not a url", ["/a"])).toEqual([]);
  });
});

describe("issue keys", () => {
  it("normalizes the path: lowercase, no trailing slash, no query or hash", () => {
    expect(issuePath("https://s.example/Cart/?step=2#top")).toBe("/cart");
    expect(issuePath("https://s.example/")).toBe("/");
    expect(issuePath("https://s.example")).toBe("/");
  });

  it("uses an empty path when there is no usable URL", () => {
    expect(issuePath(null)).toBe("");
    expect(issuePath("not a url")).toBe("");
  });

  it("normalizes labels: trimmed, lowercase, single spaces", () => {
    expect(normalizeIssueLabel("  Add   to\nCart ")).toBe("add to cart");
  });

  it("matches the same element on the same page across runs", () => {
    expect(issueKey("dead_click", "https://s.example/cart?x=1", " Checkout ")).toBe(issueKey("dead_click", "https://s.example/Cart/", "checkout"));
    expect(issueKey("dead_click", "https://s.example/cart", "Checkout")).toBe("dead_click|/cart|checkout");
  });

  it("keeps different categories apart", () => {
    expect(issueKey("dead_click", "https://s.example/cart", "Checkout")).not.toBe(issueKey("retry", "https://s.example/cart", "Checkout"));
  });
});

describe("scan node ids", () => {
  it("round-trips root, task and persona nodes", () => {
    for (const id of ["root", "t0", "t9", "t3.keyboard", "t0.impatient"]) expect(scanNodeId(parseScanNode(id))).toBe(id);
  });

  it("parses the parts", () => {
    expect(parseScanNode("t2.cautious")).toEqual({ kind: "persona", index: 2, personaId: "cautious" });
    expect(parseScanNode("t4")).toEqual({ kind: "task", index: 4 });
  });

  it("falls back to root for anything else", () => {
    for (const id of [null, undefined, "", "x", "t", "t1.robot", "t1.keyboard.extra", "T1"]) expect(parseScanNode(id)).toEqual({ kind: "root" });
  });
});

describe("scan contracts", () => {
  it("accepts a run with or without a scan link, and rejects an out-of-range task index", () => {
    const base = { url: "https://s.example", task: "Find it" };
    const link = { scanId: "s_1", taskIndex: 3, whyCritical: "a", successCheck: "b" };
    expect(CreateRunRequestSchema.safeParse(base).success).toBe(true);
    expect(CreateRunRequestSchema.safeParse({ ...base, scan: link }).success).toBe(true);
    expect(CreateRunRequestSchema.safeParse({ ...base, scan: { ...link, taskIndex: 10 } }).success).toBe(false);
  });

  it("accepts partial scan patches and rejects unknown statuses", () => {
    expect(ScanPatchSchema.safeParse({ page: { url: "https://s.example/help", title: "Help" }, message: "Reading /help (2/3)" }).success).toBe(true);
    expect(ScanPatchSchema.safeParse({ status: "done" }).success).toBe(false);
  });

  it("knows when a scan is finished", () => {
    expect(isScanFinished("completed")).toBe(true);
    expect(isScanFinished("failed")).toBe(true);
    expect(isScanFinished("crawling")).toBe(false);
    expect(isScanFinished("running")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @friction/shared test -- scan.test.ts`
Expected: FAIL. The imports do not exist yet (for example `parseGeneratedTasks is not a function`, or a resolution error for `CreateRunRequestSchema.scan`).

- [ ] **Step 3: Write `packages/shared/src/scan.ts`**

```ts
/**
 * Scans: one URL -> a crawl -> up to ten generated tasks -> one ordinary run
 * per task, each run the usual three personas. The contracts the orchestrator,
 * the Worker and the control room share, and the pure helpers they agree on.
 *
 * Imports from ./api are type-only: api.ts imports ScanTaskLinkSchema from
 * here at runtime, and a runtime import back would be a cycle.
 */
import { z } from "zod";
import type { ReportEvidence } from "./api";
import {
  PERSONA_IDS,
  isTerminalState,
  type FrictionCategory,
  type PersonaId,
  type PersonaState,
  type Severity,
} from "./events";

/* ------------------------------------------------------------------ enums */

export const SCAN_STATUSES = ["crawling", "running", "completed", "failed"] as const;
export const ScanStatusSchema = z.enum(SCAN_STATUSES);
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/** "model" = generated from the crawl; "fallback" = generic, the site could not be read; "mock" = no keys. */
export const TASK_SOURCES = ["model", "fallback", "mock"] as const;
export const TaskSourceSchema = z.enum(TASK_SOURCES);
export type TaskSource = (typeof TASK_SOURCES)[number];

/** Most tasks one scan runs. Ten tasks x three personas = thirty runs. */
export const MAX_SCAN_TASKS = 10;
/** Navigation pages the crawl reads after the landing page. */
export const MAX_CRAWL_LINKS = 5;

export function isScanFinished(status: ScanStatus): boolean {
  return status === "completed" || status === "failed";
}

/* ---------------------------------------------------------------- requests */

export const CreateScanRequestSchema = z.object({
  url: z.string().trim().min(1).max(2000),
});
export type CreateScanRequest = z.infer<typeof CreateScanRequestSchema>;

export interface CreateScanResponse {
  scanId: string;
}

/** Sent with POST /api/runs when the run is one task of a scan. */
export const ScanTaskLinkSchema = z.object({
  scanId: z.string().min(1),
  taskIndex: z.number().int().min(0).max(MAX_SCAN_TASKS - 1),
  whyCritical: z.string().max(500),
  successCheck: z.string().max(500),
});
export type ScanTaskLink = z.infer<typeof ScanTaskLinkSchema>;

export const CrawledPageSchema = z.object({
  url: z.string().min(1).max(2000),
  title: z.string().max(300),
});
export type CrawledPage = z.infer<typeof CrawledPageSchema>;

/** PATCH /api/scans/:id. `page` appends one crawled page. */
export const ScanPatchSchema = z.object({
  status: ScanStatusSchema.optional(),
  message: z.string().max(500).nullable().optional(),
  taskSource: TaskSourceSchema.optional(),
  page: CrawledPageSchema.optional(),
});
export type ScanPatch = z.infer<typeof ScanPatchSchema>;

export interface ScanRecord {
  id: string;
  url: string;
  status: ScanStatus;
  /** Human-readable progress, or why the scan failed. */
  message: string | null;
  /** Crawled so far, in the order they were read. */
  pages: CrawledPage[];
  /** Null until tasks exist. */
  taskSource: TaskSource | null;
  createdAt: number;
  completedAt: number | null;
}

/* ----------------------------------------------------------- generated tasks */

/** The ~14-word limit on titles is asked for in the prompt, not enforced here: a 15-word task is still worth running. */
export const GeneratedTaskSchema = z.object({
  title: z.string().trim().min(3).max(160),
  whyCritical: z.string().trim().min(1).max(500),
  successCheck: z.string().trim().min(1).max(500),
});
export type GeneratedTask = z.infer<typeof GeneratedTaskSchema>;

/**
 * The model's `{ tasks: [...] }`, validated entry by entry: invalid entries and
 * duplicate titles are dropped rather than failing the whole answer.
 */
export function parseGeneratedTasks(input: unknown): GeneratedTask[] {
  const list =
    input !== null && typeof input === "object" && !Array.isArray(input) && Array.isArray((input as { tasks?: unknown }).tasks)
      ? (input as { tasks: unknown[] }).tasks
      : [];
  const seen = new Set<string>();
  const tasks: GeneratedTask[] = [];
  for (const item of list) {
    const parsed = GeneratedTaskSchema.safeParse(item);
    if (!parsed.success) continue;
    const key = parsed.data.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push(parsed.data);
    if (tasks.length === MAX_SCAN_TASKS) break;
  }
  return tasks;
}

/* -------------------------------------------------------------------- tree */

export interface ScanTreePersona {
  personaId: PersonaId;
  state: PersonaState;
  stepCount: number;
  findingCount: number;
  worstSeverity: Severity | null;
}

export interface ScanTreeTask {
  /** 0-based rank, 0 = most critical. */
  index: number;
  runId: string;
  title: string;
  whyCritical: string;
  successCheck: string;
  /** Always PERSONAS order. */
  personas: ScanTreePersona[];
}

/** GET /api/scans/:id: what the canvas polls. */
export interface ScanTreeResponse {
  scan: ScanRecord;
  tasks: ScanTreeTask[];
}

export interface ScanListItem extends ScanRecord {
  tasksPassed: number;
  tasksTotal: number;
}

export interface ScanListResponse {
  scans: ScanListItem[];
}

export type TaskVerdict = "pass" | "partial" | "fail" | "pending";

/** pass = every persona succeeded, fail = none did, pending = someone is still going. */
export function taskVerdict(states: readonly PersonaState[]): TaskVerdict {
  if (states.length === 0 || !states.every(isTerminalState)) return "pending";
  const succeeded = states.filter((state) => state === "succeeded").length;
  if (succeeded === states.length) return "pass";
  return succeeded === 0 ? "fail" : "partial";
}

/* ------------------------------------------------------------------- crawl */

const AUTH_PATH = /(^|[/_.-])(log-?in|log-?out|sign-?in|sign-?out|sign-?up|register|account|auth|password)([/_.-]|$)/i;
const FILE_PATH = /\.(pdf|zip|gz|dmg|exe|png|jpe?g|gif|svg|webp|mp4|mp3)$/i;

function pathKey(url: URL): string {
  return url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
}

/**
 * Which navigation links the crawl should read: same origin, pages rather than
 * files, never login/account flows, one per path, never the base page itself.
 * Keeps the input order, which is navigation order.
 */
export function pickCrawlLinks(baseUrl: string, hrefs: readonly string[], max = MAX_CRAWL_LINKS): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const seen = new Set([pathKey(base)]);
  const picked: string[] = [];
  for (const href of hrefs) {
    if (picked.length >= max) break;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.origin !== base.origin) continue;
    if (AUTH_PATH.test(url.pathname) || FILE_PATH.test(url.pathname)) continue;
    const key = pathKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    url.hash = "";
    picked.push(url.toString());
  }
  return picked;
}

/* ------------------------------------------------------------------ issues */

/** Pathname, lowercased, no trailing slash, no query or hash. "" when there is no usable URL. */
export function issuePath(url: string | null): string {
  if (!url) return "";
  try {
    return pathKey(new URL(url));
  } catch {
    return "";
  }
}

export function normalizeIssueLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Two findings are one issue when category, page and target match. */
export function issueKey(category: FrictionCategory, url: string | null, label: string): string {
  return `${category}|${issuePath(url)}|${normalizeIssueLabel(label)}`;
}

/* ------------------------------------------------------------------- nodes */

/** A node on the scan canvas. Ids: "root", "t<index>", "t<index>.<personaId>". */
export type ScanNode = { kind: "root" } | { kind: "task"; index: number } | { kind: "persona"; index: number; personaId: PersonaId };

const ROOT: ScanNode = { kind: "root" };

/** Anything unrecognised is the root. Whether the index exists is the caller's business. */
export function parseScanNode(id: string | null | undefined): ScanNode {
  const match = /^t(\d{1,2})(?:\.([a-z]+))?$/.exec(id ?? "");
  if (!match) return ROOT;
  const index = Number(match[1]);
  if (match[2] === undefined) return { kind: "task", index };
  const personaId = PERSONA_IDS.find((persona) => persona === match[2]);
  return personaId ? { kind: "persona", index, personaId } : ROOT;
}

export function scanNodeId(node: ScanNode): string {
  if (node.kind === "root") return "root";
  return node.kind === "task" ? `t${node.index}` : `t${node.index}.${node.personaId}`;
}

/* ------------------------------------------------------------------ report */

export interface ScanIssueOccurrence {
  runId: string;
  taskIndex: number;
  personaId: PersonaId;
  evidenceSeq: number;
  severity: Severity;
}

export interface ScanIssue {
  /** category|path|label, see issueKey. */
  key: string;
  category: FrictionCategory;
  /** Worst among the occurrences. */
  severity: Severity;
  /** Highest among the occurrences. */
  confidence: number;
  /** From the representative occurrence (highest severity, then confidence). */
  summary: string | null;
  whyItMatters: string | null;
  recommendation: string;
  /** Normalized path of the representative's evidence ("" when it never arrived). */
  page: string;
  targetLabel: string;
  /** Distinct task x persona runs that hit this. */
  runsHit: number;
  totalRuns: number;
  /** PERSONAS order. */
  personas: PersonaId[];
  /** Ascending. */
  taskIndexes: number[];
  /** Task, then persona order, then seq. */
  occurrences: ScanIssueOccurrence[];
  evidence: ReportEvidence | null;
}

export interface ScanReportSummary {
  verdicts: Record<TaskVerdict, number>;
  personas: Record<PersonaId, { succeeded: number; finished: number; total: number }>;
  issuesBySeverity: Record<Severity, number>;
}

export interface ScanReportTask {
  index: number;
  runId: string;
  title: string;
  verdict: TaskVerdict;
}

/** GET /api/scans/:id/report */
export interface ScanReportResponse {
  scan: ScanRecord;
  generatedAt: number;
  summary: ScanReportSummary;
  tasks: ScanReportTask[];
  /** Severity desc, then runsHit desc, then confidence desc. */
  issues: ScanIssue[];
}
```

- [ ] **Step 4: Link runs to scans in `packages/shared/src/api.ts`**

Add the import below the existing `./events` import block:

```ts
import { ScanTaskLinkSchema } from "./scan";
```

Replace `CreateRunRequestSchema` with:

```ts
export const CreateRunRequestSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  task: z.string().trim().min(1).max(500),
  /** Set when the run is one task of a scan. */
  scan: ScanTaskLinkSchema.optional(),
});
```

- [ ] **Step 5: Export the module from `packages/shared/src/index.ts`**

Append:

```ts
export * from "./scan";
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter @friction/shared test`
Expected: PASS. That includes the existing 42 detector tests and every test in `scan.test.ts`.

Run: `pnpm typecheck`
Expected: exit 0 for all four packages. The new field is optional, so existing callers still compile.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/scan.ts packages/shared/src/scan.test.ts packages/shared/src/api.ts packages/shared/src/index.ts
git commit -F - <<'EOF'
feat(shared): scan contracts, crawl link picker, issue keys, node ids

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Merged site report (`assembleScanReport`)

**Files:**
- Create: `packages/shared/src/scanReport.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/scanReport.test.ts`

**Interfaces:**
- Consumes (Task 1): `issueKey`, `issuePath`, `taskVerdict`, `ScanIssue`, `ScanIssueOccurrence`, `ScanReportResponse`, `ScanReportSummary`, `ScanTreeResponse`, `TaskVerdict`.
- Consumes (existing): `toReportEvidence`, `FindingInput` from `./report`.
- Produces:
  - `interface ScanFindingInput extends FindingInput { runId: string }`
  - `interface AssembleScanReportArgs { tree: ScanTreeResponse; findings: readonly ScanFindingInput[]; evidence: readonly StepEvent[]; now?: number }`
  - `assembleScanReport(args: AssembleScanReportArgs): ScanReportResponse`
  - `compareIssues(a: ScanIssue, b: ScanIssue): number`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/scanReport.test.ts`:

```ts
/**
 * The site-wide report: findings from many runs merged into ranked issues.
 *
 *   pnpm test
 */
import { describe, expect, it } from "vitest";
import {
  PERSONA_IDS,
  assembleScanReport,
  findingsFromEvents,
  isStepEvent,
  issueKey,
  type FrictionCategory,
  type PersonaId,
  type PersonaState,
  type ScanFindingInput,
  type ScanRecord,
  type ScanTreeTask,
  type Severity,
  type StepEvent,
} from "./index";
import { getGoldenRun } from "./golden";

const SCAN: ScanRecord = {
  id: "s_1",
  url: "https://s.example/",
  status: "running",
  message: null,
  pages: [],
  taskSource: "model",
  createdAt: 1,
  completedAt: null,
};

function treeTask(index: number, states: PersonaState[]): ScanTreeTask {
  return {
    index,
    runId: `r${index}`,
    title: `Task ${index + 1}`,
    whyCritical: "It matters.",
    successCheck: "It shows.",
    personas: PERSONA_IDS.map((personaId, i) => ({ personaId, state: states[i] ?? "idle", stepCount: 0, findingCount: 0, worstSeverity: null })),
  };
}

function step(runId: string, personaId: PersonaId, seq: number, url: string, targetLabel: string): StepEvent {
  return {
    runId,
    personaId,
    seq,
    ts: 1_800_000_000_000 + seq,
    type: "step",
    payload: {
      url,
      actionType: "click",
      targetLabel,
      selector: "#x",
      rationale: "because",
      screenshotKey: `runs/${runId}/${personaId}/${seq}.jpg`,
      bbox: null,
      durationMs: 100,
      domChanged: false,
    },
  };
}

let nextId = 0;
function finding(runId: string, personaId: PersonaId, category: FrictionCategory, severity: Severity, confidence: number, evidenceSeq: number): ScanFindingInput {
  nextId += 1;
  return {
    id: String(nextId),
    runId,
    personaId,
    category,
    severity,
    confidence,
    evidenceSeq,
    recommendation: `Fix ${category} ${nextId}`,
    summary: `Saw ${category} ${nextId}`,
    whyItMatters: null,
  };
}

describe("assembleScanReport", () => {
  const tree = { scan: SCAN, tasks: [treeTask(0, ["succeeded", "failed", "running"]), treeTask(1, ["succeeded", "succeeded", "succeeded"])] };
  const evidence = [
    step("r0", "impatient", 5, "https://s.example/Cart/", "Checkout"),
    step("r0", "cautious", 7, "https://s.example/cart?x=1", " checkout "),
    step("r0", "cautious", 9, "https://s.example/cart", "Checkout"),
    step("r1", "keyboard", 3, "https://s.example/cart", "Checkout"),
    step("r1", "keyboard", 4, "https://s.example/", "Cookie consent"),
  ];
  const findings = [
    finding("r0", "impatient", "dead_click", 3, 0.8, 5), // 1
    finding("r0", "cautious", "dead_click", 4, 0.6, 7), // 2
    finding("r0", "cautious", "dead_click", 2, 0.95, 9), // 3: same run and persona again
    finding("r1", "keyboard", "dead_click", 4, 0.9, 3), // 4: the representative
    finding("r1", "keyboard", "modal_interrupt", 5, 0.7, 4), // 5
    finding("r0", "impatient", "loop", 4, 0.5, 99), // 6: evidence step never arrived
    finding("r_other", "impatient", "retry", 5, 1, 1), // 7: not part of this scan
  ];
  const report = assembleScanReport({ tree, findings, evidence, now: 42 });
  const deadClick = report.issues.find((issue) => issue.category === "dead_click");

  it("merges the same element on the same page across tasks and personas", () => {
    expect(deadClick?.key).toBe("dead_click|/cart|checkout");
    expect(deadClick?.occurrences).toHaveLength(4);
    expect(deadClick?.runsHit).toBe(3);
    expect(deadClick?.totalRuns).toBe(6);
    expect(deadClick?.personas).toEqual(["impatient", "cautious", "keyboard"]);
    expect(deadClick?.taskIndexes).toEqual([0, 1]);
  });

  it("orders occurrences by task, then persona, then seq", () => {
    expect(deadClick?.occurrences.map((o) => `${o.taskIndex}.${o.personaId}.${o.evidenceSeq}`)).toEqual([
      "0.impatient.5",
      "0.cautious.7",
      "0.cautious.9",
      "1.keyboard.3",
    ]);
  });

  it("takes the worst severity and best confidence, and the representative's words and evidence", () => {
    expect(deadClick?.severity).toBe(4);
    expect(deadClick?.confidence).toBe(0.95);
    expect(deadClick?.recommendation).toBe("Fix dead_click 4");
    expect(deadClick?.summary).toBe("Saw dead_click 4");
    expect(deadClick?.evidence?.seq).toBe(3);
    expect(deadClick?.page).toBe("/cart");
    expect(deadClick?.targetLabel).toBe("Checkout");
  });

  it("ranks by severity, then reach, then confidence", () => {
    expect(report.issues.map((issue) => issue.category)).toEqual(["modal_interrupt", "dead_click", "loop"]);
  });

  it("keeps an issue whose evidence step never arrived", () => {
    const loop = report.issues.find((issue) => issue.category === "loop");
    expect(loop?.key).toBe("loop||");
    expect(loop?.page).toBe("");
    expect(loop?.evidence).toBeNull();
  });

  it("ignores findings from runs that are not part of the scan", () => {
    expect(report.issues.some((issue) => issue.category === "retry")).toBe(false);
  });

  it("summarizes verdicts, persona success and severities", () => {
    expect(report.scan).toBe(SCAN);
    expect(report.generatedAt).toBe(42);
    expect(report.summary.verdicts).toEqual({ pass: 1, partial: 0, fail: 0, pending: 1 });
    expect(report.summary.personas).toEqual({
      impatient: { succeeded: 2, finished: 2, total: 2 },
      cautious: { succeeded: 1, finished: 2, total: 2 },
      keyboard: { succeeded: 1, finished: 1, total: 2 },
    });
    expect(report.summary.issuesBySeverity).toEqual({ 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 });
    expect(report.tasks).toEqual([
      { index: 0, runId: "r0", title: "Task 1", verdict: "pending" },
      { index: 1, runId: "r1", title: "Task 2", verdict: "pass" },
    ]);
  });
});

describe("assembleScanReport over ten copies of the golden run", () => {
  const golden = getGoldenRun();
  const tasks = Array.from({ length: 10 }, (_, i) => treeTask(i, ["succeeded", "failed", "timeout"]));
  const goldenFindings = findingsFromEvents(golden.events);
  const goldenSteps = golden.events.filter(isStepEvent);
  const report = assembleScanReport({
    tree: { scan: SCAN, tasks },
    findings: tasks.flatMap((task) => goldenFindings.map((f) => ({ ...f, id: `${task.runId}:${f.id}`, runId: task.runId }))),
    evidence: tasks.flatMap((task) => goldenSteps.map((s) => ({ ...s, runId: task.runId }))),
  });

  const stepOf = new Map(goldenSteps.map((s) => [`${s.personaId}:${s.seq}`, s] as const));
  const perCopy = new Map<string, number>();
  for (const f of goldenFindings) {
    const s = stepOf.get(`${f.personaId}:${f.evidenceSeq}`);
    const key = issueKey(f.category, s?.payload.url ?? null, s?.payload.targetLabel ?? "");
    perCopy.set(key, (perCopy.get(key) ?? 0) + 1);
  }

  it("has one issue per distinct finding in a single copy", () => {
    expect(report.issues).toHaveLength(perCopy.size);
  });

  it("counts every copy", () => {
    for (const issue of report.issues) {
      expect(issue.occurrences).toHaveLength((perCopy.get(issue.key) ?? 0) * 10);
      expect(issue.runsHit % 10).toBe(0);
      expect(issue.taskIndexes).toHaveLength(10);
      expect(issue.totalRuns).toBe(30);
    }
  });

  it("marks every task partial", () => {
    expect(report.summary.verdicts).toEqual({ pass: 0, partial: 10, fail: 0, pending: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @friction/shared test -- scanReport.test.ts`
Expected: FAIL with `assembleScanReport is not a function` (or not exported).

- [ ] **Step 3: Write `packages/shared/src/scanReport.ts`**

```ts
/**
 * The site-wide report: every finding of every run in a scan, merged into
 * issues. Pure, like report.ts: the Worker feeds it D1 rows.
 *
 * Two findings are one issue when category, page path and target label match
 * (issueKey). runsHit counts distinct task x persona runs, so one persona
 * tripping over the same thing twice in one run still counts once.
 */
import { PERSONA_IDS, isTerminalState, type PersonaId, type Severity, type StepEvent } from "./events";
import { toReportEvidence, type FindingInput } from "./report";
import {
  issueKey,
  issuePath,
  taskVerdict,
  type ScanIssue,
  type ScanIssueOccurrence,
  type ScanReportResponse,
  type ScanReportSummary,
  type ScanTreeResponse,
  type TaskVerdict,
} from "./scan";

export interface ScanFindingInput extends FindingInput {
  runId: string;
}

export interface AssembleScanReportArgs {
  /** Supplies the scan, the tasks and every persona's state. */
  tree: ScanTreeResponse;
  findings: readonly ScanFindingInput[];
  /** Evidence steps of those findings, in any order. Missing ones are tolerated. */
  evidence: readonly StepEvent[];
  now?: number;
}

interface Member {
  finding: ScanFindingInput;
  taskIndex: number;
  step: StepEvent | undefined;
}

const PERSONA_ORDER = new Map<PersonaId, number>(PERSONA_IDS.map((id, index) => [id, index]));

/** Severity desc, then confidence desc. Array.sort is stable, so ties keep arrival order. */
function byWeight(a: Member, b: Member): number {
  return b.finding.severity - a.finding.severity || b.finding.confidence - a.finding.confidence;
}

/** Severity desc, reach desc, confidence desc, then key as a stable tiebreak. */
export function compareIssues(a: ScanIssue, b: ScanIssue): number {
  if (a.severity !== b.severity) return b.severity - a.severity;
  if (a.runsHit !== b.runsHit) return b.runsHit - a.runsHit;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function toIssue(key: string, members: readonly Member[], totalRuns: number): ScanIssue {
  const representative = [...members].sort(byWeight)[0] as Member;
  const { finding, step } = representative;
  const occurrences: ScanIssueOccurrence[] = members
    .map((m) => ({
      runId: m.finding.runId,
      taskIndex: m.taskIndex,
      personaId: m.finding.personaId,
      evidenceSeq: m.finding.evidenceSeq,
      severity: m.finding.severity,
    }))
    .sort(
      (a, b) =>
        a.taskIndex - b.taskIndex ||
        (PERSONA_ORDER.get(a.personaId) ?? 0) - (PERSONA_ORDER.get(b.personaId) ?? 0) ||
        a.evidenceSeq - b.evidenceSeq,
    );
  return {
    key,
    category: finding.category,
    severity: finding.severity,
    confidence: Math.max(...members.map((m) => m.finding.confidence)),
    summary: finding.summary ?? null,
    whyItMatters: finding.whyItMatters ?? null,
    recommendation: finding.recommendation,
    page: issuePath(step?.payload.url ?? null),
    targetLabel: step?.payload.targetLabel ?? "",
    runsHit: new Set(members.map((m) => `${m.finding.runId}:${m.finding.personaId}`)).size,
    totalRuns,
    personas: PERSONA_IDS.filter((id) => members.some((m) => m.finding.personaId === id)),
    taskIndexes: [...new Set(members.map((m) => m.taskIndex))].sort((a, b) => a - b),
    occurrences,
    evidence: step ? toReportEvidence(step) : null,
  };
}

export function assembleScanReport(args: AssembleScanReportArgs): ScanReportResponse {
  const { tree } = args;
  const taskByRun = new Map(tree.tasks.map((task) => [task.runId, task] as const));
  const steps = new Map(args.evidence.map((step) => [`${step.runId}:${step.personaId}:${step.seq}`, step] as const));
  const totalRuns = tree.tasks.length * PERSONA_IDS.length;

  const groups = new Map<string, Member[]>();
  for (const finding of args.findings) {
    const task = taskByRun.get(finding.runId);
    if (!task) continue;
    const step = steps.get(`${finding.runId}:${finding.personaId}:${finding.evidenceSeq}`);
    const key = issueKey(finding.category, step?.payload.url ?? null, step?.payload.targetLabel ?? "");
    const members = groups.get(key) ?? [];
    members.push({ finding, taskIndex: task.index, step });
    groups.set(key, members);
  }
  const issues = [...groups].map(([key, members]) => toIssue(key, members, totalRuns)).sort(compareIssues);

  const verdicts: Record<TaskVerdict, number> = { pass: 0, partial: 0, fail: 0, pending: 0 };
  const personas = Object.fromEntries(
    PERSONA_IDS.map((id) => [id, { succeeded: 0, finished: 0, total: tree.tasks.length }]),
  ) as ScanReportSummary["personas"];
  const tasks = tree.tasks.map((task) => {
    const verdict = taskVerdict(task.personas.map((p) => p.state));
    verdicts[verdict] += 1;
    for (const p of task.personas) {
      if (isTerminalState(p.state)) personas[p.personaId].finished += 1;
      if (p.state === "succeeded") personas[p.personaId].succeeded += 1;
    }
    return { index: task.index, runId: task.runId, title: task.title, verdict };
  });

  const issuesBySeverity: Record<Severity, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const issue of issues) issuesBySeverity[issue.severity] += 1;

  return {
    scan: tree.scan,
    generatedAt: args.now ?? Date.now(),
    summary: { verdicts, personas, issuesBySeverity },
    tasks,
    issues,
  };
}
```

- [ ] **Step 4: Export the module from `packages/shared/src/index.ts`**

Append:

```ts
export * from "./scanReport";
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @friction/shared test`
Expected: PASS (every test file).

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/scanReport.ts packages/shared/src/scanReport.test.ts packages/shared/src/index.ts
git commit -F - <<'EOF'
feat(shared): merge findings across a scan into ranked issues

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Worker — scan storage and routes

**Files:**
- Create: `apps/worker/migrations/0002_scans.sql`
- Modify: `apps/worker/src/db.ts`. This covers the imports and the schema section (lines 19-51), `newRunId` (around line 128), `createRun` (around line 136), and `toEvent` (around line 109).
- Create: `apps/worker/src/scanDb.ts`
- Modify: `apps/worker/src/index.ts`, covering the imports and the `/api/runs` POST route, plus a new scans section.

**Interfaces:**
- Consumes (Tasks 1–2): `CreateScanRequestSchema`, `ScanPatchSchema`, `ScanTaskLink`, `ScanRecord`, `ScanPatch`, `ScanListItem`, `ScanTreeResponse`, `ScanTreeTask`, `ScanFindingInput`, `assembleScanReport`, `CreateScanResponse`, `ScanListResponse`.
- Produces, for the orchestrator and the UI:

| Route | Response |
| --- | --- |
| `POST /api/scans {url}` | `201 {scanId}` |
| `PATCH /api/scans/:id` | `ScanPatch` → `200 ScanRecord` / `404` |
| `GET /api/scans?limit=` | `ScanListResponse` |
| `GET /api/scans/:id` | `ScanTreeResponse` / `404` |
| `GET /api/scans/:id/report` | `ScanReportResponse` / `404` |
| `POST /api/runs` | accepts `scan`; `404` if its scan does not exist |

- [ ] **Step 1: Create `apps/worker/migrations/0002_scans.sql`**

```sql
-- Scans: one URL -> crawl -> up to 10 generated tasks -> one run per task.
-- Idempotent (IF NOT EXISTS, no ALTER TABLE) because the Worker also runs
-- this file itself when the scans table is missing (src/db.ts ensureSchema).

CREATE TABLE IF NOT EXISTS scans (
  id           TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'crawling',
  message      TEXT,
  pages        TEXT NOT NULL DEFAULT '[]',
  task_source  TEXT,
  created_at   INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at);

-- One row per task. The task title is the run's own task column.
CREATE TABLE IF NOT EXISTS scan_tasks (
  scan_id       TEXT NOT NULL,
  task_index    INTEGER NOT NULL,
  run_id        TEXT NOT NULL,
  why_critical  TEXT NOT NULL,
  success_check TEXT NOT NULL,
  PRIMARY KEY (scan_id, task_index)
);

CREATE INDEX IF NOT EXISTS idx_scan_tasks_run ON scan_tasks(run_id);
```

- [ ] **Step 2: Apply every migration from `ensureSchema` in `apps/worker/src/db.ts`**

Replace the current `import schemaSql from "../migrations/0001_init.sql";` line and the whole `/* schema */` section, down to and including `ensureSchema`, with the code below. The user's `\r?\n` split and its comment survive inside `statementsOf`.

```ts
import initSql from "../migrations/0001_init.sql";
import scansSql from "../migrations/0002_scans.sql";

/* ------------------------------------------------------------------ schema */

let schemaChecked = false;

/** Each migration, and a table whose absence means it has never run here. */
const MIGRATIONS: ReadonlyArray<{ name: string; sentinel: string; sql: string }> = [
  { name: "0001_init", sentinel: "findings", sql: initSql },
  { name: "0002_scans", sentinel: "scans", sql: scansSql },
];

/** One statement per `;`, with `--` comments stripped. */
function statementsOf(sql: string): string[] {
  return (
    sql
      // \r?\n, not \n: with core.autocrlf the file is checked out as CRLF, and
      // `.` stops at \r, so a trailing \r would keep the comment alive.
      .split(/\r?\n/)
      .map((line) => line.replace(/--.*$/, ""))
      .join(" ")
      .split(";")
      .map((statement) => statement.replace(/\s+/g, " ").trim())
      .filter((statement) => statement.length > 0)
  );
}

/**
 * Applies any migration this database has never had. `wrangler d1 migrations
 * apply` remains the documented path; this is the safety net for the
 * teammate (or the demo laptop) that skipped it. Every statement is
 * IF NOT EXISTS, so running after wrangler (or before it) is harmless. A plain
 * flag rather than a shared promise: promises must not be awaited across
 * Worker requests.
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaChecked) return;
  for (const migration of MIGRATIONS) {
    const existing = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(migration.sentinel)
      .first<{ name: string }>();
    if (existing) continue;
    const statements = statementsOf(migration.sql);
    await db.batch(statements.map((statement) => db.prepare(statement)));
    console.log(`[db] applied ${migration.name} (${statements.length} statements)`);
  }
  schemaChecked = true;
}
```

- [ ] **Step 3: Export `toEvent` and `newId`, and let `createRun` link a run to a scan (`db.ts`)**

Change `function toEvent(` to `export function toEvent(`.

Replace `newRunId` with:

```ts
/** "r_" + 10 random [a-z0-9]. Prefix: "r_" runs, "s_" scans. */
export function newId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let id = prefix;
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return id;
}
```

Add `type ScanTaskLink,` to the `@friction/shared` import list. Then replace `createRun` with:

```ts
export async function createRun(db: D1Database, input: { url: string; task: string; scan?: ScanTaskLink }): Promise<RunRecord> {
  const run: RunRecord = {
    id: newId("r_"),
    url: input.url,
    task: input.task,
    status: "pending",
    createdAt: Date.now(),
    completedAt: null,
  };
  const statements: D1PreparedStatement[] = [
    db
      .prepare("INSERT INTO runs (id, url, task, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(run.id, run.url, run.task, run.status, run.createdAt),
    ...PERSONA_IDS.map((personaId) =>
      db
        .prepare("INSERT INTO personas (id, run_id, persona_id, state, step_count) VALUES (?, ?, ?, 'idle', 0)")
        .bind(`${run.id}:${personaId}`, run.id, personaId),
    ),
  ];
  if (input.scan) {
    // OR REPLACE: a retried POST re-points the task at the newest run instead of failing the batch.
    statements.push(
      db
        .prepare("INSERT OR REPLACE INTO scan_tasks (scan_id, task_index, run_id, why_critical, success_check) VALUES (?, ?, ?, ?, ?)")
        .bind(input.scan.scanId, input.scan.taskIndex, run.id, input.scan.whyCritical, input.scan.successCheck),
    );
  }
  await db.batch(statements);
  return run;
}
```

- [ ] **Step 4: Create `apps/worker/src/scanDb.ts`**

```ts
/**
 * Scan SQL. Same rules as db.ts: rows are snake_case, everything that leaves
 * this module is the camelCase contract from @friction/shared.
 */
import {
  PERSONA_IDS,
  type CrawledPage,
  type FrictionCategory,
  type PersonaId,
  type PersonaState,
  type ScanFindingInput,
  type ScanListItem,
  type ScanPatch,
  type ScanRecord,
  type ScanStatus,
  type ScanTreeResponse,
  type ScanTreeTask,
  type Severity,
  type StepEvent,
  type TaskSource,
} from "@friction/shared";
import { newId, toEvent } from "./db";

interface ScanRow {
  id: string;
  url: string;
  status: string;
  message: string | null;
  pages: string;
  task_source: string | null;
  created_at: number;
  completed_at: number | null;
}

interface ScanListRow extends ScanRow {
  tasks_total: number;
  tasks_passed: number;
}

interface TaskRow {
  task_index: number;
  run_id: string;
  task: string;
  why_critical: string;
  success_check: string;
}

interface PersonaStateRow {
  run_id: string;
  persona_id: string;
  state: string;
  step_count: number;
}

interface FindingCountRow {
  run_id: string;
  persona_id: string;
  n: number;
  worst: number;
}

interface ScanFindingRow {
  id: number;
  run_id: string;
  persona_id: string;
  category: string;
  severity: number;
  evidence_seq: number;
  recommendation: string;
  confidence: number;
  summary: string | null;
  why_it_matters: string | null;
  e_seq: number | null;
  e_ts: number | null;
  e_payload: string | null;
}

function toScan(row: ScanRow): ScanRecord {
  let pages: CrawledPage[] = [];
  try {
    const parsed: unknown = JSON.parse(row.pages);
    if (Array.isArray(parsed)) pages = parsed as CrawledPage[];
  } catch {
    /* a corrupt pages column costs the page list, not the scan */
  }
  return {
    id: row.id,
    url: row.url,
    status: row.status as ScanStatus,
    message: row.message,
    pages,
    taskSource: row.task_source as TaskSource | null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function createScan(db: D1Database, url: string): Promise<ScanRecord> {
  const scan: ScanRecord = {
    id: newId("s_"),
    url,
    status: "crawling",
    message: "Opening the site.",
    pages: [],
    taskSource: null,
    createdAt: Date.now(),
    completedAt: null,
  };
  await db
    .prepare("INSERT INTO scans (id, url, status, message, pages, created_at) VALUES (?, ?, ?, ?, '[]', ?)")
    .bind(scan.id, scan.url, scan.status, scan.message, scan.createdAt)
    .run();
  return scan;
}

export async function getScan(db: D1Database, scanId: string): Promise<ScanRecord | null> {
  const row = await db.prepare("SELECT * FROM scans WHERE id = ?").bind(scanId).first<ScanRow>();
  return row ? toScan(row) : null;
}

/** Applies whatever the patch carries. `page` is appended in SQL, so concurrent patches never lose one. */
export async function patchScan(db: D1Database, scanId: string, patch: ScanPatch): Promise<ScanRecord | null> {
  const sets: string[] = [];
  const binds: Array<string | number | null> = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    binds.push(patch.status);
    if (patch.status === "completed" || patch.status === "failed") {
      sets.push("completed_at = ?");
      binds.push(Date.now());
    }
  }
  if (patch.message !== undefined) {
    sets.push("message = ?");
    binds.push(patch.message);
  }
  if (patch.taskSource !== undefined) {
    sets.push("task_source = ?");
    binds.push(patch.taskSource);
  }
  if (patch.page !== undefined) {
    sets.push("pages = json_insert(pages, '$[#]', json(?))");
    binds.push(JSON.stringify(patch.page));
  }
  if (sets.length > 0) {
    await db.prepare(`UPDATE scans SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, scanId).run();
  }
  return getScan(db, scanId);
}

/** Newest first, with how many tasks every persona completed. */
export async function listScans(db: D1Database, limit: number): Promise<ScanListItem[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM scan_tasks t WHERE t.scan_id = s.id) AS tasks_total,
         (SELECT COUNT(*) FROM scan_tasks t WHERE t.scan_id = s.id
            AND (SELECT COUNT(*) FROM personas p WHERE p.run_id = t.run_id AND p.state = 'succeeded') = ?2) AS tasks_passed
       FROM scans s
       ORDER BY s.created_at DESC
       LIMIT ?1`,
    )
    .bind(limit, PERSONA_IDS.length)
    .all<ScanListRow>();
  return results.map((row) => ({ ...toScan(row), tasksTotal: row.tasks_total, tasksPassed: row.tasks_passed }));
}

/** Tasks in rank order, each with its three personas' live state. Three queries, one round trip. */
export async function getScanTree(db: D1Database, scan: ScanRecord): Promise<ScanTreeResponse> {
  const [tasks, personas, counts] = await db.batch<TaskRow | PersonaStateRow | FindingCountRow>([
    db
      .prepare(
        `SELECT t.task_index, t.run_id, r.task, t.why_critical, t.success_check
         FROM scan_tasks t JOIN runs r ON r.id = t.run_id
         WHERE t.scan_id = ?
         ORDER BY t.task_index ASC`,
      )
      .bind(scan.id),
    db
      .prepare(
        `SELECT p.run_id, p.persona_id, p.state, p.step_count
         FROM personas p JOIN scan_tasks t ON t.run_id = p.run_id
         WHERE t.scan_id = ?`,
      )
      .bind(scan.id),
    db
      .prepare(
        `SELECT f.run_id, f.persona_id, COUNT(*) AS n, MAX(f.severity) AS worst
         FROM findings f JOIN scan_tasks t ON t.run_id = f.run_id
         WHERE t.scan_id = ?
         GROUP BY f.run_id, f.persona_id`,
      )
      .bind(scan.id),
  ]);

  const stateOf = new Map<string, PersonaStateRow>();
  for (const row of (personas?.results ?? []) as PersonaStateRow[]) stateOf.set(`${row.run_id}:${row.persona_id}`, row);
  const countOf = new Map<string, FindingCountRow>();
  for (const row of (counts?.results ?? []) as FindingCountRow[]) countOf.set(`${row.run_id}:${row.persona_id}`, row);

  const treeTasks: ScanTreeTask[] = ((tasks?.results ?? []) as TaskRow[]).map((row) => ({
    index: row.task_index,
    runId: row.run_id,
    title: row.task,
    whyCritical: row.why_critical,
    successCheck: row.success_check,
    personas: PERSONA_IDS.map((personaId) => {
      const state = stateOf.get(`${row.run_id}:${personaId}`);
      const count = countOf.get(`${row.run_id}:${personaId}`);
      return {
        personaId,
        state: (state?.state ?? "idle") as PersonaState,
        stepCount: state?.step_count ?? 0,
        findingCount: count?.n ?? 0,
        worstSeverity: count ? (count.worst as Severity) : null,
      };
    }),
  }));
  return { scan, tasks: treeTasks };
}

export interface ScanFindingRows {
  findings: ScanFindingInput[];
  evidence: StepEvent[];
}

/** Every finding of the scan's runs, each joined to its evidence step. One query. */
export async function getScanFindingRows(db: D1Database, scanId: string): Promise<ScanFindingRows> {
  const { results } = await db
    .prepare(
      `SELECT f.id, f.run_id, f.persona_id, f.category, f.severity, f.evidence_seq, f.recommendation,
              f.confidence, f.summary, f.why_it_matters,
              e.seq AS e_seq, e.ts AS e_ts, e.payload AS e_payload
       FROM findings f
       JOIN scan_tasks t ON t.run_id = f.run_id
       LEFT JOIN events e
         ON e.run_id = f.run_id AND e.persona_id = f.persona_id
        AND e.seq = f.evidence_seq AND e.type = 'step'
       WHERE t.scan_id = ?`,
    )
    .bind(scanId)
    .all<ScanFindingRow>();

  const findings: ScanFindingInput[] = [];
  const evidence: StepEvent[] = [];
  for (const row of results) {
    findings.push({
      id: String(row.id),
      runId: row.run_id,
      personaId: row.persona_id as PersonaId,
      category: row.category as FrictionCategory,
      severity: row.severity as Severity,
      evidenceSeq: row.evidence_seq,
      recommendation: row.recommendation,
      confidence: row.confidence,
      summary: row.summary,
      whyItMatters: row.why_it_matters,
    });
    if (row.e_seq !== null && row.e_ts !== null && row.e_payload !== null) {
      const step = toEvent({ run_id: row.run_id, persona_id: row.persona_id, seq: row.e_seq, ts: row.e_ts, type: "step", payload: row.e_payload });
      if (step?.type === "step") evidence.push(step);
    }
  }
  return { findings, evidence };
}
```

- [ ] **Step 5: Add the routes in `apps/worker/src/index.ts`**

Extend the `@friction/shared` import list with `CreateScanRequestSchema`, `ScanPatchSchema`, `assembleScanReport`, `type CreateScanResponse` and `type ScanListResponse`. Add:

```ts
import { createScan, getScan, getScanFindingRows, getScanTree, listScans, patchScan } from "./scanDb";
```

In `app.post("/api/runs", ...)`, replace `const run = await createRun(c.env.DB, { url, task: parsed.data.task });` with:

```ts
  const { scan } = parsed.data;
  if (scan && !(await getScan(c.env.DB, scan.scanId))) return c.json({ error: `scan ${scan.scanId} not found` }, 404);
  const run = await createRun(c.env.DB, { url, task: parsed.data.task, scan });
```

Insert this section after the `/api/runs/:id/report` route, before `/* evidence */`:

```ts
/* ------------------------------------------------------------------- scans */

app.post("/api/scans", async (c) => {
  const parsed = CreateScanRequestSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return c.json({ error: formatIssues(parsed.error.issues) }, 400);
  const url = normalizeTargetUrl(parsed.data.url);
  if (!url) return c.json({ error: "url: not a valid http(s) URL" }, 400);

  const scan = await createScan(c.env.DB, url);
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

/** The tree the canvas polls: tasks in rank order, three personas each. */
app.get("/api/scans/:id", async (c) => {
  const scan = await getScan(c.env.DB, c.req.param("id"));
  if (!scan) return c.json({ error: `scan ${c.req.param("id")} not found` }, 404);
  return c.json(await getScanTree(c.env.DB, scan));
});

app.get("/api/scans/:id/report", async (c) => {
  const scan = await getScan(c.env.DB, c.req.param("id"));
  if (!scan) return c.json({ error: `scan ${c.req.param("id")} not found` }, 404);
  const [tree, rows] = await Promise.all([getScanTree(c.env.DB, scan), getScanFindingRows(c.env.DB, scan.id)]);
  return c.json(assembleScanReport({ tree, findings: rows.findings, evidence: rows.evidence }));
});
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @friction/worker typecheck`
Expected: exit 0.

- [ ] **Step 7: Exercise every route against a local Worker**

Start the Worker in the background with `pnpm dev:worker`. Wait for `Ready on http://localhost:8787`, then run this in bash:

```bash
W=http://127.0.0.1:8787
j() { node -pe "const v=JSON.parse(require('fs').readFileSync(0,'utf8')); $1"; }

SCAN=$(curl -s -X POST $W/api/scans -H 'content-type: application/json' -d '{"url":"shop.example"}' | j 'v.scanId'); echo "scan $SCAN"
curl -s -X PATCH $W/api/scans/$SCAN -H 'content-type: application/json' -d '{"page":{"url":"https://shop.example/","title":"Home"},"message":"Reading the landing page (1/2)"}' > /dev/null
curl -s -X PATCH $W/api/scans/$SCAN -H 'content-type: application/json' -d '{"page":{"url":"https://shop.example/help","title":"Help"}}' | j 'v.pages.length + " pages, message=" + v.message'
RUN=$(curl -s -X POST $W/api/runs -H 'content-type: application/json' -d "{\"url\":\"https://shop.example\",\"task\":\"Find the returns policy\",\"scan\":{\"scanId\":\"$SCAN\",\"taskIndex\":0,\"whyCritical\":\"Buyers check returns.\",\"successCheck\":\"Returns text is visible.\"}}" | j 'v.runId'); echo "run $RUN"
curl -s -X POST $W/api/runs/$RUN/events -H 'content-type: application/json' -d "[{\"runId\":\"$RUN\",\"personaId\":\"impatient\",\"seq\":1,\"ts\":1800000000000,\"type\":\"step\",\"payload\":{\"url\":\"https://shop.example/cart\",\"actionType\":\"click\",\"targetLabel\":\"Checkout\",\"selector\":\"#c\",\"rationale\":\"go\",\"screenshotKey\":\"\",\"bbox\":null,\"durationMs\":100,\"domChanged\":false}},{\"runId\":\"$RUN\",\"personaId\":\"impatient\",\"seq\":2,\"ts\":1800000000001,\"type\":\"friction\",\"payload\":{\"category\":\"dead_click\",\"severity\":4,\"evidenceSeq\":1,\"recommendation\":\"Make it respond\",\"confidence\":0.9}}]" | j 'v.accepted + " accepted"'
curl -s $W/api/scans/$SCAN | j 'v.tasks.length + " task(s); impatient findings=" + v.tasks[0].personas[0].findingCount + " worst=" + v.tasks[0].personas[0].worstSeverity'
curl -s $W/api/scans/$SCAN/report | j 'v.issues[0].key + " runsHit=" + v.issues[0].runsHit + "/" + v.issues[0].totalRuns'
curl -s "$W/api/scans?limit=5" | j 'v.scans[0].id + " tasksTotal=" + v.scans[0].tasksTotal'
curl -s -X PATCH $W/api/scans/$SCAN -H 'content-type: application/json' -d '{"status":"completed"}' | j 'v.status + " completedAt=" + (v.completedAt !== null)'
curl -s -o /dev/null -w '%{http_code}\n' -X POST $W/api/runs -H 'content-type: application/json' -d '{"url":"https://shop.example","task":"x","scan":{"scanId":"s_nope","taskIndex":0,"whyCritical":"a","successCheck":"b"}}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST $W/api/scans -H 'content-type: application/json' -d '{"url":"not a url"}'
curl -s -o /dev/null -w '%{http_code}\n' $W/api/scans/s_nope
```

Expected output, in order:

```
scan s_...
2 pages, message=Reading the landing page (1/2)
run r_...
2 accepted
1 task(s); impatient findings=1 worst=4
dead_click|/cart|checkout runsHit=1/3
s_... tasksTotal=1
completed completedAt=true
404
400
404
```

The Worker log also shows `[db] applied 0002_scans (4 statements)` once, the first time the new table is needed. The migration file has 4 statements: 2 tables and 2 indexes.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/migrations/0002_scans.sql apps/worker/src/db.ts apps/worker/src/scanDb.ts apps/worker/src/index.ts
git commit -F - <<'EOF'
feat(worker): scans and scan_tasks tables, /api/scans routes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Orchestrator — shared session pool, run manager split, success check

**Files:**
- Modify: `apps/orchestrator/src/config.ts` (`personaConcurrency` → `maxSessions`)
- Modify: `apps/orchestrator/src/util.ts` (Semaphore comment)
- Modify: `apps/orchestrator/src/runManager.ts` (rewrite)
- Modify: `apps/orchestrator/src/planner.ts` (`PlanRequest`, `userText`)
- Modify: `apps/orchestrator/src/personaRunner.ts` (`PersonaRun`, the two `plan` calls)
- Modify: `apps/orchestrator/src/workerClient.ts`
- Modify: `apps/orchestrator/src/index.ts` (wiring and the log line)

**Interfaces:**
- Consumes (Task 1): `ScanTaskLink`, `ScanPatch`, `CreateScanResponse`.
- Produces:
  - `Config.maxSessions: number`
  - `interface PreparedRun { runId: string; url: string; task: string; successCheck?: string; emitters: Map<PersonaId, PersonaEmitter> }`
  - `class RunManager { constructor(config: Config, worker: WorkerClient, sessions: Semaphore); create(url: string, task: string, options?: { scan?: ScanTaskLink; successCheck?: string }): Promise<PreparedRun>; execute(run: PreparedRun): Promise<Outcome[]>; start(url: string, task: string): Promise<string> }`
  - `WorkerClient.createRun(url: string, task: string, scan?: ScanTaskLink): Promise<string>`, `createScan(url: string): Promise<string>`, `patchScan(scanId: string, patch: ScanPatch): Promise<void>`
  - `PlanRequest.successCheck?: string`, `PersonaRun.successCheck?: string`

- [ ] **Step 1: Replace `personaConcurrency` with `maxSessions` in `config.ts`**

In the `Config` interface, replace `personaConcurrency: number;` with:

```ts
  /** Browser sessions open at once, across every run and scan. Browserbase plans cap concurrency. */
  maxSessions: number;
```

In `load()`, replace `personaConcurrency: int("PERSONA_CONCURRENCY", 3, 1, 3),` with:

```ts
    // PERSONA_CONCURRENCY is the old name, still honoured so existing .env files keep working.
    maxSessions: int("MAX_SESSIONS", int("PERSONA_CONCURRENCY", 3, 1, 100), 1, 100),
```

In `util.ts`, change the comment above `class Semaphore` to:

```ts
/** Caps how many browser sessions are open at once, process-wide (Browserbase plans limit concurrency). Waiters are served first in, first out. */
```

- [ ] **Step 2: Add `successCheck` to the planner (`planner.ts`)**

In `PlanRequest`, after `task: string;`, add:

```ts
  /** What the final page shows when the task is done. Set for scan tasks. */
  successCheck?: string;
```

In `userText`, replace the first entry of `lines`:

```ts
    `Task: ${request.task}`,
```

with:

```ts
    `Task: ${request.task}`,
    ...(request.successCheck ? [`Success looks like: ${request.successCheck}`] : []),
```

- [ ] **Step 3: Pass it through in `personaRunner.ts`**

In `PersonaRun`, after `task: string;`, add:

```ts
  /** From a scan's generated task; the planner judges taskComplete against it. */
  successCheck?: string;
```

In both `run.planner.plan({ ... })` calls, add `successCheck: run.successCheck,` right after `task: run.task,`.

- [ ] **Step 4: Scan calls in `workerClient.ts`**

Change the import to:

```ts
import type { CreateRunResponse, CreateScanResponse, PersonaPatch, RunEvent, ScanPatch, ScanTaskLink } from "@friction/shared";
```

Replace `createRun` and add the two scan methods:

```ts
  /** The one call that is allowed to fail loudly: without a run there is nothing to do. */
  async createRun(url: string, task: string, scan?: ScanTaskLink): Promise<string> {
    const body = scan ? { url, task, scan } : { url, task };
    const response = await retry(3, 300, () => this.request("/api/runs", this.json("POST", body), 8000));
    return ((await response.json()) as CreateRunResponse).runId;
  }

  /** Fails loudly too: no scan, nothing to show. */
  async createScan(url: string): Promise<string> {
    const response = await retry(3, 300, () => this.request("/api/scans", this.json("POST", { url }), 8000));
    return ((await response.json()) as CreateScanResponse).scanId;
  }

  /** Progress and status. Best-effort: a lost progress message must never stop a scan. */
  async patchScan(scanId: string, patch: ScanPatch): Promise<void> {
    try {
      await retry(3, 300, () => this.request(`/api/scans/${scanId}`, this.json("PATCH", patch), 8000));
    } catch (err) {
      log("worker", `PATCH scan ${scanId} failed: ${errorMessage(err)}`);
    }
  }
```

- [ ] **Step 5: Rewrite `apps/orchestrator/src/runManager.ts`**

```ts
/**
 * A run = three personas, concurrently, each isolated from the others' failures.
 *
 * create() and execute() are separate so a scan can create all its runs (and
 * post every persona's idle status) before any of them starts. Live personas
 * wait for a slot in the process-wide session pool; mock personas hold no
 * browser, so they skip it.
 */
import { PERSONAS, type Outcome, type PersonaId, type ScanTaskLink } from "@friction/shared";
import type { Config } from "./config";
import { PersonaEmitter } from "./emitter";
import { openAIJudge } from "./judge";
import { goldenJudge, runMockPersona } from "./mockRunner";
import { runPersona } from "./personaRunner";
import { OpenAIPlanner } from "./planner";
import { errorMessage, log, type Semaphore } from "./util";
import type { WorkerClient } from "./workerClient";

export interface PreparedRun {
  runId: string;
  url: string;
  task: string;
  /** From a scan's generated task: tells the planner what "done" looks like. */
  successCheck?: string;
  emitters: Map<PersonaId, PersonaEmitter>;
}

export class RunManager {
  private readonly active = new Set<string>();

  constructor(
    private readonly config: Config,
    private readonly worker: WorkerClient,
    private readonly sessions: Semaphore,
  ) {}

  get activeRuns(): number {
    return this.active.size;
  }

  /** POST /runs: one task, started in the background. */
  async start(url: string, task: string): Promise<string> {
    const run = await this.create(url, task);
    void this.execute(run);
    return run.runId;
  }

  /**
   * Creates the run and posts every persona's `idle` status before returning.
   * That matters: the Worker's stream treats a run with no events as having no
   * producer and falls back to the fixture, so the producer has to be visibly
   * attached before the UI can possibly connect.
   */
  async create(url: string, task: string, options: { scan?: ScanTaskLink; successCheck?: string } = {}): Promise<PreparedRun> {
    const runId = await this.worker.createRun(url, task, options.scan);
    const mock = this.config.mode === "mock";
    const judge = mock ? null : openAIJudge(this.config);

    const emitters = new Map<PersonaId, PersonaEmitter>();
    for (const persona of PERSONAS) {
      const emitter = new PersonaEmitter(this.worker, runId, persona.id, task, judge ?? goldenJudge(persona.id, this.config.mockSpeed));
      emitter.status("idle", mock ? "Queued (mock mode)." : "Queued. Waiting for a browser session.");
      emitters.set(persona.id, emitter);
    }
    await Promise.all([...emitters.values()].map((emitter) => emitter.flush()));
    return { runId, url, task, successCheck: options.successCheck, emitters };
  }

  /**
   * Runs the three personas. Never rejects. The session pool is entered
   * synchronously, so calling execute() for several runs in order queues their
   * personas in that order.
   */
  async execute(run: PreparedRun): Promise<Outcome[]> {
    const { config, worker } = this;
    const planner = config.mode === "live" ? new OpenAIPlanner(config) : null;
    this.active.add(run.runId);
    log("run", `${run.runId} started in ${config.mode} mode: ${run.task} @ ${run.url}`);

    try {
      // Promise.all over personas that cannot reject: one crash never takes the others down.
      const outcomes = await Promise.all(
        PERSONAS.map((persona) => {
          const emitter = run.emitters.get(persona.id) as PersonaEmitter;
          const work = async (): Promise<Outcome> => {
            try {
              if (!planner) return await runMockPersona({ runId: run.runId, persona, config, worker, emitter });
              return await runPersona({ runId: run.runId, url: run.url, task: run.task, successCheck: run.successCheck, persona, config, worker, planner, emitter });
            } catch (err) {
              // runPersona handles its own failures; this is the belt to its braces.
              log(persona.id, `unexpected failure: ${errorMessage(err)}`);
              emitter.status("failed", `Crashed: ${errorMessage(err)}`);
              emitter.done({ outcome: "failure", durationMs: 0, summary: `Crashed: ${errorMessage(err)}` });
              await emitter.flush();
              return "failure";
            }
          };
          return planner ? this.sessions.run(work) : work();
        }),
      );
      log("run", `${run.runId} finished: ${PERSONAS.map((p, i) => `${p.id}=${outcomes[i]}`).join(" ")}`);
      return outcomes;
    } finally {
      this.active.delete(run.runId);
    }
  }
}
```

- [ ] **Step 6: Wire the pool in `apps/orchestrator/src/index.ts`**

Add `Semaphore` to the `./util` import: `import { Semaphore, errorMessage, log } from "./util";`. Replace `const runs = new RunManager(config, worker);` with:

```ts
/** One pool for every browser this process opens: persona runs and scan crawls alike. */
const sessions = new Semaphore(config.maxSessions);
const runs = new RunManager(config, worker, sessions);
```

In the listen callback, replace `${config.personaConcurrency} personas at a time.` with `${config.maxSessions} browser sessions at a time.`

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @friction/orchestrator typecheck`
Expected: exit 0. `smoke-local.ts` calls `runPersona` directly and still compiles, because `successCheck` is optional.

- [ ] **Step 8: Check that a single run still works in mock mode**

With the Worker running (`pnpm dev:worker`), start the orchestrator in the background with `FRICTION_MOCK=1 pnpm dev:orchestrator`. Then:

```bash
RUN=$(curl -s -X POST http://127.0.0.1:8788/runs -H 'content-type: application/json' -d '{"url":"https://shop.example","task":"Find a jacket"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).runId"); echo $RUN
curl -s http://127.0.0.1:8787/api/runs/$RUN | node -pe "const v=JSON.parse(require('fs').readFileSync(0,'utf8')); v.source + ' ' + v.events.length + ' events'"
```

Expected: a `r_...` id, then `live N events` with N ≥ 3 (the three idle statuses). Repeat the second command after ~30s: N grows and the orchestrator logs `r_... finished: impatient=... cautious=... keyboard=...`.

- [ ] **Step 9: Commit**

```bash
git add apps/orchestrator/src/config.ts apps/orchestrator/src/util.ts apps/orchestrator/src/runManager.ts apps/orchestrator/src/planner.ts apps/orchestrator/src/personaRunner.ts apps/orchestrator/src/workerClient.ts apps/orchestrator/src/index.ts
git commit -F - <<'EOF'
refactor(orchestrator): process-wide session pool, split run create/execute, success check

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Orchestrator — crawl, task generation, scan lifecycle, `POST /scans`

**Files:**
- Modify: `apps/orchestrator/src/pageScripts.ts` (append `NAV_LINKS`)
- Create: `apps/orchestrator/src/crawl.ts`
- Create: `apps/orchestrator/src/taskGen.ts`
- Create: `apps/orchestrator/src/scanManager.ts`
- Modify: `apps/orchestrator/src/index.ts`
- Create: `apps/orchestrator/scripts/smoke-scan.ts`
- Modify: `apps/orchestrator/package.json` (script)

**Interfaces:**
- Consumes (Task 4): `RunManager.create/execute`, `PreparedRun`, `WorkerClient.createScan/patchScan`, `Semaphore`.
- Consumes (Task 1): `pickCrawlLinks`, `parseGeneratedTasks`, `CrawledPage`, `GeneratedTask`, `TaskSource`, `CreateScanRequestSchema`, `CreateScanResponse`, `isScanFinished`.
- Consumes (existing): `openBrowser`, `observe`, `readState`, `readTree`.
- Produces:
  - `crawlSite(config: Config, url: string, onPage: CrawlProgress): Promise<CrawlResult>`
  - `generateTasks(config: Config, url: string, crawl: CrawlResult): Promise<PlannedTasks>`, `fallbackScanTasks(url: string): GeneratedTask[]`
  - `class ScanManager { constructor(config, worker, runs, sessions); start(url: string): Promise<string> }`
  - `POST /scans {url}` → `201 {scanId}` / `400` / `502`

- [ ] **Step 1: Append the `NAV_LINKS` page script to `pageScripts.ts`**

```ts
/**
 * hrefs a visitor reaches from the site's navigation: anchors inside nav,
 * header and [role=navigation] (collapsed dropdown items included), else every
 * visible anchor on the page. Filtering (same origin, auth pages, files) is
 * pickCrawlLinks' job, in Node.
 */
export const NAV_LINKS = `(() => {
  const hrefs = (root, visibleOnly) => Array.from(root.querySelectorAll("a[href]"))
    .filter((a) => !visibleOnly || a.getBoundingClientRect().width > 0)
    .map((a) => a.href);
  const scoped = Array.from(document.querySelectorAll("nav, header, [role=navigation]")).flatMap((el) => hrefs(el, false));
  return scoped.length > 0 ? scoped : hrefs(document, true);
})()`;
```

- [ ] **Step 2: Create `apps/orchestrator/src/crawl.ts`**

```ts
/**
 * The scan's first stage: what does this site offer?
 *
 * ONE browser session reads the landing page (screenshot + pruned a11y tree),
 * then up to five same-origin pages linked from its navigation (a11y tree
 * only: the model gets one image, not six). A page that fails is skipped.
 * Never throws: a site that cannot be read at all comes back with
 * landing: null, and the task generator falls back to generic tasks.
 */
import { pickCrawlLinks, type CrawledPage } from "@friction/shared";
import { openBrowser, type BrowserHandle } from "./browser";
import type { Config } from "./config";
import { observe, readState, readTree } from "./observe";
import { NAV_LINKS } from "./pageScripts";
import { errorMessage, log, withTimeout } from "./util";

/** Accessibility-tree lines per page handed to the model. */
const LINES_PER_PAGE = 60;

export interface PageReading extends CrawledPage {
  lines: string[];
}

export interface CrawlResult {
  /** Null when the landing page could not be read at all. */
  landing: PageReading | null;
  /** Downscaled landing screenshot, base64 JPEG. */
  landingImage: string | null;
  /** Navigation pages that loaded, in navigation order. */
  pages: PageReading[];
}

export type CrawlProgress = (page: CrawledPage, message: string) => Promise<void>;

function pathLabel(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export async function crawlSite(config: Config, url: string, onPage: CrawlProgress): Promise<CrawlResult> {
  const result: CrawlResult = { landing: null, landingImage: null, pages: [] };
  let browser: BrowserHandle | null = null;
  try {
    browser = await withTimeout(openBrowser(config, "crawl"), 120_000, "browser session");
    const { page } = browser;
    await page.goto(url, { waitUntil: "load", timeoutMs: 25_000 }).catch(() => undefined);
    const observation = await observe(page);
    if (observation.tree.lines.length === 0 && !observation.state.title) {
      log("crawl", `${url} rendered nothing readable`);
      return result;
    }
    result.landing = { url: observation.state.url, title: observation.state.title, lines: observation.tree.lines.slice(0, LINES_PER_PAGE) };
    result.landingImage = observation.forModel;

    const hrefs = await withTimeout(page.evaluate<string[]>(NAV_LINKS), 8000, "nav links").catch(() => [] as string[]);
    const links = pickCrawlLinks(observation.state.url, hrefs);
    const total = links.length + 1;
    await onPage({ url: result.landing.url, title: result.landing.title }, `Read the landing page (1/${total})`);

    for (const [index, link] of links.entries()) {
      try {
        await withTimeout(page.goto(link, { waitUntil: "load", timeoutMs: 20_000 }), 25_000, `open ${link}`);
        const state = await readState(page);
        const tree = await readTree(page);
        const reading: PageReading = { url: state.url, title: state.title, lines: tree.lines.slice(0, LINES_PER_PAGE) };
        result.pages.push(reading);
        await onPage({ url: reading.url, title: reading.title }, `Read ${pathLabel(reading.url)} (${index + 2}/${total})`);
      } catch (err) {
        log("crawl", `skipped ${link}: ${errorMessage(err)}`);
      }
    }
  } catch (err) {
    log("crawl", `could not read ${url}: ${errorMessage(err)}`);
  } finally {
    await browser?.close().catch(() => undefined);
  }
  return result;
}
```

- [ ] **Step 3: Create `apps/orchestrator/src/taskGen.ts`**

```ts
/**
 * The scan's second stage: ONE Structured Outputs call turns the crawl into
 * up to ten tasks, most critical first. The model comes from OPENAI_MODEL only.
 *
 * Degrades instead of failing: an unreadable site, a model error or an empty
 * answer all end in ten generic tasks, with a note saying so.
 */
import OpenAI from "openai";
import { parseGeneratedTasks, type GeneratedTask, type TaskSource } from "@friction/shared";
import type { Config } from "./config";
import type { CrawlResult } from "./crawl";
import { errorMessage, log } from "./util";

export interface PlannedTasks {
  tasks: GeneratedTask[];
  source: TaskSource;
  /** Shown on the root node when the tasks are not what the user might expect. */
  note: string | null;
}

const TASKS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      description: "Exactly ten tasks, most critical first.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "whyCritical", "successCheck"],
        properties: {
          title: { type: "string", description: "One imperative sentence, at most 14 words." },
          whyCritical: { type: "string", description: "One sentence: why this flow matters to the business or its visitors." },
          successCheck: { type: "string", description: "What the final page visibly shows when the task is done." },
        },
      },
    },
  },
};

const INSTRUCTIONS = [
  "You plan QA for a website. From what a crawler saw on its landing page and main navigation pages, choose the 10 most critical tasks a real visitor must be able to complete, ranked most critical first.",
  "Critical means the flows this site exists for: buying or converting, finding key information (products, pricing, policies, opening hours), and getting help.",
  "Each title is one imperative sentence of at most 14 words, specific to this site, achievable in about ten clicks from the landing page, and verifiable by looking at the final page.",
  "Cover different flows: never propose two variations of the same task.",
  "Never involve logging in, creating an account, entering personal data or paying. Adding to a cart is fine; checking out is not.",
].join("\n");

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the site";
  }
}

/** Ten tasks that make sense on most sites. Used when the site or the model lets us down, and in mock mode. */
export function fallbackScanTasks(url: string): GeneratedTask[] {
  const host = hostOf(url);
  return [
    { title: `Find the most popular product on ${host} and add it to the cart`, whyCritical: "Adding to the cart is the first step of every sale.", successCheck: "The cart shows at least one item." },
    { title: `Use search on ${host} to find a specific item and open it`, whyCritical: "Visitors who search know what they want and convert best.", successCheck: "A product or result detail page is open." },
    { title: `Find the price of the main product or plan on ${host}`, whyCritical: "Unclear pricing is a leading reason visitors leave.", successCheck: "A price is visible on the page." },
    { title: `Find how to contact support on ${host}`, whyCritical: "Stuck visitors who cannot reach help are lost.", successCheck: "A contact form, email address, phone number or chat is visible." },
    { title: `Find the return or refund policy on ${host}`, whyCritical: "Buyers check returns before committing to a purchase.", successCheck: "The return or refund policy text is visible." },
    { title: `Browse a product category on ${host} and open an item`, whyCritical: "Browsing is how undecided visitors discover what to buy.", successCheck: "An item detail page reached from a category is open." },
    { title: `Find shipping costs or delivery times on ${host}`, whyCritical: "Surprise shipping costs are a top cause of abandoned carts.", successCheck: "Shipping costs or delivery times are visible." },
    { title: `Find the answer to a common question in the ${host} help center`, whyCritical: "Self-service help keeps visitors moving without a support ticket.", successCheck: "An FAQ or help article is open." },
    { title: `Find out who is behind ${host} on its About page`, whyCritical: "Visitors trust a site more when they know who runs it.", successCheck: "An About or company page is open." },
    { title: `Find the terms of service or privacy policy on ${host}`, whyCritical: "Legal pages must be reachable for trust and compliance.", successCheck: "Terms of service or privacy policy text is visible." },
  ];
}

export async function generateTasks(config: Config, url: string, crawl: CrawlResult): Promise<PlannedTasks> {
  const generic = (note: string): PlannedTasks => ({ tasks: fallbackScanTasks(url), source: "fallback", note });
  if (!crawl.landing) return generic("Couldn't read the site, so these tasks are generic.");
  if (!config.openaiModel) return generic("OPENAI_MODEL is not set, so these tasks are generic.");

  try {
    const pages = [crawl.landing, ...crawl.pages];
    const text = pages
      .map((page, index) =>
        [`Page ${index + 1}${index === 0 ? " (landing)" : ""}: ${page.url}`, `Title: ${page.title || "(none)"}`, page.lines.join("\n")].join("\n"),
      )
      .join("\n\n");
    const content: OpenAI.Responses.ResponseInputContent[] = [{ type: "input_text", text }];
    if (crawl.landingImage) content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${crawl.landingImage}`, detail: config.imageDetail });

    const client = new OpenAI({ apiKey: config.openaiApiKey ?? undefined, maxRetries: 1, timeout: 90_000 });
    const response = await client.responses.create({
      model: config.openaiModel,
      instructions: INSTRUCTIONS,
      input: [{ role: "user", content }],
      store: false,
      ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort as "low" } } : {}),
      text: { format: { type: "json_schema", name: "qa_tasks", schema: TASKS_JSON_SCHEMA, strict: true } },
    });

    const tasks = parseGeneratedTasks(JSON.parse(response.output_text));
    if (tasks.length === 0) return generic("The model returned no usable tasks, so these are generic.");
    return { tasks, source: "model", note: null };
  } catch (err) {
    log("scan", `task generation failed: ${errorMessage(err)}`);
    return generic(`Task generation failed (${errorMessage(err)}), so these tasks are generic.`);
  }
}
```

- [ ] **Step 4: Create `apps/orchestrator/src/scanManager.ts`**

```ts
/**
 * A scan: one URL -> crawl -> up to ten generated tasks -> one run per task.
 *
 *   crawling   one browser session reads the landing page and up to five nav pages
 *   running    every task is a normal run (three personas); all of them queue
 *              for the shared session pool in task-rank order
 *   completed  every persona is done
 *
 * The background work never throws: whatever goes wrong ends as a `failed`
 * scan with a message, which the root node shows.
 */
import type { Config } from "./config";
import { crawlSite } from "./crawl";
import type { PreparedRun, RunManager } from "./runManager";
import { fallbackScanTasks, generateTasks, type PlannedTasks } from "./taskGen";
import { errorMessage, log, sleep, type Semaphore } from "./util";
import type { WorkerClient } from "./workerClient";

const MOCK_PAGES = [
  { path: "/", title: "Home" },
  { path: "/products", title: "Products" },
  { path: "/help", title: "Help" },
] as const;

export class ScanManager {
  constructor(
    private readonly config: Config,
    private readonly worker: WorkerClient,
    private readonly runs: RunManager,
    private readonly sessions: Semaphore,
  ) {}

  /** Creates the scan and returns its id at once; everything else happens in the background. */
  async start(url: string): Promise<string> {
    const scanId = await this.worker.createScan(url);
    void this.run(scanId, url);
    return scanId;
  }

  private async run(scanId: string, url: string): Promise<void> {
    const { worker, runs } = this;
    log("scan", `${scanId} started in ${this.config.mode} mode: ${url}`);

    let plan: PlannedTasks;
    try {
      plan = this.config.mode === "mock" ? await this.mockPlan(scanId, url) : await this.livePlan(scanId, url);
    } catch (err) {
      // crawlSite and generateTasks both degrade on their own; this is the belt to their braces.
      plan = { tasks: fallbackScanTasks(url), source: "fallback", note: `Couldn't read the site (${errorMessage(err)}), so these tasks are generic.` };
    }

    const prepared: PreparedRun[] = [];
    try {
      for (const [index, task] of plan.tasks.entries()) {
        prepared.push(
          await runs.create(url, task.title, {
            scan: { scanId, taskIndex: index, whyCritical: task.whyCritical, successCheck: task.successCheck },
            successCheck: task.successCheck,
          }),
        );
      }
    } catch (err) {
      log("scan", `${scanId} failed: ${errorMessage(err)}`);
      await worker.patchScan(scanId, { status: "failed", taskSource: plan.source, message: `Could not create the runs: ${errorMessage(err)}` });
      return;
    }

    await worker.patchScan(scanId, {
      status: "running",
      taskSource: plan.source,
      message: plan.note ?? `Testing ${plan.tasks.length} tasks with three personas each.`,
    });

    // execute() enters the session pool synchronously, so calling it in rank
    // order means the most critical tasks get browsers first.
    const outcomes = (await Promise.all(prepared.map((run) => runs.execute(run)))).flat();
    const succeeded = outcomes.filter((outcome) => outcome === "success").length;
    await worker.patchScan(scanId, { status: "completed", message: `${succeeded} of ${outcomes.length} persona runs completed their task.` });
    log("scan", `${scanId} finished: ${succeeded}/${outcomes.length} persona runs succeeded`);
  }

  private async livePlan(scanId: string, url: string): Promise<PlannedTasks> {
    const crawl = await this.sessions.run(() => crawlSite(this.config, url, (page, message) => this.worker.patchScan(scanId, { page, message })));
    await this.worker.patchScan(scanId, { message: "Choosing the 10 most critical tasks." });
    return generateTasks(this.config, url, crawl);
  }

  /** No browser, no model: a scripted crawl so the root node still shows progress. */
  private async mockPlan(scanId: string, url: string): Promise<PlannedTasks> {
    for (const [index, page] of MOCK_PAGES.entries()) {
      await sleep(1500 / this.config.mockSpeed);
      await this.worker.patchScan(scanId, {
        page: { url: new URL(page.path, url).toString(), title: page.title },
        message: `Read ${page.path} (${index + 1}/${MOCK_PAGES.length})`,
      });
    }
    return { tasks: fallbackScanTasks(url), source: "mock", note: "Mock mode: canned tasks, and every run replays the golden run." };
  }
}
```

- [ ] **Step 5: Add `POST /scans` in `apps/orchestrator/src/index.ts`**

Update the header comment's endpoint list to:

```ts
/**
 * Friction orchestrator.
 *   POST /scans          { url }       -> { scanId } at once; crawl, 10 tasks, 30 persona runs in the background
 *   POST /runs           { url, task } -> { runId } at once; three personas run in the background
 *   POST /suggest-tasks  { url }       -> three candidate tasks (convenience only)
 *   GET  /health                       -> live or mock, and which env vars are missing
 */
```

Add `CreateScanRequestSchema` and `type CreateScanResponse` to the `@friction/shared` import, and add `import { ScanManager } from "./scanManager";`. After the `runs` line, add:

```ts
const scans = new ScanManager(config, worker, runs, sessions);
```

After the `app.post("/runs", ...)` handler, add:

```ts
app.post("/scans", async (req, res) => {
  const parsed = CreateScanRequestSchema.safeParse(req.body);
  const url = parsed.success ? normalizeTargetUrl(parsed.data.url) : null;
  if (!url) {
    res.status(400).json({ error: "url: not a valid http(s) URL" });
    return;
  }
  try {
    const body: CreateScanResponse = { scanId: await scans.start(url) };
    res.status(201).json(body);
  } catch (err) {
    log("http", `could not start a scan: ${errorMessage(err)}`);
    res.status(502).json({ error: `Worker unreachable at ${config.workerUrl}: ${errorMessage(err)}` });
  }
});
```

- [ ] **Step 6: Create `apps/orchestrator/scripts/smoke-scan.ts`**

```ts
/**
 * End-to-end check of a scan, in mock mode: no keys, no browser.
 *
 *   pnpm dev:worker
 *   FRICTION_MOCK=1 pnpm dev:orchestrator
 *   pnpm --filter @friction/orchestrator smoke:scan [url]
 *
 * Starts a scan, follows the tree until it finishes, then checks the merged
 * report. Exits 1 on the first thing that is wrong.
 */
import { isScanFinished, isTerminalState, type CreateScanResponse, type ScanReportResponse, type ScanTreeResponse } from "@friction/shared";

const ORCHESTRATOR = (process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
const WORKER = (process.env.WORKER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const TARGET = process.argv[2] ?? `${WORKER}/demo-shop/`;
const DEADLINE_MS = 5 * 60_000;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function follow(scanId: string): Promise<ScanTreeResponse> {
  const started = Date.now();
  for (;;) {
    const tree = await json<ScanTreeResponse>(`${WORKER}/api/scans/${scanId}`);
    const personas = tree.tasks.flatMap((task) => task.personas);
    const done = personas.filter((p) => isTerminalState(p.state)).length;
    console.log(
      `${Math.round((Date.now() - started) / 1000)}s  ${tree.scan.status}  pages=${tree.scan.pages.length}  tasks=${tree.tasks.length}  runs done=${done}/${personas.length}  ${tree.scan.message ?? ""}`,
    );
    if (isScanFinished(tree.scan.status)) return tree;
    if (Date.now() - started > DEADLINE_MS) fail("the scan did not finish within 5 minutes");
    await new Promise((resume) => setTimeout(resume, 3000));
  }
}

const { scanId } = await json<CreateScanResponse>(`${ORCHESTRATOR}/scans`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: TARGET }),
});
console.log(`scan ${scanId} started for ${TARGET}`);

const tree = await follow(scanId);
if (tree.scan.status !== "completed") fail(`scan ended as ${tree.scan.status}: ${tree.scan.message ?? ""}`);
if (tree.tasks.length !== 10) fail(`expected 10 tasks, got ${tree.tasks.length}`);
const personas = tree.tasks.flatMap((task) => task.personas);
if (personas.length !== 30) fail(`expected 30 persona runs, got ${personas.length}`);
if (!personas.every((p) => isTerminalState(p.state))) fail("the scan completed with persona runs still going");

const report = await json<ScanReportResponse>(`${WORKER}/api/scans/${scanId}/report`);
if (report.issues.length === 0) fail("the report has no issues");
const widest = Math.max(...report.issues.map((issue) => issue.runsHit));
if (widest <= 1) fail("no issue was merged across runs (max runsHit is 1)");
console.log(`report: ${report.issues.length} issues, widest hit ${widest}/${report.issues[0]?.totalRuns ?? 0} runs, verdicts ${JSON.stringify(report.summary.verdicts)}`);
console.log(`OK  open http://localhost:5173/?scan=${scanId}`);
```

In `apps/orchestrator/package.json`, add to `scripts`, after `"smoke"`:

```json
    "smoke:scan": "tsx scripts/smoke-scan.ts"
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @friction/orchestrator typecheck`
Expected: exit 0.

- [ ] **Step 8: Run a full scan in mock mode**

With `pnpm dev:worker` and `FRICTION_MOCK=1 pnpm dev:orchestrator` running (`node --watch` has picked up the changes), run:

`pnpm --filter @friction/orchestrator smoke:scan`

Expected, in order:

1. Progress lines go from `crawling pages=1..3` to `running tasks=10 runs done=0/30`, and on to `completed ... runs done=30/30`.
2. A line of the form `report: N issues, widest hit W/30 runs, verdicts {...}` with `W ≥ 10`.
3. `OK  open http://localhost:5173/?scan=s_...`. Keep that id for Task 9.

- [ ] **Step 9: Commit**

```bash
git add apps/orchestrator/src/pageScripts.ts apps/orchestrator/src/crawl.ts apps/orchestrator/src/taskGen.ts apps/orchestrator/src/scanManager.ts apps/orchestrator/src/index.ts apps/orchestrator/scripts/smoke-scan.ts apps/orchestrator/package.json
git commit -F - <<'EOF'
feat(orchestrator): POST /scans: crawl, generate 10 tasks, fan out 30 persona runs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Control room — scan data layer and side panels

**Files:**
- Modify: `apps/control-room/src/lib/api.ts` (add scan calls)
- Modify: `apps/control-room/src/lib/useQuery.ts`
- Create: `apps/control-room/src/lib/scan.ts`
- Create: `apps/control-room/src/hooks/useScan.ts`
- Create: `apps/control-room/src/hooks/useScanReport.ts`
- Modify: `apps/control-room/src/components/badges.tsx` (`StateBadge`)
- Create: `apps/control-room/src/components/scan/IssueCard.tsx`
- Create: `apps/control-room/src/components/scan/RootPanel.tsx`
- Create: `apps/control-room/src/components/scan/TaskPanel.tsx`
- Create: `apps/control-room/src/components/scan/PersonaPanel.tsx`
- Create: `apps/control-room/src/components/scan/SidePanel.tsx`

**Interfaces:**
- Consumes (Tasks 1–3): `ScanTreeResponse`, `ScanTreeTask`, `ScanReportResponse`, `ScanIssue`, `ScanListResponse`, `CreateScanResponse`, `ScanNode`, `parseScanNode`, `scanNodeId`, `taskVerdict`, `isScanFinished`, `TaskVerdict`, `ScanStatus`, `CrawledPage`.
- Consumes (existing): `useRunStream`, `PersonaColumn`, `EvidenceImage`, `SEVERITY_STYLES`, `SeverityBadge`, `StateBadge`, `categoryLabel`, `pathOf`.
- Produces:
  - `api.startScan(url)`, `api.listScans()`, `api.getScanTree(id)`, `api.getScanReport(id)`
  - `Query.scan`, `Query.node`
  - `useScan(scanId: string): ScanPoll`, where `ScanPoll = { tree: ScanTreeResponse | null; stale: boolean; missing: boolean }`
  - `useScanReport(scanId: string, refreshKey: string): { report: ScanReportResponse | null; loading: boolean }`
  - `lib/scan.ts`: `personaShortName`, `SCAN_STATUS_CHIPS`, `VERDICT_STYLES`, `runProgress`, `totalFindings`, `hostOf`
  - `SidePanel(props: { tree; report; node: ScanNode; onSelect: (nodeId: string) => void; onOpenRun: (runId: string) => void })`

The control room has no test runner, so this task is verified by typecheck. The panels are exercised in the browser in Tasks 7 and 9.

- [ ] **Step 1: Add the scan calls to `api.ts`**

Add `CreateScanResponse`, `ScanListResponse`, `ScanReportResponse` and `ScanTreeResponse` to the type import. Inside `api`, after `orchestratorHealth`, add:

```ts
  /** Starts the crawl and all persona runs in the background; returns at once. */
  startScan: (url: string) => request<CreateScanResponse>(`${ORCHESTRATOR_URL}/scans`, json({ url }), 12_000),

  listScans: () => request<ScanListResponse>(`${WORKER_URL}/api/scans?limit=12`, undefined, 5000),
  getScanTree: (scanId: string) => request<ScanTreeResponse>(`${WORKER_URL}/api/scans/${encodeURIComponent(scanId)}`, undefined, 6000),
  getScanReport: (scanId: string) => request<ScanReportResponse>(`${WORKER_URL}/api/scans/${encodeURIComponent(scanId)}/report`, undefined, 8000),
```

- [ ] **Step 2: Replace `apps/control-room/src/lib/useQuery.ts`**

```ts
import { useCallback, useEffect, useState } from "react";

export type Tab = "room" | "report";

export interface Query {
  run: string | null;
  scan: string | null;
  /** Selected node on the scan canvas ("t2", "t2.keyboard"); null = the root. */
  node: string | null;
  replay: boolean;
  tab: Tab;
}

function read(): Query {
  const params = new URLSearchParams(window.location.search);
  return {
    run: params.get("run") || null,
    scan: params.get("scan") || null,
    node: params.get("node") || null,
    replay: params.get("replay") === "1",
    tab: params.get("tab") === "report" ? "report" : "room",
  };
}

function write(query: Query): string {
  const params = new URLSearchParams();
  if (query.scan) {
    params.set("scan", query.scan);
    if (query.node && query.node !== "root") params.set("node", query.node);
  } else if (query.run) {
    params.set("run", query.run);
    if (query.replay) params.set("replay", "1");
    if (query.tab === "report") params.set("tab", "report");
  }
  const search = params.toString();
  return search ? `?${search}` : window.location.pathname;
}

/**
 * The URL is the app state: ?scan=<id>[&node=<id>] for a scan, or
 * ?run=<id>[&replay=1][&tab=report] for a single run. That keeps every view
 * linkable (handy when the demo laptop needs a specific run, fast) and makes
 * the back button behave.
 */
export function useQuery(): [Query, (patch: Partial<Query>) => void] {
  const [query, setQuery] = useState<Query>(read);

  useEffect(() => {
    const onPop = (): void => setQuery(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = useCallback((patch: Partial<Query>) => {
    const next = { ...read(), ...patch };
    window.history.pushState(null, "", write(next));
    setQuery(next);
  }, []);

  return [query, update];
}
```

- [ ] **Step 3: Create `apps/control-room/src/lib/scan.ts`**

```ts
import { PERSONA_BY_ID, isTerminalState, type PersonaId, type ScanStatus, type ScanTreeResponse, type TaskVerdict } from "@friction/shared";

/** "Impatient power user" -> "Impatient". */
export function personaShortName(id: PersonaId): string {
  return PERSONA_BY_ID[id].displayName.split(" ")[0] ?? id;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const SCAN_STATUS_CHIPS: Readonly<Record<ScanStatus, { label: string; tone: "slate" | "indigo" | "amber" | "emerald" }>> = {
  crawling: { label: "Crawling", tone: "indigo" },
  running: { label: "Running", tone: "indigo" },
  completed: { label: "Completed", tone: "emerald" },
  failed: { label: "Failed", tone: "amber" },
};

export const VERDICT_STYLES: Readonly<Record<TaskVerdict, { label: string; className: string }>> = {
  pass: { label: "Pass", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  partial: { label: "Partial", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  fail: { label: "Fail", className: "bg-red-50 text-red-700 ring-red-200" },
  pending: { label: "Pending", className: "bg-slate-100 text-slate-600 ring-slate-200" },
};

/** Persona runs finished vs. total. */
export function runProgress(tree: ScanTreeResponse): { done: number; total: number } {
  const personas = tree.tasks.flatMap((task) => task.personas);
  return { done: personas.filter((p) => isTerminalState(p.state)).length, total: personas.length };
}

export function totalFindings(tree: ScanTreeResponse): number {
  return tree.tasks.reduce((sum, task) => sum + task.personas.reduce((inner, p) => inner + p.findingCount, 0), 0);
}
```

- [ ] **Step 4: Create `apps/control-room/src/hooks/useScan.ts`**

```ts
import { useEffect, useState } from "react";
import { isScanFinished, type ScanTreeResponse } from "@friction/shared";
import { ApiError, api } from "../lib/api";

const POLL_MS = 2000;

export interface ScanPoll {
  tree: ScanTreeResponse | null;
  /** The latest poll failed; `tree` is the last one that worked. */
  stale: boolean;
  /** The Worker says this scan does not exist. Nothing to retry. */
  missing: boolean;
}

/**
 * Polls GET /api/scans/:id every 2s until the scan completes or fails. It is
 * one small query per poll; the selected persona node streams on its own.
 */
export function useScan(scanId: string): ScanPoll {
  const [state, setState] = useState<ScanPoll>({ tree: null, stale: false, missing: false });

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setState({ tree: null, stale: false, missing: false });

    const poll = async (): Promise<void> => {
      try {
        const tree = await api.getScanTree(scanId);
        if (cancelled) return;
        setState({ tree, stale: false, missing: false });
        if (isScanFinished(tree.scan.status)) return;
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState((previous) => ({ ...previous, missing: true }));
          return;
        }
        setState((previous) => ({ ...previous, stale: true }));
      }
      timer = window.setTimeout(() => void poll(), POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scanId]);

  return state;
}
```

- [ ] **Step 5: Create `apps/control-room/src/hooks/useScanReport.ts`**

```ts
import { useEffect, useState } from "react";
import type { ScanReportResponse } from "@friction/shared";
import { api } from "../lib/api";

/**
 * The merged site report. Refetched whenever refreshKey changes (the caller
 * derives it from finding counts and status); a failed fetch keeps the last one.
 */
export function useScanReport(scanId: string, refreshKey: string): { report: ScanReportResponse | null; loading: boolean } {
  const [report, setReport] = useState<ScanReportResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => setReport(null), [scanId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getScanReport(scanId)
      .then((body) => {
        if (!cancelled) setReport(body);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId, refreshKey]);

  return { report, loading };
}
```

- [ ] **Step 6: Give `StateBadge` an `idleLabel` in `badges.tsx`**

Replace the `StateBadge` function with:

```tsx
export function StateBadge({ state, prefix, idleLabel }: { state: PersonaState; prefix?: string; idleLabel?: string }) {
  const style = STATE_STYLES[state];
  const label = state === "idle" && idleLabel ? idleLabel : style.label;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style.chip}`}>
      <span className="relative flex h-1.5 w-1.5">
        {style.pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${style.dot}`} />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${style.dot}`} />
      </span>
      {prefix ? `${prefix} · ${label}` : label}
    </span>
  );
}
```

- [ ] **Step 7: Create `apps/control-room/src/components/scan/IssueCard.tsx`**

```tsx
import { FRICTION_LABELS, scanNodeId, type ScanIssue } from "@friction/shared";
import { personaShortName } from "../../lib/scan";
import { EvidenceImage } from "../EvidenceImage";
import { SEVERITY_STYLES, SeverityBadge, categoryLabel } from "../badges";

interface Props {
  issue: ScanIssue;
  rank: number;
  onSelect: (nodeId: string) => void;
}

/** One merged issue: how bad, how widespread, the evidence, and every run that hit it. */
export function IssueCard({ issue, rank, onSelect }: Props) {
  const style = SEVERITY_STYLES[issue.severity];
  // One chip per task x persona run, even when that run hit the issue more than once.
  const runs = new Map(issue.occurrences.map((o) => [`${o.taskIndex}.${o.personaId}`, o] as const));

  return (
    <article className={`overflow-hidden rounded-lg border border-l-4 border-slate-200 bg-white shadow-sm ${style.border}`}>
      {issue.evidence && (
        <EvidenceImage
          source={{ screenshotKey: issue.evidence.screenshotKey, bbox: issue.evidence.bbox, viewport: issue.evidence.viewport }}
          boxClass={style.box}
          label={issue.evidence.targetLabel}
        />
      )}
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold tabular-nums text-slate-400">#{rank}</span>
          <SeverityBadge severity={issue.severity} withLabel />
          <h3 className={`text-sm font-semibold ${style.text}`} title={FRICTION_LABELS[issue.category].blurb}>
            {categoryLabel(issue.category)}
          </h3>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Hit in {issue.runsHit}/{issue.totalRuns} runs · {issue.taskIndexes.length} {issue.taskIndexes.length === 1 ? "task" : "tasks"} ·{" "}
          {issue.personas.map(personaShortName).join(", ")}
          {issue.page && (
            <>
              {" · "}
              <span className="font-mono">{issue.page}</span>
            </>
          )}
        </p>
        {issue.summary && <p className="mt-1.5 text-[13px] font-medium leading-snug text-slate-900">{issue.summary}</p>}
        {issue.whyItMatters && <p className="mt-1 text-xs leading-relaxed text-slate-600">{issue.whyItMatters}</p>}
        <p className={`mt-2 rounded px-2 py-1.5 text-xs leading-snug text-slate-800 ${style.bg}`}>
          <span className={`font-semibold ${style.text}`}>Fix: </span>
          {issue.recommendation}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {[...runs.values()].map((o) => (
            <button
              key={`${o.taskIndex}.${o.personaId}`}
              type="button"
              onClick={() => onSelect(scanNodeId({ kind: "persona", index: o.taskIndex, personaId: o.personaId }))}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
            >
              T{o.taskIndex + 1} · {personaShortName(o.personaId)}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 8: Create `apps/control-room/src/components/scan/RootPanel.tsx`**

```tsx
import { PERSONAS, SEVERITY_LABELS, isScanFinished, type CrawledPage, type ScanReportResponse, type ScanTreeResponse, type Severity, type TaskVerdict } from "@friction/shared";
import { pathOf } from "../../lib/format";
import { VERDICT_STYLES, hostOf } from "../../lib/scan";
import { SEVERITY_STYLES } from "../badges";
import { IssueCard } from "./IssueCard";

interface Props {
  tree: ScanTreeResponse;
  report: ScanReportResponse | null;
  onSelect: (nodeId: string) => void;
}

const SEVERITIES: Severity[] = [5, 4, 3, 2, 1];
const VERDICTS: TaskVerdict[] = ["pass", "partial", "fail", "pending"];

/** The site root: crawl progress while crawling, then the merged site report. */
export function RootPanel({ tree, report, onSelect }: Props) {
  const { scan } = tree;
  const crawling = tree.tasks.length === 0;

  return (
    <div className="space-y-4 p-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Site report</p>
        <h2 className="mt-0.5 text-base font-semibold text-slate-900">{hostOf(scan.url)}</h2>
        {scan.message && <p className="mt-1 text-xs text-slate-600">{scan.message}</p>}
      </header>

      {scan.taskSource === "fallback" && <Notice>Couldn't read the site, so these tasks are generic.</Notice>}
      {scan.taskSource === "mock" && <Notice>Mock mode: canned tasks, and every run replays the golden run.</Notice>}
      {!crawling && !isScanFinished(scan.status) && <Notice>Partial report: the scan is still running.</Notice>}

      {crawling ? (
        <PageList pages={scan.pages} title={scan.status === "failed" ? "Pages read before the scan failed" : "Pages read so far"} />
      ) : report ? (
        <ReportBody report={report} onSelect={onSelect} />
      ) : (
        <p className="text-sm text-slate-400">Building the report…</p>
      )}

      {!crawling && scan.pages.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">Crawled pages ({scan.pages.length})</summary>
          <div className="border-t border-slate-100 px-3 py-2">
            <PageItems pages={scan.pages} />
          </div>
        </details>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">{children}</p>;
}

function PageList({ pages, title }: { pages: CrawledPage[]; title: string }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {pages.length === 0 ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
          Opening the site…
        </p>
      ) : (
        <div className="mt-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <PageItems pages={pages} />
        </div>
      )}
    </section>
  );
}

function PageItems({ pages }: { pages: CrawledPage[] }) {
  return (
    <ul className="space-y-1">
      {pages.map((page) => (
        <li key={page.url} className="min-w-0 text-xs">
          <span className="font-medium text-slate-800">{page.title || "(untitled)"}</span>{" "}
          <span className="break-all font-mono text-[11px] text-slate-500">{pathOf(page.url)}</span>
        </li>
      ))}
    </ul>
  );
}

function ReportBody({ report, onSelect }: { report: ScanReportResponse; onSelect: (nodeId: string) => void }) {
  const { summary } = report;
  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-4 gap-1.5">
          {VERDICTS.map((verdict) => (
            <div key={verdict} className={`rounded px-2 py-1.5 text-center ring-1 ring-inset ${VERDICT_STYLES[verdict].className}`}>
              <div className="text-lg font-bold tabular-nums leading-none">{summary.verdicts[verdict]}</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide">{VERDICT_STYLES[verdict].label}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1">
          {PERSONAS.map((persona) => {
            const stats = summary.personas[persona.id];
            return (
              <div key={persona.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600">{persona.displayName}</span>
                <span className="tabular-nums text-slate-500">
                  {stats.succeeded}/{stats.total} tasks completed
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-end gap-1">
          {SEVERITIES.map((severity) => (
            <div key={severity} className="text-center" title={SEVERITY_LABELS[severity]}>
              <div
                className={`min-w-8 rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${summary.issuesBySeverity[severity] > 0 ? SEVERITY_STYLES[severity].solid : "bg-slate-100 text-slate-400"}`}
              >
                {summary.issuesBySeverity[severity]}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">S{severity}</div>
            </div>
          ))}
          <span className="ml-auto text-[11px] text-slate-500">{report.issues.length} issues</span>
        </div>
      </section>

      <section className="space-y-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Issues, by severity then reach</h3>
        {report.issues.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-xs text-slate-400">No friction found yet.</p>
        )}
        {report.issues.map((issue, index) => (
          <IssueCard key={issue.key} issue={issue} rank={index + 1} onSelect={onSelect} />
        ))}
      </section>
    </>
  );
}
```

- [ ] **Step 9: Create `apps/control-room/src/components/scan/TaskPanel.tsx`**

```tsx
import { PERSONA_BY_ID, scanNodeId, taskVerdict, type ScanReportResponse, type ScanTreeTask } from "@friction/shared";
import { VERDICT_STYLES } from "../../lib/scan";
import { StateBadge } from "../badges";
import { IssueCard } from "./IssueCard";

interface Props {
  task: ScanTreeTask;
  report: ScanReportResponse | null;
  onSelect: (nodeId: string) => void;
  onOpenRun: (runId: string) => void;
}

export function TaskPanel({ task, report, onSelect, onOpenRun }: Props) {
  const verdict = VERDICT_STYLES[taskVerdict(task.personas.map((p) => p.state))];
  const issues = report ? report.issues.filter((issue) => issue.taskIndexes.includes(task.index)) : [];

  return (
    <div className="space-y-4 p-4">
      <header>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Task {task.index + 1}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${verdict.className}`}>{verdict.label}</span>
        </div>
        <h2 className="mt-1 text-base font-semibold leading-snug text-slate-900">{task.title}</h2>
      </header>

      <dl className="space-y-2 text-xs">
        <div>
          <dt className="font-semibold text-slate-700">Why it's critical</dt>
          <dd className="mt-0.5 leading-relaxed text-slate-600">{task.whyCritical}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-700">Success looks like</dt>
          <dd className="mt-0.5 leading-relaxed text-slate-600">{task.successCheck}</dd>
        </div>
      </dl>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Personas</h3>
        <ul className="mt-1.5 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {task.personas.map((p) => (
            <li key={p.personaId}>
              <button
                type="button"
                onClick={() => onSelect(scanNodeId({ kind: "persona", index: task.index, personaId: p.personaId }))}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{PERSONA_BY_ID[p.personaId].displayName}</span>
                <span className="shrink-0 tabular-nums text-slate-400">
                  {p.stepCount} steps · {p.findingCount} findings
                </span>
                <StateBadge state={p.state} idleLabel="Queued" />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => onOpenRun(task.runId)} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">
          Open full control room →
        </button>
      </section>

      <section className="space-y-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Issues in this task ({issues.length})</h3>
        {issues.length === 0 && <p className="text-xs text-slate-400">{report ? "None so far." : "Building the report…"}</p>}
        {report &&
          issues.map((issue) => <IssueCard key={issue.key} issue={issue} rank={report.issues.indexOf(issue) + 1} onSelect={onSelect} />)}
      </section>
    </div>
  );
}
```

- [ ] **Step 10: Create `apps/control-room/src/components/scan/PersonaPanel.tsx`**

```tsx
import { scanNodeId, type PersonaId, type ScanTreeTask } from "@friction/shared";
import { useRunStream } from "../../hooks/useRunStream";
import { EvidenceImage } from "../EvidenceImage";
import { PersonaColumn } from "../PersonaColumn";
import { SEVERITY_STYLES, SeverityBadge, categoryLabel } from "../badges";

interface Props {
  task: ScanTreeTask;
  personaId: PersonaId;
  onSelect: (nodeId: string) => void;
}

/** One persona run, live: the existing control-room column plus its evidence. */
export function PersonaPanel({ task, personaId, onSelect }: Props) {
  const stream = useRunStream(task.runId, { replay: false });
  const persona = stream.view.personas[personaId];
  const evidence = [...persona.frictions].sort((a, b) => b.payload.severity - a.payload.severity || a.seq - b.seq);

  return (
    <div className="space-y-3 p-4">
      <header>
        <button
          type="button"
          onClick={() => onSelect(scanNodeId({ kind: "task", index: task.index }))}
          className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 hover:underline"
        >
          ← Task {task.index + 1}
        </button>
        <h2 className="mt-1 text-sm font-semibold leading-snug text-slate-900">{task.title}</h2>
      </header>

      {stream.notice && <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900">{stream.notice}</p>}

      {/* A grid cell stretches to the fixed height, which PersonaColumn's inner scroll panes need. */}
      <div className="grid h-160 min-h-0">
        <PersonaColumn persona={persona} allowLiveView={stream.origin === "live"} startTs={stream.view.firstTs} />
      </div>

      {evidence.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Evidence ({evidence.length})</h3>
          {evidence.map((friction) => {
            const step = persona.steps.find((s) => s.seq === friction.payload.evidenceSeq);
            const style = SEVERITY_STYLES[friction.payload.severity];
            return (
              <article key={friction.seq} className={`overflow-hidden rounded-lg border border-l-4 border-slate-200 bg-white ${style.border}`}>
                {step && (
                  <EvidenceImage
                    source={{ screenshotKey: step.payload.screenshotKey, bbox: step.payload.bbox, viewport: step.payload.viewport, payload: step.payload }}
                    boxClass={style.box}
                    label={step.payload.targetLabel}
                  />
                )}
                <div className="flex items-center gap-1.5 px-3 pt-2">
                  <SeverityBadge severity={friction.payload.severity} />
                  <span className={`text-xs font-semibold ${style.text}`}>{categoryLabel(friction.payload.category)}</span>
                </div>
                {friction.payload.summary && <p className="px-3 pb-2 pt-1 text-xs text-slate-700">{friction.payload.summary}</p>}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 11: Create `apps/control-room/src/components/scan/SidePanel.tsx`**

```tsx
import type { ScanNode, ScanReportResponse, ScanTreeResponse } from "@friction/shared";
import { PersonaPanel } from "./PersonaPanel";
import { RootPanel } from "./RootPanel";
import { TaskPanel } from "./TaskPanel";

interface Props {
  tree: ScanTreeResponse;
  report: ScanReportResponse | null;
  node: ScanNode;
  onSelect: (nodeId: string) => void;
  onOpenRun: (runId: string) => void;
}

/** A node that does not exist (yet) falls back to the root. */
export function SidePanel({ tree, report, node, onSelect, onOpenRun }: Props) {
  const task = node.kind === "root" ? undefined : tree.tasks.find((t) => t.index === node.index);
  if (node.kind === "persona" && task) {
    return <PersonaPanel key={`${task.runId}:${node.personaId}`} task={task} personaId={node.personaId} onSelect={onSelect} />;
  }
  if (node.kind === "task" && task) return <TaskPanel task={task} report={report} onSelect={onSelect} onOpenRun={onOpenRun} />;
  return <RootPanel tree={tree} report={report} onSelect={onSelect} />;
}
```

- [ ] **Step 12: Typecheck**

Run: `pnpm --filter @friction/control-room typecheck`
Expected: exit 0. The new files are not rendered anywhere yet; Task 7 mounts them.

- [ ] **Step 13: Commit**

```bash
git add apps/control-room/src/lib/api.ts apps/control-room/src/lib/useQuery.ts apps/control-room/src/lib/scan.ts apps/control-room/src/hooks/useScan.ts apps/control-room/src/hooks/useScanReport.ts apps/control-room/src/components/badges.tsx apps/control-room/src/components/scan
git commit -F - <<'EOF'
feat(control-room): scan data hooks and side panels (site report, task, persona)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: Control room — node graph, scan page, routing

**Files:**
- Modify: `apps/control-room/package.json` (via `pnpm add`)
- Create: `apps/control-room/src/lib/scanLayout.ts`
- Create: `apps/control-room/src/components/scan/nodes.tsx`
- Create: `apps/control-room/src/components/scan/ScanGraph.tsx`
- Create: `apps/control-room/src/components/scan/ScanBar.tsx`
- Create: `apps/control-room/src/components/scan/ScanPage.tsx`
- Modify: `apps/control-room/src/App.tsx`

**Interfaces:**
- Consumes (Task 6): `useScan`, `useScanReport`, `SidePanel`, `SCAN_STATUS_CHIPS`, `runProgress`, `totalFindings`, `hostOf`, `personaShortName`, `Query.scan/node`. Also `StateBadge` with `idleLabel`.
- Produces:
  - `layoutScan(tree: ScanTreeResponse, options: { selected: string; issues: number | null; onSelect: (nodeId: string) => void }): { nodes: ScanFlowNode[]; edges: Edge[] }`
  - `ScanPage(props: { scanId: string; nodeId: string | null; onSelectNode: (nodeId: string) => void; onOpenRun: (runId: string) => void })`

- [ ] **Step 1: Add React Flow**

Run: `pnpm --filter @friction/control-room add @xyflow/react@^12.11.6`
Expected: `package.json` dependencies gain `"@xyflow/react": "^12.11.6"`, and `pnpm install` finishes without `ERR_PNPM_IGNORED_BUILDS`. `@xyflow/react` has no install scripts.

- [ ] **Step 2: Create `apps/control-room/src/lib/scanLayout.ts`**

```ts
/**
 * Scan tree -> React Flow nodes and edges. Pure. The shape is fixed (root ->
 * tasks -> three personas each), so positions are computed directly, left to
 * right, with no layout library.
 */
import type { Edge, Node } from "@xyflow/react";
import { scanNodeId, type PersonaId, type PersonaState, type ScanStatus, type ScanTreeResponse, type Severity, type TaskSource } from "@friction/shared";
import { hostOf, runProgress } from "./scan";

export const NODE_WIDTH = { root: 240, task: 280, persona: 260 } as const;
const COLUMN_X = { root: 0, task: 320, persona: 660 } as const;
/** Approximate rendered heights, used only for vertical centring. */
const ROOT_HEIGHT = 96;
const TASK_HEIGHT = 80;
const PERSONA_ROW = 48;
const BLOCK = PERSONA_ROW * 3;
const BLOCK_GAP = 24;

type Selectable = { selected: boolean; onSelect: (nodeId: string) => void };

export type RootNodeData = Selectable & {
  host: string;
  status: ScanStatus;
  message: string | null;
  pagesRead: number;
  taskSource: TaskSource | null;
  tasks: number;
  runsDone: number;
  runsTotal: number;
  issues: number | null;
};

export type TaskNodeData = Selectable & {
  index: number;
  title: string;
  /** PERSONAS order. */
  states: PersonaState[];
  findingCount: number;
  worst: Severity | null;
};

export type PersonaNodeData = Selectable & {
  personaId: PersonaId;
  state: PersonaState;
  stepCount: number;
  findingCount: number;
  worst: Severity | null;
};

export type RootFlowNode = Node<RootNodeData, "root">;
export type TaskFlowNode = Node<TaskNodeData, "task">;
export type PersonaFlowNode = Node<PersonaNodeData, "persona">;
export type ScanFlowNode = RootFlowNode | TaskFlowNode | PersonaFlowNode;

export interface LayoutOptions {
  /** Id of the selected node (see scanNodeId). */
  selected: string;
  /** Merged issue count from the report, when it has arrived. */
  issues: number | null;
  onSelect: (nodeId: string) => void;
}

export function layoutScan(tree: ScanTreeResponse, options: LayoutOptions): { nodes: ScanFlowNode[]; edges: Edge[] } {
  const { selected, onSelect } = options;
  const count = tree.tasks.length;
  const contentHeight = count > 0 ? count * (BLOCK + BLOCK_GAP) - BLOCK_GAP : ROOT_HEIGHT;
  const progress = runProgress(tree);

  const nodes: ScanFlowNode[] = [
    {
      id: "root",
      type: "root",
      position: { x: COLUMN_X.root, y: (contentHeight - ROOT_HEIGHT) / 2 },
      data: {
        host: hostOf(tree.scan.url),
        status: tree.scan.status,
        message: tree.scan.message,
        pagesRead: tree.scan.pages.length,
        taskSource: tree.scan.taskSource,
        tasks: count,
        runsDone: progress.done,
        runsTotal: progress.total,
        issues: options.issues,
        selected: selected === "root",
        onSelect,
      },
    },
  ];
  const edges: Edge[] = [];

  tree.tasks.forEach((task, position) => {
    const top = position * (BLOCK + BLOCK_GAP);
    const taskId = scanNodeId({ kind: "task", index: task.index });
    const worst = task.personas.reduce<Severity | null>((w, p) => (p.worstSeverity !== null && (w === null || p.worstSeverity > w) ? p.worstSeverity : w), null);
    nodes.push({
      id: taskId,
      type: "task",
      position: { x: COLUMN_X.task, y: top + (BLOCK - TASK_HEIGHT) / 2 },
      data: {
        index: task.index,
        title: task.title,
        states: task.personas.map((p) => p.state),
        findingCount: task.personas.reduce((sum, p) => sum + p.findingCount, 0),
        worst,
        selected: selected === taskId,
        onSelect,
      },
    });
    edges.push({ id: `root>${taskId}`, source: "root", target: taskId, type: "smoothstep", animated: task.personas.some((p) => p.state === "running") });

    task.personas.forEach((persona, row) => {
      const personaNodeId = scanNodeId({ kind: "persona", index: task.index, personaId: persona.personaId });
      nodes.push({
        id: personaNodeId,
        type: "persona",
        position: { x: COLUMN_X.persona, y: top + row * PERSONA_ROW },
        data: {
          personaId: persona.personaId,
          state: persona.state,
          stepCount: persona.stepCount,
          findingCount: persona.findingCount,
          worst: persona.worstSeverity,
          selected: selected === personaNodeId,
          onSelect,
        },
      });
      edges.push({ id: `${taskId}>${personaNodeId}`, source: taskId, target: personaNodeId, type: "smoothstep", animated: persona.state === "running" });
    });
  });

  return { nodes, edges };
}
```

- [ ] **Step 3: Create `apps/control-room/src/components/scan/nodes.tsx`**

```tsx
/**
 * The three node kinds on the scan canvas. Each is one button, so Tab reaches
 * every node and Enter selects it; React Flow's own selection is turned off.
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { PERSONA_IDS, type PersonaState } from "@friction/shared";
import { SCAN_STATUS_CHIPS, personaShortName } from "../../lib/scan";
import { NODE_WIDTH, type PersonaFlowNode, type RootFlowNode, type RootNodeData, type TaskFlowNode } from "../../lib/scanLayout";
import { Chip, SEVERITY_STYLES, StateBadge } from "../badges";

const HANDLE = "h-1.5! w-1.5! min-h-0! min-w-0! border-0! bg-slate-300!";

function frame(selected: boolean): string {
  return `rounded-lg bg-white text-left shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${selected ? "ring-2 ring-indigo-500" : ""}`;
}

function rootLine(data: RootNodeData): string {
  switch (data.status) {
    case "crawling":
      return `${data.message ?? "Reading the site"} · ${data.pagesRead} ${data.pagesRead === 1 ? "page" : "pages"} read`;
    case "running":
      return `${data.runsDone}/${data.runsTotal} runs done`;
    case "completed":
      return `${data.tasks} tasks · ${data.issues ?? "…"} issues`;
    default:
      return data.message ?? "The scan failed.";
  }
}

export function RootNode({ id, data }: NodeProps<RootFlowNode>) {
  const chip = SCAN_STATUS_CHIPS[data.status];
  return (
    <>
      <button type="button" onClick={() => data.onSelect(id)} className={`${frame(data.selected)} block border border-slate-300 px-3 py-2.5`} style={{ width: NODE_WIDTH.root }}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-bold text-slate-900">{data.host}</span>
          <Chip tone={chip.tone}>{chip.label}</Chip>
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">{rootLine(data)}</p>
        {data.taskSource === "fallback" && <p className="mt-1 text-[10px] font-medium text-amber-700">Generic tasks: the site could not be read</p>}
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} className={HANDLE} />
    </>
  );
}

const MARKS: Readonly<Record<PersonaState, { glyph: string; className: string; label: string }>> = {
  idle: { glyph: "·", className: "text-slate-400", label: "Queued" },
  running: { glyph: "…", className: "animate-pulse text-blue-600", label: "Running" },
  succeeded: { glyph: "✓", className: "text-emerald-600", label: "Succeeded" },
  failed: { glyph: "✗", className: "text-red-600", label: "Failed" },
  timeout: { glyph: "✗", className: "text-amber-600", label: "Timed out" },
};

export function TaskNode({ id, data }: NodeProps<TaskFlowNode>) {
  const border = data.worst ? `border-2 ${SEVERITY_STYLES[data.worst].box}` : "border border-slate-200";
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className={HANDLE} />
      <button type="button" onClick={() => data.onSelect(id)} className={`${frame(data.selected)} block ${border} px-3 py-2`} style={{ width: NODE_WIDTH.task }}>
        <div className="flex items-start gap-2">
          <span className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">T{data.index + 1}</span>
          <span className="line-clamp-2 min-w-0 text-xs font-semibold leading-snug text-slate-900">{data.title}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          <span className="flex gap-1.5 font-bold">
            {data.states.map((state, i) => {
              const mark = MARKS[state];
              const personaId = PERSONA_IDS[i];
              return (
                <span key={personaId ?? i} className={mark.className} title={personaId ? `${personaShortName(personaId)}: ${mark.label}` : mark.label}>
                  {mark.glyph}
                </span>
              );
            })}
          </span>
          <span className="ml-auto tabular-nums text-slate-500">
            {data.findingCount} {data.findingCount === 1 ? "finding" : "findings"}
          </span>
        </div>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} className={HANDLE} />
    </>
  );
}

export function PersonaNode({ id, data }: NodeProps<PersonaFlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className={HANDLE} />
      <button
        type="button"
        onClick={() => data.onSelect(id)}
        className={`${frame(data.selected)} flex items-center gap-2 border border-slate-200 px-2.5 py-1.5`}
        style={{ width: NODE_WIDTH.persona }}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{personaShortName(data.personaId)}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{data.stepCount} st</span>
        {data.worst !== null && data.findingCount > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-slate-600" title={`${data.findingCount} findings, worst S${data.worst}`}>
            <span className={`h-2 w-2 rounded-full ${SEVERITY_STYLES[data.worst].solid}`} />
            {data.findingCount}
          </span>
        )}
        <StateBadge state={data.state} idleLabel="Queued" />
      </button>
    </>
  );
}
```

- [ ] **Step 4: Create `apps/control-room/src/components/scan/ScanGraph.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { Background, Controls, ReactFlow, useReactFlow, type Edge, type FitViewOptions, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ScanFlowNode } from "../../lib/scanLayout";
import { PersonaNode, RootNode, TaskNode } from "./nodes";

const NODE_TYPES: NodeTypes = { root: RootNode, task: TaskNode, persona: PersonaNode };
const FIT: FitViewOptions = { padding: 0.12 };

/** Pan and zoom; nodes are fixed in place and selection is ours, not React Flow's. */
export function ScanGraph({ nodes, edges }: { nodes: ScanFlowNode[]; edges: Edge[] }) {
  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={FIT}
        minZoom={0.2}
        maxZoom={1.5}
      >
        <FitOnGrow count={nodes.length} />
        <Background gap={20} color="#e2e8f0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/** fitView only runs on mount; re-fit when the tasks arrive after the crawl. */
function FitOnGrow({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  const previous = useRef(count);
  useEffect(() => {
    if (count <= previous.current) return;
    previous.current = count;
    const timer = window.setTimeout(() => void fitView({ ...FIT, duration: 300 }), 60);
    return () => window.clearTimeout(timer);
  }, [count, fitView]);
  return null;
}
```

- [ ] **Step 5: Create `apps/control-room/src/components/scan/ScanBar.tsx`**

```tsx
import { useEffect, useState } from "react";
import { isScanFinished, type ScanTreeResponse } from "@friction/shared";
import { formatElapsed, shortUrl } from "../../lib/format";
import { SCAN_STATUS_CHIPS, runProgress } from "../../lib/scan";
import { Chip } from "../badges";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function ScanBar({ tree }: { tree: ScanTreeResponse }) {
  const { scan } = tree;
  const finished = isScanFinished(scan.status);
  const now = useNow(!finished);
  const chip = SCAN_STATUS_CHIPS[scan.status];
  const progress = runProgress(tree);
  const elapsed = (finished ? (scan.completedAt ?? now) : now) - scan.createdAt;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-white px-4 py-2">
      <Chip tone={chip.tone}>{chip.label}</Chip>
      <a href={scan.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-sm text-slate-700 hover:text-indigo-600 hover:underline" title={scan.url}>
        {shortUrl(scan.url)}
      </a>
      <span className="ml-auto text-xs tabular-nums text-slate-500">
        {progress.total > 0 ? `${progress.done}/${progress.total} runs done` : `${scan.pages.length} pages read`}
      </span>
      <span className="font-mono text-lg font-semibold tabular-nums leading-none text-slate-900" title="Elapsed">
        {formatElapsed(elapsed)}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Create `apps/control-room/src/components/scan/ScanPage.tsx`**

```tsx
import { useMemo } from "react";
import { parseScanNode, scanNodeId } from "@friction/shared";
import { useScan } from "../../hooks/useScan";
import { useScanReport } from "../../hooks/useScanReport";
import { totalFindings } from "../../lib/scan";
import { layoutScan } from "../../lib/scanLayout";
import { ScanBar } from "./ScanBar";
import { ScanGraph } from "./ScanGraph";
import { SidePanel } from "./SidePanel";

interface Props {
  scanId: string;
  nodeId: string | null;
  /** Must be stable (useCallback): it is baked into every node's data. */
  onSelectNode: (nodeId: string) => void;
  onOpenRun: (runId: string) => void;
}

export function ScanPage({ scanId, nodeId, onSelectNode, onOpenRun }: Props) {
  const { tree, stale, missing } = useScan(scanId);
  const refreshKey = tree ? `${totalFindings(tree)}:${tree.scan.status}:${tree.tasks.length}` : "none";
  const { report } = useScanReport(scanId, refreshKey);
  const node = parseScanNode(nodeId);
  const selected = scanNodeId(node);
  const issueCount = report ? report.issues.length : null;

  const graph = useMemo(
    () => (tree ? layoutScan(tree, { selected, issues: issueCount, onSelect: onSelectNode }) : null),
    [tree, selected, issueCount, onSelectNode],
  );

  if (missing) return <main className="flex flex-1 items-center justify-center text-sm text-slate-500">Scan {scanId} was not found.</main>;
  if (!tree || !graph) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-slate-400">
        {stale ? "The Worker is not answering. Retrying…" : "Loading the scan…"}
      </main>
    );
  }

  return (
    <>
      <ScanBar tree={tree} />
      {stale && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
          Lost contact with the Worker. Showing the last update; reconnecting…
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="h-105 min-w-0 shrink-0 bg-slate-50 lg:h-auto lg:flex-1">
          <ScanGraph nodes={graph.nodes} edges={graph.edges} />
        </div>
        <aside className="pane min-h-0 flex-1 overflow-y-auto border-t border-slate-200 bg-slate-50 lg:w-115 lg:flex-none lg:border-l lg:border-t-0">
          <SidePanel tree={tree} report={report} node={node} onSelect={onSelectNode} onOpenRun={onOpenRun} />
        </aside>
      </div>
    </>
  );
}
```

- [ ] **Step 7: Route to the scan page in `App.tsx`**

Four edits:

1. Add `import { ScanPage } from "./components/scan/ScanPage";`.
2. Replace `const stream = useRunStream(query.run, { replay: query.replay });` with:

   ```tsx
   // The single-run view only. A scan page opens its own stream for the selected persona node.
   const runId = query.scan ? null : query.run;
   const stream = useRunStream(runId, { replay: query.replay });
   ```

   In the `useReport(...)` call, change its first argument from `query.run` to `runId`.
3. After `onStarted`, add:

   ```tsx
   const selectNode = useCallback((node: string) => setQuery({ node }), [setQuery]);
   const openRun = useCallback((id: string, replay = false) => setQuery({ run: id, scan: null, node: null, replay, tab: "room" }), [setQuery]);
   ```

   In `onHome`, change the `setQuery` call to `setQuery({ run: null, scan: null, node: null, replay: false, tab: "room" })`.
4. Replace `{query.run ? (` with `{query.scan ? (<ScanPage scanId={query.scan} nodeId={query.node} onSelectNode={selectNode} onOpenRun={openRun} />) : query.run ? (`. The existing run branch and the `<Landing ... />` branch stay as they are.

- [ ] **Step 8: Typecheck and build**

Run: `pnpm --filter @friction/control-room typecheck`
Expected: exit 0.

Run: `pnpm build`
Expected: the Vite build succeeds. React Flow's CSS is bundled, and no remote asset URLs are emitted.

- [ ] **Step 9: Check the scan page in a browser**

Start the three apps. The orchestrator must be in mock mode, for example `FRICTION_MOCK=1 pnpm dev:orchestrator`. Run `pnpm --filter @friction/orchestrator smoke:scan` and open the `?scan=` URL it prints. Use the `run` skill or Chrome DevTools MCP.

Check:

1. The canvas shows the root, 10 task nodes and 30 persona nodes, with edges, fitted to the view.
2. The root panel shows verdict counts, persona success, severity counts and ranked issue cards reading "Hit in N/30 runs".
3. Clicking a task node shows the task panel; `?node=t3` appears in the URL.
4. Clicking a persona row or node shows the persona column (steps, friction, final screenshot) and its evidence; `?node=t3.keyboard` appears.
5. An issue's `T2 · Keyboard` chip selects that persona node.
6. "Open full control room →" opens `?run=r_...`, and Back returns to the scan.
7. Tab moves across nodes and Enter selects them.
8. At a width under 1024px the panel stacks under the canvas, with no horizontal page scroll.

Next, start a fresh scan (`smoke:scan` again) and open its URL immediately. Check that the root node shows crawl progress alone, then the tree appears, re-fits, and persona nodes go from Queued to Running (edges animate) to finished.

- [ ] **Step 10: Commit**

```bash
git add apps/control-room/package.json pnpm-lock.yaml apps/control-room/src/lib/scanLayout.ts apps/control-room/src/components/scan apps/control-room/src/App.tsx
git commit -F - <<'EOF'
feat(control-room): scan page with a React Flow node tree and side panel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: Control room — one-button home page, slim header

**Files:**
- Modify: `apps/control-room/src/components/Header.tsx` (rewrite)
- Modify: `apps/control-room/src/components/Landing.tsx` (rewrite)
- Modify: `apps/control-room/src/App.tsx` (final form below)
- Modify: `apps/control-room/src/lib/api.ts` (remove calls nothing uses)

**Interfaces:**
- Consumes: `api.startScan`, `api.listScans`, `api.orchestratorHealth`, `normalizeTargetUrl`, `GOLDEN_RUN_ID`, `SCAN_STATUS_CHIPS`, `shortUrl`, `timeAgo`, `ScanPage`.
- Produces: `Header({ onHome })`, `Landing({ onOpenScan, onOpenRun })`.

- [ ] **Step 1: Replace `apps/control-room/src/components/Header.tsx`**

```tsx
interface Props {
  onHome: () => void;
}

/** Just the mark: the home page is where scans start. */
export function Header({ onHome }: Props) {
  return (
    <header className="shrink-0 border-b border-slate-200 bg-white">
      <div className="flex items-center px-4 py-2">
        <button type="button" onClick={onHome} className="flex items-center gap-2" title="Home">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-sm font-black text-white">F</span>
          <span className="text-sm font-bold tracking-tight text-slate-900">Friction</span>
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Replace `apps/control-room/src/components/Landing.tsx`**

```tsx
import { useEffect, useState } from "react";
import { GOLDEN_RUN_ID, normalizeTargetUrl, type OrchestratorHealth, type ScanListItem } from "@friction/shared";
import { api } from "../lib/api";
import { shortUrl, timeAgo } from "../lib/format";
import { SCAN_STATUS_CHIPS } from "../lib/scan";
import { Chip } from "./badges";

interface Props {
  onOpenScan: (scanId: string) => void;
  onOpenRun: (runId: string, replay: boolean) => void;
}

type Probe<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "down" };

const STORAGE_KEY = "friction:last-scan-url";

function loadUrl(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function Landing({ onOpenScan, onOpenRun }: Props) {
  const [url, setUrl] = useState(loadUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scans, setScans] = useState<Probe<ScanListItem[]>>({ status: "loading" });
  const [health, setHealth] = useState<Probe<OrchestratorHealth>>({ status: "loading" });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, url);
    } catch {
      /* private mode: not worth failing over */
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    api
      .listScans()
      .then((body) => !cancelled && setScans({ status: "ok", value: body.scans }))
      .catch(() => !cancelled && setScans({ status: "down" }));
    api
      .orchestratorHealth()
      .then((body) => !cancelled && setHealth({ status: "ok", value: body }))
      .catch(() => !cancelled && setHealth({ status: "down" }));
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const target = normalizeTargetUrl(url);
    if (!target) {
      setError("Enter a valid website URL, e.g. https://your-store.com");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { scanId } = await api.startScan(target);
      onOpenScan(scanId);
    } catch (err) {
      setError(`Could not start the scan (${err instanceof Error ? err.message : "unknown error"}). Is the orchestrator running?`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pane flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-12 pt-14 sm:px-6">
        <h1 className="text-center text-3xl font-bold tracking-tight text-slate-900">Point it at a site. Get its 10 most critical flows tested.</h1>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-slate-600">
          Friction reads your site, picks the ten tasks that matter most, and has three different people attempt each one in real browsers: an impatient power
          user, a cautious first-timer and a keyboard-only user. Thirty runs, one ranked report.
        </p>

        <form onSubmit={(event) => void submit(event)} className="mt-8 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            inputMode="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            placeholder="https://your-store.com"
            aria-label="Website URL"
            spellCheck={false}
            autoFocus
            className="h-14 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 font-mono text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-14 shrink-0 rounded-xl bg-indigo-600 px-8 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-wait disabled:bg-indigo-400"
          >
            {busy ? "Starting…" : "Scan & test"}
          </button>
        </form>
        {error && (
          <p className="mt-2 text-sm text-red-600">
            {error}{" "}
            <button type="button" onClick={() => onOpenRun(GOLDEN_RUN_ID, true)} className="font-medium underline">
              Replay the golden run instead
            </button>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-500">
          <Status label="Worker" state={scans.status === "loading" ? "loading" : scans.status === "ok" ? "up" : "down"} />
          <Status
            label={health.status === "ok" ? `Orchestrator (${health.value.mode})` : "Orchestrator"}
            state={health.status === "loading" ? "loading" : health.status === "ok" ? "up" : "down"}
            title={health.status === "ok" && health.value.missingEnv.length > 0 ? `Mock mode. Missing: ${health.value.missingEnv.join(", ")}` : undefined}
          />
          <button type="button" onClick={() => onOpenRun(GOLDEN_RUN_ID, true)} className="font-medium text-slate-600 underline hover:text-slate-900">
            Replay the golden run
          </button>
        </div>

        <section className="mt-10">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Recent scans</h2>
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            {scans.status === "loading" && <p className="px-3 py-3 text-xs text-slate-400">Loading…</p>}
            {scans.status === "down" && <p className="px-3 py-3 text-xs text-slate-500">The Worker is not answering, so past scans are unavailable.</p>}
            {scans.status === "ok" && scans.value.length === 0 && <p className="px-3 py-3 text-xs text-slate-400">No scans yet. Start one above.</p>}
            {scans.status === "ok" &&
              scans.value.map((scan) => {
                const chip = SCAN_STATUS_CHIPS[scan.status];
                return (
                  <button
                    key={scan.id}
                    type="button"
                    onClick={() => onOpenScan(scan.id)}
                    className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                  >
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-800">{shortUrl(scan.url)}</span>
                    {scan.tasksTotal > 0 && (
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                        {scan.tasksPassed}/{scan.tasksTotal} tasks passed
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(scan.createdAt)}</span>
                  </button>
                );
              })}
          </div>
        </section>
      </div>
    </main>
  );
}

function Status({ label, state, title }: { label: string; state: "loading" | "up" | "down"; title?: string }) {
  const colour = state === "up" ? "bg-emerald-500" : state === "down" ? "bg-red-500" : "bg-slate-300 animate-pulse";
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <span className={`h-2 w-2 rounded-full ${colour}`} />
      {label}
    </span>
  );
}
```

- [ ] **Step 3: Replace `apps/control-room/src/App.tsx` with its final form**

```tsx
import { useCallback, useMemo } from "react";
import { PERSONA_IDS, type PersonaId, type StepPayload } from "@friction/shared";
import { Header } from "./components/Header";
import { Landing } from "./components/Landing";
import { PersonaColumn } from "./components/PersonaColumn";
import { ReportView } from "./components/ReportView";
import { RunBar } from "./components/RunBar";
import { ScanPage } from "./components/scan/ScanPage";
import { useReport } from "./hooks/useReport";
import { useRunStream } from "./hooks/useRunStream";
import { snapshotFromView, summarize } from "./lib/runState";
import { useQuery } from "./lib/useQuery";

export default function App() {
  const [query, setQuery] = useQuery();

  // The single-run view only. A scan page opens its own stream for the selected persona node.
  const runId = query.scan ? null : query.run;
  const stream = useRunStream(runId, { replay: query.replay });
  const { view } = stream;
  const summary = summarize(view);

  // Whatever is on screen, as a snapshot: lets the report be built with no Worker.
  const localSnapshot = useMemo(() => stream.snapshot ?? snapshotFromView(view), [stream.snapshot, view]);
  const report = useReport(runId, query.tab === "report", localSnapshot, {
    localOnly: stream.origin === "bundled",
    refreshKey: summary.frictionCount + (summary.phase === "complete" ? 1000 : 0),
  });

  const findStep = useCallback(
    (personaId: PersonaId, seq: number): StepPayload | undefined => {
      const live = view.personas[personaId].steps.find((step) => step.seq === seq);
      if (live) return live.payload;
      const recorded = stream.snapshot?.events.find((e) => e.type === "step" && e.personaId === personaId && e.seq === seq);
      return recorded?.type === "step" ? recorded.payload : undefined;
    },
    [view, stream.snapshot],
  );

  const goHome = useCallback(() => setQuery({ run: null, scan: null, node: null, replay: false, tab: "room" }), [setQuery]);
  const openScan = useCallback((scanId: string) => setQuery({ scan: scanId, node: null, run: null, replay: false, tab: "room" }), [setQuery]);
  const openRun = useCallback((id: string, replay = false) => setQuery({ run: id, scan: null, node: null, replay, tab: "room" }), [setQuery]);
  const selectNode = useCallback((node: string) => setQuery({ node }), [setQuery]);

  return (
    <div className="flex h-full flex-col">
      <Header onHome={goHome} />

      {query.scan ? (
        <ScanPage scanId={query.scan} nodeId={query.node} onSelectNode={selectNode} onOpenRun={openRun} />
      ) : query.run ? (
        <>
          <RunBar
            view={view}
            origin={stream.origin}
            connection={stream.connection}
            elapsedMs={stream.elapsedMs}
            replay={stream.replay}
            tab={query.tab}
            onTab={(tab) => setQuery({ tab })}
            isReplay={query.replay}
            onToggleReplay={() => setQuery({ replay: !query.replay })}
          />

          {stream.notice && (
            <div className="flex shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
              <span className="font-semibold">Heads up:</span>
              <span className="min-w-0 flex-1">{stream.notice}</span>
            </div>
          )}

          {query.tab === "report" ? (
            <ReportView report={report.report} loading={report.loading} local={report.local} findStep={findStep} />
          ) : (
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-3 lg:overflow-hidden">
              {PERSONA_IDS.map((id) => (
                <PersonaColumn key={id} persona={view.personas[id]} allowLiveView={stream.origin === "live"} startTs={view.firstTs} />
              ))}
            </main>
          )}
        </>
      ) : (
        <Landing onOpenScan={openScan} onOpenRun={openRun} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Remove the calls nothing uses from `api.ts`**

Delete `startRun`, `createRunOnWorker` and `suggestTasks` from `api`. Delete `CreateRunRequest`, `CreateRunResponse` and `SuggestTasksResponse` from its type import. The orchestrator's `POST /runs` and `POST /suggest-tasks` stay: they are API surface for `smoke-local.ts` and scripts.

Run: `pnpm --filter @friction/control-room typecheck`
Expected: exit 0. If something still references a removed call, the error names it; the only callers were in the old `Header.tsx`, which is gone.

- [ ] **Step 5: Check the home page in a browser**

With the three apps running (orchestrator in mock mode), open http://localhost:5173 and check:

1. The page shows a large URL field and one **Scan & test** button. The header shows only the logo.
2. An invalid URL gives an inline error.
3. `shop.example` starts a scan and lands on `?scan=s_...`.
4. The recent-scans list shows earlier scans with "N/10 tasks passed", and clicking one opens it.
5. With the orchestrator stopped, **Scan & test** shows the error plus the "Replay the golden run instead" link, and that link plays the golden run.
6. The old `?run=<id>` links still open the 3-column control room.
7. At 375px width the form stacks and nothing scrolls sideways.

- [ ] **Step 6: Commit**

```bash
git add apps/control-room/src/components/Header.tsx apps/control-room/src/components/Landing.tsx apps/control-room/src/App.tsx apps/control-room/src/lib/api.ts
git commit -F - <<'EOF'
feat(control-room): one-button home page; the scan replaces URL + task

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: Docs and full verification

**Files:**
- Modify: `README.md` (intro, architecture list)
- Modify: `SETUP.md` (env table, "You want to..." table, migrations note, concurrency note, new cost section)
- Modify: `.env.example` (concurrency)

- [ ] **Step 1: Update `README.md`**

Replace the first paragraph after `# Friction` with:

```markdown
Give it a URL. Friction reads the site, picks the 10 most critical tasks to QA, and has three AI personas attempt each one at the same time, each in its own isolated Browserbase browser, on the live site: 30 runs. Friction is detected as it happens, shown as a live node tree (site → tasks → persona runs), and merged into one site-wide report that ranks each issue by severity and by how many runs hit it, with screenshot evidence. Built for Hack the North 2026.
```

In `## Architecture`, insert this before item `1.`:

```markdown
**Scans.** `POST /scans {url}` on the orchestrator creates a scan on the Worker and returns its id at once. One browser session reads the landing page and up to five same-origin navigation pages (`crawl.ts`); one Structured Outputs call turns that into up to 10 ranked tasks, each with a success check (`taskGen.ts`); each task becomes an ordinary run, below. All 30 personas queue for one process-wide pool of `MAX_SESSIONS` browser sessions, most critical task first. The control room polls `GET /api/scans/:id` (a compact tree) every 2s, streams only the persona node you select, and shows `GET /api/scans/:id/report`, where findings from every run are merged by category + page + element (`packages/shared/src/scanReport.ts`). If the site cannot be read or the model fails, the scan runs 10 generic tasks and says so. In mock mode the crawl is scripted and every run replays the golden run.

Each run works as follows:
```

- [ ] **Step 2: Update `SETUP.md`**

1. **"You want to..." table.** Replace the rows "Exercise the whole pipeline with no keys" and "Do a real run" with:

   ```markdown
   | Exercise the whole pipeline with no keys | Start all three apps, enter any URL, **Scan & test** (mock mode), or run `pnpm --filter @friction/orchestrator smoke:scan` |
   | Do a real scan | Fill in `.env` (below), restart the orchestrator, **Scan & test** |
   ```

2. **Env table.** Replace the `PERSONA_CONCURRENCY` row with:

   ```markdown
   | `MAX_SESSIONS` | | `3` | Browser sessions open at once across every run and scan (1-100). Set it to your Browserbase plan's concurrency limit. `PERSONA_CONCURRENCY` is still read as a fallback |
   ```

3. **D1 migrations.** Replace `it runs \`migrations/0001_init.sql\` itself` with `it runs any of \`migrations/*.sql\` it is missing itself`.

4. **Things that bite.** Replace the "Browserbase concurrency" bullet with:

   ```markdown
   - **Browserbase concurrency.** A scan opens one session to crawl, then 30 persona sessions, never more than `MAX_SESSIONS` at once; the rest wait as "Queued". A 429 on session create is retried, but set `MAX_SESSIONS` to your plan's limit. "Suggest tasks" opens a session outside the pool.
   ```

5. **New section.** Add this before `## Deploy the Worker`:

   ```markdown
   ## Scans: time and cost

   A live scan is up to 30 persona runs of up to 15 steps. That is roughly 450+ planner calls with a screenshot each, plus judge calls for each finding, plus one task-generation call. At `MAX_SESSIONS=3` expect 20-50 minutes per scan; raise it to your Browserbase plan's concurrency limit. Point it at `/demo-shop` first.
   ```

- [ ] **Step 3: Update `.env.example`**

Replace these two lines:

```
# Personas running at once (1-3, default 3). Lower it if your Browserbase plan caps concurrent sessions.
# PERSONA_CONCURRENCY=3
```

with:

```
# Browser sessions open at once across every run and scan (1-100, default 3).
# Set it to your Browserbase plan's concurrency limit. (PERSONA_CONCURRENCY still works as a fallback.)
# MAX_SESSIONS=3
```

- [ ] **Step 4: Run every check**

| Command | Expected |
| --- | --- |
| `pnpm typecheck` | exit 0, all four packages |
| `pnpm test` | all tests pass (detector tests plus `scan.test.ts` and `scanReport.test.ts`) |
| `pnpm build` | success |
| `pnpm --filter @friction/orchestrator smoke:scan`, with the Worker and a mock-mode orchestrator running | ends with `OK  open http://localhost:5173/?scan=...` |
| `pnpm --filter @friction/orchestrator smoke` | still passes; the single-run real-browser loop is unchanged. It needs a local Chrome or Edge. If none is installed, say so rather than skipping silently |

- [ ] **Step 5: Repeat the browser pass from Tasks 7 and 8 on the final build**

Do it once more against `pnpm dev:control-room`, and note anything that differs. Say plainly that the live crawl and the task-generation model call were **not** exercised, because they need `OPENAI_API_KEY`, `OPENAI_MODEL` and Browserbase keys.

- [ ] **Step 6: Commit**

```bash
git add README.md SETUP.md .env.example
git commit -F - <<'EOF'
docs: scans, MAX_SESSIONS, time and cost

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```
