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
