/**
 * D1 access. SQL lives here and nowhere else. Rows are snake_case, everything
 * that leaves this module is the camelCase contract from @friction/shared.
 */
import {
  normalizeHost,
  stateForOutcome,
  type AgentState,
  type FindingInput,
  type FixEvent,
  type FixPayload,
  type FixRecord,
  type FixStage,
  type FixUpsert,
  type LaneResult,
  type FrictionCategory,
  type Lane,
  type Outcome,
  type RunEvent,
  type RunPatch,
  type RunRecord,
  type RunStatus,
  type Severity,
  type ScanTaskLink,
} from "@friction/shared";
import initSql from "../migrations/0001_init.sql";
import lanesSql from "../migrations/0002_lanes.sql";
import fixesSql from "../migrations/0003_fixes.sql";
import scansSql from "../migrations/0004_scans.sql";
import taskPullRequestsSql from "../migrations/0005_task_pull_requests.sql";
import scanHostSql from "../migrations/0006_scan_host.sql";

/* ------------------------------------------------------------------ schema */

interface Migration {
  name: string;
  sql: string;
  /** True when the database already has this migration's effect. */
  applied: (db: D1Database) => Promise<boolean>;
}

const tableSql = (db: D1Database, table: string) =>
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first<{ sql: string }>();

/** Same names wrangler records, so either path can run first without the other repeating it. */
const MIGRATIONS: Migration[] = [
  { name: "0001_init.sql", sql: initSql, applied: async (db) => (await tableSql(db, "findings")) !== null },
  { name: "0002_lanes.sql", sql: lanesSql, applied: async (db) => /\blane\b/.test((await tableSql(db, "events"))?.sql ?? "") },
  { name: "0003_fixes.sql", sql: fixesSql, applied: async (db) => (await tableSql(db, "fixes")) !== null },
  { name: "0004_scans.sql", sql: scansSql, applied: async (db) => (await tableSql(db, "scans")) !== null },
  { name: "0005_task_pull_requests.sql", sql: taskPullRequestsSql, applied: async (db) => (await tableSql(db, "task_pull_requests")) !== null },
  {
    name: "0006_scan_host.sql",
    sql: scanHostSql,
    // ALTER TABLE is not idempotent, so ask the column list, not the table list.
    applied: async (db) => {
      const ddl = await tableSql(db, "scans");
      return ddl !== null && /\bhost\b/.test(ddl.sql);
    },
  },
];
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

let schemaChecked = false;

/**
 * Brings a database that skipped `wrangler d1 migrations apply` up to date.
 * That remains the documented path; this is the safety net for the teammate
 * (or the demo laptop) that skipped it. Each migration runs only if its effect
 * is missing, and is recorded in d1_migrations so wrangler will not repeat it.
 * A plain flag rather than a shared promise: promises must not be awaited
 * across Worker requests.
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaChecked) return;
  for (const migration of MIGRATIONS) {
    if (await migration.applied(db)) continue;
    const statements = statementsOf(migration.sql);
    await db.batch([
      ...statements.map((statement) => db.prepare(statement)),
      db.prepare(
        "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
      ),
      db.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)").bind(migration.name),
    ]);
    console.log(`[db] applied ${migration.name} (${statements.length} statements)`);
  }

  // One-off: rows written before 0006 have a null host, and only JS can parse a URL.
  const stale = await db.prepare("SELECT id, url FROM scans WHERE host IS NULL LIMIT 500").all<{ id: string; url: string }>();
  if (stale.results.length > 0) {
    await db.batch(stale.results.map((row) => db.prepare("UPDATE scans SET host = ? WHERE id = ?").bind(normalizeHost(row.url), row.id)));
  }

  schemaChecked = true;
}

/* -------------------------------------------------------------------- rows */

interface RunRow {
  id: string;
  url: string;
  task: string;
  status: string;
  created_at: number;
  completed_at: number | null;
  state: string;
  outcome: string | null;
  total_steps: number | null;
  duration_ms: number | null;
  live_view_url: string | null;
  session_id: string | null;
  replay_url: string | null;
}

