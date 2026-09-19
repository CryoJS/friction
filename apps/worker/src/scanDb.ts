/**
 * Scan SQL. Same rules as db.ts: rows are snake_case, everything that leaves
 * this module is the camelCase contract from @friction/shared.
 */
import {
  TaskPullRequestSchema,
  type AgentState,
  type CrawledPage,
  type FrictionCategory,
  type RunScanLink,
  type RunStatus,
  type ScanFindingInput,
  type ScanListItem,
  type ScanPatch,
  type ScanRecord,
  type ScanStatus,
  type ScanTreeResponse,
  type ScanTreeTask,
  type Severity,
  type StepEvent,
  type TaskPullRequest,
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
  repo: string | null;
  auto_pr: number | null;
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
  status: string;
  state: string;
}

interface PullRequestRow {
  body_json: string;
}

interface StepCountRow {
  run_id: string;
  n: number;
}

interface FindingCountRow {
  run_id: string;
  n: number;
  worst: number;
}

interface ScanFindingRow {
  id: string;
  run_id: string;
  finding_key: string;
  category: string;
  severity: number;
  evidence_seq: number;
  recommendation: string;
  confidence: number;
  summary: string | null;
  why_it_matters: string | null;
  selector: string;
  hit_count: number;
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
    repo: row.repo ?? null,
    autoPr: row.auto_pr === 1,
  };
}

export async function createScan(db: D1Database, url: string, options: { repo?: string; autoPr?: boolean } = {}): Promise<ScanRecord> {
  const scan: ScanRecord = {
    id: newId("s_"),
    url,
    status: "crawling",
    message: "Opening the site.",
    pages: [],
    taskSource: null,
    createdAt: Date.now(),
    completedAt: null,
    repo: options.repo ?? null,
    // Without a repository there is nothing to open a pull request against.
    autoPr: options.repo !== undefined && options.autoPr === true,
  };
  await db
    .prepare("INSERT INTO scans (id, url, status, message, pages, created_at, repo, auto_pr) VALUES (?, ?, ?, ?, '[]', ?, ?, ?)")
    .bind(scan.id, scan.url, scan.status, scan.message, scan.createdAt, scan.repo ?? null, scan.autoPr ? 1 : 0)
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

/** Newest first, with how many tasks the agent completed. */
export async function listScans(db: D1Database, limit: number): Promise<ScanListItem[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM scan_tasks t WHERE t.scan_id = s.id) AS tasks_total,
         (SELECT COUNT(*) FROM scan_tasks t JOIN runs r ON r.id = t.run_id
            WHERE t.scan_id = s.id AND r.state = 'succeeded') AS tasks_passed
       FROM scans s
       ORDER BY s.created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<ScanListRow>();
  return results.map((row) => ({ ...toScan(row), tasksTotal: row.tasks_total, tasksPassed: row.tasks_passed }));
}

/**
 * Tasks in rank order, each with its run's live state, and each task's pull
 * request once it has one. Four queries, one round trip. Steps are counted from the primary lane's events: the run row
 * only learns its step total when the agent finishes.
 */
export async function getScanTree(db: D1Database, scan: ScanRecord): Promise<ScanTreeResponse> {
  const [tasks, steps, counts, prs] = await db.batch<TaskRow | StepCountRow | FindingCountRow | PullRequestRow>([
    db
      .prepare(
        `SELECT t.task_index, t.run_id, r.task, t.why_critical, t.success_check, r.status, r.state
         FROM scan_tasks t JOIN runs r ON r.id = t.run_id
         WHERE t.scan_id = ?
         ORDER BY t.task_index ASC`,
      )
      .bind(scan.id),
    db
      .prepare(
        `SELECT e.run_id, COUNT(*) AS n
         FROM events e JOIN scan_tasks t ON t.run_id = e.run_id
         WHERE t.scan_id = ? AND e.lane = 'primary' AND e.type = 'step'
         GROUP BY e.run_id`,
      )
      .bind(scan.id),
    db
      .prepare(
        `SELECT f.run_id, COUNT(*) AS n, MAX(f.severity) AS worst
         FROM findings f JOIN scan_tasks t ON t.run_id = f.run_id
         WHERE t.scan_id = ?
         GROUP BY f.run_id`,
      )
      .bind(scan.id),
    db.prepare("SELECT body_json FROM task_pull_requests WHERE scan_id = ? ORDER BY task_index ASC").bind(scan.id),
  ]);

  const stepsOf = new Map<string, number>();
  for (const row of (steps?.results ?? []) as StepCountRow[]) stepsOf.set(row.run_id, row.n);
  const countOf = new Map<string, FindingCountRow>();
  for (const row of (counts?.results ?? []) as FindingCountRow[]) countOf.set(row.run_id, row);

  const treeTasks: ScanTreeTask[] = ((tasks?.results ?? []) as TaskRow[]).map((row) => {
    const count = countOf.get(row.run_id);
    return {
      index: row.task_index,
      runId: row.run_id,
      title: row.task,
      whyCritical: row.why_critical,
      successCheck: row.success_check,
      status: row.status as RunStatus,
      state: row.state as AgentState,
      stepCount: stepsOf.get(row.run_id) ?? 0,
      findingCount: count?.n ?? 0,
      worstSeverity: count ? (count.worst as Severity) : null,
    };
  });
  return { scan, tasks: treeTasks, pullRequests: ((prs?.results ?? []) as PullRequestRow[]).flatMap(toPullRequest) };
}

