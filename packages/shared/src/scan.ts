/**
 * Scans: one URL -> a crawl -> up to ten generated tasks -> one ordinary run
 * per task (the one agent, then its fix verifications). The contracts the orchestrator,
 * the Worker and the control room share, and the pure helpers they agree on.
 *
 * Imports from ./api are type-only: api.ts imports ScanTaskLinkSchema from
 * here at runtime, and a runtime import back would be a cycle.
 */
import { z } from "zod";
import type { ReportEvidence, RunStatus } from "./api";
import type { AgentState, FrictionCategory, Severity } from "./events";

/* ------------------------------------------------------------------ enums */

export const SCAN_STATUSES = ["crawling", "running", "completed", "failed"] as const;
export const ScanStatusSchema = z.enum(SCAN_STATUSES);
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/** "model" = generated from the crawl; "fallback" = generic, the site could not be read; "mock" = no keys. */
export const TASK_SOURCES = ["model", "fallback", "mock"] as const;
export const TaskSourceSchema = z.enum(TASK_SOURCES);
export type TaskSource = (typeof TASK_SOURCES)[number];

/**
 * Most tasks one scan runs, one run each. Matched to MAX_SESSIONS so a scan's
 * tasks all get a browser at once instead of queueing behind each other.
 */
export const MAX_SCAN_TASKS = 5;
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

export interface ScanTreeTask {
  /** 0-based rank, 0 = most critical. */
  index: number;
  runId: string;
  title: string;
  whyCritical: string;
  successCheck: string;
  /** The run's lifecycle: "verifying" once the agent is done and fixes are being checked. */
  status: RunStatus;
  /** The agent's state in the primary lane. */
  state: AgentState;
  stepCount: number;
  findingCount: number;
  worstSeverity: Severity | null;
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

export type TaskVerdict = "pass" | "fail" | "pending";

/** pass = the agent completed the task, fail = it failed or ran out of time, pending = still going. */
export function taskVerdict(state: AgentState): TaskVerdict {
  if (state === "succeeded") return "pass";
  return state === "failed" || state === "timeout" ? "fail" : "pending";
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

/** A node on the scan canvas. Ids: "root", "t<index>". */
export type ScanNode = { kind: "root" } | { kind: "task"; index: number };

const ROOT: ScanNode = { kind: "root" };

/**
 * Anything unrecognised is the root. Whether the index exists is the caller's
 * business. Links from when a task had persona children ("t2.cautious") open
 * that task.
 */
export function parseScanNode(id: string | null | undefined): ScanNode {
  const match = /^t(\d{1,2})(?:\.[a-z]+)?$/.exec(id ?? "");
  return match ? { kind: "task", index: Number(match[1]) } : ROOT;
}

export function scanNodeId(node: ScanNode): string {
  return node.kind === "root" ? "root" : `t${node.index}`;
}

/* ------------------------------------------------------------------ report */

export interface ScanIssueOccurrence {
  runId: string;
  taskIndex: number;
  findingId: string;
  evidenceSeq: number;
  severity: Severity;
  /** Times the agent hit it in that run. */
  hitCount: number;
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
  /** Distinct runs (one per task) that hit this. */
  runsHit: number;
  totalRuns: number;
  /** Ascending. */
  taskIndexes: number[];
  /** Task, then seq. */
  occurrences: ScanIssueOccurrence[];
  evidence: ReportEvidence | null;
}

export interface ScanReportSummary {
  verdicts: Record<TaskVerdict, number>;
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