interface EventRow {
  id: number;
  run_id: string;
  lane: string;
  seq: number;
  ts: number;
  type: string;
  payload: string;
  fix_id?: string | null;
}

function toRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    url: row.url,
    task: row.task,
    status: row.status as RunStatus,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    state: row.state as AgentState,
    outcome: row.outcome as Outcome | null,
    totalSteps: row.total_steps,
    durationMs: row.duration_ms,
    liveViewUrl: row.live_view_url,
    sessionId: row.session_id,
    replayUrl: row.replay_url,
  };
}

/** Rows were validated on the way in, so reading them back is a plain cast. */
export function toEvent(row: Pick<EventRow, "run_id" | "lane" | "seq" | "ts" | "type" | "payload" | "fix_id">): RunEvent | null {
  try {
    return {
      runId: row.run_id,
      lane: row.lane,
      seq: row.seq,
      ts: row.ts,
      ...(row.fix_id ? { fixId: row.fix_id } : {}),
      type: row.type,
      payload: JSON.parse(row.payload),
    } as RunEvent;
  } catch {
    return null;
  }
}

export interface StoredEvent {
  rowId: number;
  event: RunEvent;
}

/* -------------------------------------------------------------------- runs */

/** "r_" + 10 random [a-z0-9]. Prefix: "r_" runs, "s_" scans. */
export function newId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let id = prefix;
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return id;
}