/** The scan a run belongs to, with the repository that scan was started with. */
export async function getRunScanLink(db: D1Database, runId: string): Promise<RunScanLink | null> {
  const row = await db
    .prepare("SELECT t.scan_id, t.task_index, s.repo FROM scan_tasks t JOIN scans s ON s.id = t.scan_id WHERE t.run_id = ?")
    .bind(runId)
    .first<{ scan_id: string; task_index: number; repo: string | null }>();
  return row ? { scanId: row.scan_id, taskIndex: row.task_index, repo: row.repo ?? null } : null;
}

/** A row that no longer parses costs that task's chip, not the tree. */
function toPullRequest(row: PullRequestRow): TaskPullRequest[] {
  try {
    const parsed = TaskPullRequestSchema.safeParse(JSON.parse(row.body_json));
    return parsed.success ? [parsed.data] : [];
  } catch {
    return [];
  }
}

/**
 * One row per (scan, run): replaying an upsert changes nothing, a later one
 * replaces the whole record. Null when the run is not a task of the scan.
 */
export async function upsertTaskPullRequest(db: D1Database, pr: TaskPullRequest): Promise<TaskPullRequest | null> {
  const task = await db.prepare("SELECT task_index FROM scan_tasks WHERE scan_id = ? AND run_id = ?").bind(pr.scanId, pr.runId).first<{ task_index: number }>();
  if (!task) return null;
  // The scan's own task index wins over the caller's.
  const stored: TaskPullRequest = { ...pr, taskIndex: task.task_index };
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO task_pull_requests (scan_id, run_id, task_index, status, pr_url, body_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT (scan_id, run_id) DO UPDATE SET
         task_index = excluded.task_index, status = excluded.status, pr_url = excluded.pr_url,
         body_json = excluded.body_json, updated_at = excluded.updated_at`,
    )
    .bind(stored.scanId, stored.runId, stored.taskIndex, stored.status, stored.prUrl ?? null, JSON.stringify(stored), now)
    .run();
  return stored;
}

export interface ScanFindingRows {
  findings: ScanFindingInput[];
  evidence: StepEvent[];
}

/** Every finding of the scan's runs (findings are primary-lane only), each joined to its evidence step. One query. */
export async function getScanFindingRows(db: D1Database, scanId: string): Promise<ScanFindingRows> {
  const { results } = await db
    .prepare(
      `SELECT f.id, f.run_id, f.finding_key, f.category, f.severity, f.evidence_seq, f.recommendation,
              f.confidence, f.summary, f.why_it_matters, f.selector, f.hit_count,
              e.seq AS e_seq, e.ts AS e_ts, e.payload AS e_payload
       FROM findings f
       JOIN scan_tasks t ON t.run_id = f.run_id
       LEFT JOIN events e
         ON e.run_id = f.run_id AND e.lane = 'primary'
        AND e.seq = f.evidence_seq AND e.type = 'step'
       WHERE t.scan_id = ?`,
    )
    .bind(scanId)
    .all<ScanFindingRow>();

  const findings: ScanFindingInput[] = [];
  const evidence: StepEvent[] = [];
  for (const row of results) {
    findings.push({
      id: row.id,
      findingKey: row.finding_key,
      runId: row.run_id,
      category: row.category as FrictionCategory,
      severity: row.severity as Severity,
      evidenceSeq: row.evidence_seq,
      recommendation: row.recommendation,
      confidence: row.confidence,
      summary: row.summary,
      whyItMatters: row.why_it_matters,
      hitCount: row.hit_count,
      selector: row.selector,
    });
    if (row.e_seq !== null && row.e_ts !== null && row.e_payload !== null) {
      const step = toEvent({ run_id: row.run_id, lane: "primary", seq: row.e_seq, ts: row.e_ts, type: "step", payload: row.e_payload, fix_id: null });
      if (step?.type === "step") evidence.push(step);
    }
  }
  return { findings, evidence };
}