export async function createRun(db: D1Database, input: { url: string; task: string; scan?: ScanTaskLink }): Promise<RunRecord> {
  const run: RunRecord = {
    id: newId("r_"),
    url: input.url,
    task: input.task,
    status: "pending",
    createdAt: Date.now(),
    completedAt: null,
    state: "idle",
    outcome: null,
    totalSteps: null,
    durationMs: null,
    liveViewUrl: null,
    sessionId: null,
    replayUrl: null,
  };
  const statements: D1PreparedStatement[] = [
    db
      .prepare("INSERT INTO runs (id, url, task, status, created_at, state) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(run.id, run.url, run.task, run.status, run.createdAt, run.state),
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

export async function getRun(db: D1Database, runId: string): Promise<RunRecord | null> {
  const row = await db.prepare("SELECT * FROM runs WHERE id = ?").bind(runId).first<RunRow>();
  return row ? toRun(row) : null;
}

export async function listRuns(db: D1Database, limit: number): Promise<RunRecord[]> {
  const { results } = await db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").bind(limit).all<RunRow>();
  return results.map(toRun);
}

/** Session URLs as the primary session comes up, and the orchestrator's end-of-pipeline status. */
export async function patchRun(db: D1Database, runId: string, patch: RunPatch): Promise<RunRecord | null> {
  const sets: string[] = [];
  const binds: Array<string | number | null> = [];
  const set = (column: string, value: string | number | null): void => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };
  if (patch.liveViewUrl !== undefined) set("live_view_url", patch.liveViewUrl);
  if (patch.sessionId !== undefined) set("session_id", patch.sessionId);
  if (patch.replayUrl !== undefined) set("replay_url", patch.replayUrl);
  if (patch.status === "verifying") sets.push("status = CASE WHEN status = 'completed' THEN status ELSE 'verifying' END");
  if (patch.status === "completed") {
    sets.push("status = 'completed'");
    set("completed_at", Date.now());
  }
  if (sets.length > 0) await db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, runId).run();
  return getRun(db, runId);
}

/* ------------------------------------------------------------------ events */

export async function countEvents(db: D1Database, runId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM events WHERE run_id = ?").bind(runId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** REPLAY: every event of a run, ordered by ts (row id breaks ties). */
export async function getEvents(db: D1Database, runId: string): Promise<RunEvent[]> {
  const { results } = await db.prepare("SELECT * FROM events WHERE run_id = ? ORDER BY ts ASC, id ASC").bind(runId).all<EventRow>();
  return results.map(toEvent).filter((e): e is RunEvent => e !== null);
}

/** LIVE: events stored after a row id, in insertion order. */
export async function getEventsAfter(db: D1Database, runId: string, afterRowId: number, limit = 500): Promise<StoredEvent[]> {
  const { results } = await db
    .prepare("SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT ?")
    .bind(runId, afterRowId, limit)
    .all<EventRow>();
  const stored: StoredEvent[] = [];
  for (const row of results) {
    const event = toEvent(row);
    if (event) stored.push({ rowId: row.id, event });
  }
  return stored;
}

export interface InsertResult {
  inserted: StoredEvent[];
  duplicates: number;
  /** True when a primary-lane event changed the run row (state, outcome, status). */
  runChanged: boolean;
}

const PRIMARY: Lane = "primary";

/**
 * Stores validated events and applies their side effects, primary lane only:
 *   friction      -> findings row (upsert: a repeat raises hit_count)
 *   status / done -> runs.state; done also sets outcome, total_steps,
 *                    duration_ms, and completes the run unless the
 *                    orchestrator has marked it as verifying
 *   first event   -> runs.status = running
 * Verify-lane events are stored and streamed, nothing more: they are compared
 * against the primary run, never reported as findings of their own.
 * (run, lane, seq) is unique, so re-posting an event is a harmless no-op.
 */
export async function insertEvents(db: D1Database, runId: string, events: readonly RunEvent[]): Promise<InsertResult> {
  if (events.length === 0) return { inserted: [], duplicates: 0, runChanged: false };

  const results = await db.batch(
    events.map((e) =>
      db
        .prepare("INSERT OR IGNORE INTO events (run_id, lane, seq, ts, type, payload, fix_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(runId, e.lane, e.seq, e.ts, e.type, JSON.stringify(e.payload), e.fixId ?? null),
    ),
  );

  const inserted: StoredEvent[] = [];
  results.forEach((result, index) => {
    const event = events[index];
    if (event && result.meta.changes > 0) inserted.push({ rowId: result.meta.last_row_id, event });
  });
  const duplicates = events.length - inserted.length;
  const primary = inserted.filter(({ event }) => event.lane === PRIMARY);
  if (primary.length === 0) return { inserted, duplicates, runChanged: false };

  const effects: D1PreparedStatement[] = [db.prepare("UPDATE runs SET status = 'running' WHERE id = ? AND status = 'pending'").bind(runId)];

  // Latest state-bearing event in this batch.
  let nextState: { seq: number; state: AgentState } | null = null;

  for (const { event } of primary) {
    if (event.type === "friction") {
      const p = event.payload;
      effects.push(
        db
          .prepare(
            `INSERT INTO findings (id, run_id, finding_key, category, severity, evidence_seq, recommendation, confidence, summary, why_it_matters, selector, hit_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (run_id, id) DO UPDATE SET hit_count = MAX(hit_count, excluded.hit_count)`,
          )
          .bind(
            p.findingId ?? `f${event.seq}`,
            runId,
            p.findingKey ?? `${p.category}:f${event.seq}`,
            p.category,
            p.severity,
            p.evidenceSeq,
            p.recommendation,
            p.confidence,
            p.summary ?? null,
            p.whyItMatters ?? null,
            p.selector ?? "",
            p.hitCount ?? 1,
          ),
      );
    }
    let state: AgentState | null = null;
    if (event.type === "status") state = event.payload.state;
    if (event.type === "done") {
      state = stateForOutcome(event.payload.outcome);
      effects.push(
        db
          .prepare(
            `UPDATE runs SET outcome = ?1, total_steps = ?2, duration_ms = ?3,
               status = CASE WHEN status = 'verifying' THEN status ELSE 'completed' END,
               completed_at = CASE WHEN status = 'verifying' THEN completed_at ELSE ?4 END
             WHERE id = ?5`,
          )
          .bind(event.payload.outcome, event.payload.totalSteps, Math.round(event.payload.durationMs), Date.now(), runId),
      );
    }
    if (state && (!nextState || event.seq >= nextState.seq)) nextState = { seq: event.seq, state };
  }

  if (nextState) {
    // A terminal state is final: a late or re-ordered status event never reopens the run's agent.
    effects.push(
      db
        .prepare("UPDATE runs SET state = CASE WHEN state IN ('succeeded', 'failed', 'timeout') THEN state ELSE ? END WHERE id = ?")
        .bind(nextState.state, runId),
    );
  }

  await db.batch(effects);
  return { inserted, duplicates, runChanged: true };
}

/* ------------------------------------------------------------------- fixes */

interface FixRow {
  id: string;
  run_id: string;
  finding_id: string;
  stage: string;
  summary: string;
  patch_js: string;
  source_file: string | null;
  new_file_content: string | null;
  source_sha: string | null;
  before_json: string | null;
  after_json: string | null;
  pr_url: string | null;
  created_at: number;
  category: string | null;
  note: string | null;
  verify_live_view_url: string | null;
  verify_replay_url: string | null;
  updated_at: number;
}

function parseResult(json: string | null): LaneResult | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as LaneResult;
  } catch {
    return null;
  }
}

function toFix(row: FixRow): FixRecord {
  return {
    id: row.id,
    runId: row.run_id,
    findingId: row.finding_id,
    stage: row.stage as FixStage,
    summary: row.summary,
    patchJs: row.patch_js,
    sourceFile: row.source_file,
    newFileContent: row.new_file_content,
    sourceSha: row.source_sha,
    before: parseResult(row.before_json),
    after: parseResult(row.after_json),
    prUrl: row.pr_url,
    ...(row.category ? { category: row.category as FrictionCategory } : {}),
    ...(row.note ? { note: row.note } : {}),
    liveViewUrl: row.verify_live_view_url,
    replayUrl: row.verify_replay_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The event form of a fix: everything but the file content, which is too big to stream. */
export function fixPayloadOf(fix: FixRecord): FixPayload {
  const { id: _id, runId: _runId, newFileContent: _content, sourceSha: _sha, createdAt: _created, updatedAt: _updated, ...payload } = fix;
  return payload;
}

export async function getFixes(db: D1Database, runId: string): Promise<FixRecord[]> {
  const { results } = await db.prepare("SELECT * FROM fixes WHERE run_id = ? ORDER BY created_at ASC").bind(runId).all<FixRow>();
  return results.map(toFix);
}

export async function getFix(db: D1Database, runId: string, findingId: string): Promise<FixRecord | null> {
  const row = await db.prepare("SELECT * FROM fixes WHERE run_id = ? AND finding_id = ?").bind(runId, findingId).first<FixRow>();
  return row ? toFix(row) : null;
}

/**
 * Upserts the fix row, then records it as a `fix` event in the verify lane.
 * The event's seq is allocated here, atomically (MAX + 1 inside the INSERT),
 * and returned: the orchestrator starts its verify run's counter after it, so
 * the two writers never collide. newFileContent is only replaced when the
 * upsert carries it; omitted, the stored content is kept.
 */
export async function upsertFix(db: D1Database, runId: string, upsert: FixUpsert): Promise<{ fix: FixRecord; event: FixEvent; rowId: number }> {
  const now = Date.now();
  const { newFileContent, sourceSha, ...payload } = upsert;
  const hasContent = newFileContent !== undefined ? 1 : 0;
  const [, inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO fixes (id, run_id, finding_id, stage, summary, patch_js, source_file, new_file_content, before_json, after_json, pr_url, created_at,
                            category, note, verify_live_view_url, verify_replay_url, updated_at, source_sha)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?12, ?18)
         ON CONFLICT (run_id, finding_id) DO UPDATE SET
           stage = excluded.stage, summary = excluded.summary, patch_js = excluded.patch_js, source_file = excluded.source_file,
           new_file_content = CASE WHEN ?17 = 1 THEN excluded.new_file_content ELSE fixes.new_file_content END,
           source_sha = CASE WHEN ?17 = 1 THEN excluded.source_sha ELSE fixes.source_sha END,
           before_json = excluded.before_json, after_json = excluded.after_json, pr_url = excluded.pr_url,
           category = excluded.category, note = excluded.note,
           verify_live_view_url = excluded.verify_live_view_url, verify_replay_url = excluded.verify_replay_url,
           updated_at = excluded.updated_at`,
      )
      .bind(
        `${runId}:${payload.findingId}`,
        runId,
        payload.findingId,
        payload.stage,
        payload.summary,
        payload.patchJs,
        payload.sourceFile,
        newFileContent ?? null,
        payload.before ? JSON.stringify(payload.before) : null,
        payload.after ? JSON.stringify(payload.after) : null,
        payload.prUrl,
        now,
        payload.category ?? null,
        payload.note ?? null,
        payload.liveViewUrl ?? null,
        payload.replayUrl ?? null,
        hasContent,
        sourceSha ?? null,
      ),
    db
      .prepare(
        `INSERT INTO events (run_id, lane, seq, ts, type, payload, fix_id)
         SELECT ?1, 'verify', COALESCE(MAX(seq), 0) + 1, ?2, 'fix', ?3, ?4 FROM events WHERE run_id = ?1 AND lane = 'verify'`,
      )
      .bind(runId, now, JSON.stringify(payload), payload.findingId),
  ]);
  const rowId = inserted?.meta.last_row_id ?? 0;
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(rowId).first<EventRow>();
  const event = row ? (toEvent(row) as FixEvent | null) : null;
  const fix = await getFix(db, runId, payload.findingId);
  if (!fix || !event) throw new Error(`fix ${payload.findingId} could not be stored`);
  return { fix, event, rowId };
}

/* ------------------------------------------------------------------ report */

interface FindingJoinRow {
  id: string;
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

export interface ReportRows {
  findings: FindingInput[];
  /** The joined evidence steps plus the primary done event. */
  events: RunEvent[];
}

/** Findings ranked by severity then confidence, each joined to its evidence step. */
export async function getReportRows(db: D1Database, runId: string): Promise<ReportRows> {
  const [joined, dones] = await db.batch<FindingJoinRow | EventRow>([
    db
      .prepare(
        `SELECT f.id, f.finding_key, f.category, f.severity, f.evidence_seq, f.recommendation,
                f.confidence, f.summary, f.why_it_matters, f.selector, f.hit_count,
                e.seq AS e_seq, e.ts AS e_ts, e.payload AS e_payload
         FROM findings f
         LEFT JOIN events e
           ON e.run_id = f.run_id AND e.lane = 'primary'
          AND e.seq = f.evidence_seq AND e.type = 'step'
         WHERE f.run_id = ?
         ORDER BY f.severity DESC, f.confidence DESC, f.hit_count DESC`,
      )
      .bind(runId),
    db.prepare("SELECT * FROM events WHERE run_id = ? AND lane = 'primary' AND type = 'done'").bind(runId),
  ]);

  const findings: FindingInput[] = [];
  const events: RunEvent[] = [];

  for (const row of (joined?.results ?? []) as FindingJoinRow[]) {
    findings.push({
      id: row.id,
      findingKey: row.finding_key,
      category: row.category as FrictionCategory,
      severity: row.severity as Severity,
      evidenceSeq: row.evidence_seq,
      recommendation: row.recommendation,
      confidence: row.confidence,
      summary: row.summary,
      whyItMatters: row.why_it_matters,
      selector: row.selector,
      hitCount: row.hit_count,
    });
    if (row.e_seq !== null && row.e_ts !== null && row.e_payload !== null) {
      const step = toEvent({ run_id: runId, lane: PRIMARY, seq: row.e_seq, ts: row.e_ts, type: "step", payload: row.e_payload });
      if (step) events.push(step);
    }
  }
  for (const row of (dones?.results ?? []) as EventRow[]) {
    const done = toEvent(row);
    if (done) events.push(done);
  }
  return { findings, events };
}
