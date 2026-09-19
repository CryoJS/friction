/**
 * D1 access. SQL lives here and nowhere else. Rows are snake_case, everything
 * that leaves this module is the camelCase contract from @friction/shared.
 */
import {
  PERSONA_IDS,
  stateForOutcome,
  type FindingInput,
  type PersonaId,
  type PersonaPatch,
  type PersonaRecord,
  type PersonaState,
  type RunEvent,
  type RunRecord,
  type RunStatus,
  type Severity,
  type FrictionCategory,
} from "@friction/shared";
import schemaSql from "../migrations/0001_init.sql";

/* ------------------------------------------------------------------ schema */

let schemaChecked = false;

/**
 * Creates the schema if this database has never been migrated. `wrangler d1
 * migrations apply` remains the documented path; this is the safety net for
 * the teammate (or the demo laptop) that skipped it. A plain flag rather than a
 * shared promise: promises must not be awaited across Worker requests.
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaChecked) return;
  const existing = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'findings'")
    .first<{ name: string }>();
  if (!existing) {
    const statements = schemaSql
      // \r?\n, not \n: with core.autocrlf the file is checked out as CRLF, and
      // `.` stops at \r, so a trailing \r would keep the comment alive.
      .split(/\r?\n/)
      .map((line) => line.replace(/--.*$/, ""))
      .join(" ")
      .split(";")
      .map((statement) => statement.replace(/\s+/g, " ").trim())
      .filter((statement) => statement.length > 0);
    await db.batch(statements.map((statement) => db.prepare(statement)));
    console.log(`[db] bootstrapped schema (${statements.length} statements)`);
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
}

interface PersonaRow {
  id: string;
  run_id: string;
  persona_id: string;
  state: string;
  step_count: number;
  live_view_url: string | null;
  session_id: string | null;
  replay_url: string | null;
}

interface EventRow {
  id: number;
  run_id: string;
  persona_id: string;
  seq: number;
  ts: number;
  type: string;
  payload: string;
}

function toRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    url: row.url,
    task: row.task,
    status: row.status as RunStatus,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function toPersona(row: PersonaRow): PersonaRecord {
  return {
    id: row.id,
    runId: row.run_id,
    personaId: row.persona_id as PersonaId,
    state: row.state as PersonaState,
    stepCount: row.step_count,
    liveViewUrl: row.live_view_url,
    sessionId: row.session_id,
    replayUrl: row.replay_url,
  };
}

/** Rows were validated on the way in, so reading them back is a plain cast. */
function toEvent(row: Pick<EventRow, "run_id" | "persona_id" | "seq" | "ts" | "type" | "payload">): RunEvent | null {
  try {
    return {
      runId: row.run_id,
      personaId: row.persona_id,
      seq: row.seq,
      ts: row.ts,
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

function newRunId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let id = "r_";
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return id;
}

export async function createRun(db: D1Database, input: { url: string; task: string }): Promise<RunRecord> {
  const run: RunRecord = {
    id: newRunId(),
    url: input.url,
    task: input.task,
    status: "pending",
    createdAt: Date.now(),
    completedAt: null,
  };
  await db.batch([
    db
      .prepare("INSERT INTO runs (id, url, task, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(run.id, run.url, run.task, run.status, run.createdAt),
    ...PERSONA_IDS.map((personaId) =>
      db
        .prepare("INSERT INTO personas (id, run_id, persona_id, state, step_count) VALUES (?, ?, ?, 'idle', 0)")
        .bind(`${run.id}:${personaId}`, run.id, personaId),
    ),
  ]);
  return run;
}

export async function getRun(db: D1Database, runId: string): Promise<RunRecord | null> {
  const row = await db.prepare("SELECT * FROM runs WHERE id = ?").bind(runId).first<RunRow>();
  return row ? toRun(row) : null;
}

export async function listRuns(db: D1Database, limit: number): Promise<RunRecord[]> {
  const { results } = await db
    .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
    .bind(limit)
    .all<RunRow>();
  return results.map(toRun);
}

/* ---------------------------------------------------------------- personas */

export async function getPersonas(db: D1Database, runId: string): Promise<PersonaRecord[]> {
  const { results } = await db.prepare("SELECT * FROM personas WHERE run_id = ?").bind(runId).all<PersonaRow>();
  const order = new Map<string, number>(PERSONA_IDS.map((id, index) => [id, index]));
  return results
    .map(toPersona)
    .sort((a, b) => (order.get(a.personaId) ?? 99) - (order.get(b.personaId) ?? 99));
}

export async function patchPersonas(
  db: D1Database,
  runId: string,
  patches: readonly PersonaPatch[],
): Promise<PersonaRecord[]> {
  const statements: D1PreparedStatement[] = [];
  for (const patch of patches) {
    const id = `${runId}:${patch.personaId}`;
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO personas (id, run_id, persona_id, state, step_count) VALUES (?, ?, ?, 'idle', 0)")
        .bind(id, runId, patch.personaId),
    );
    const sets: string[] = [];
    const binds: Array<string | null> = [];
    if (patch.liveViewUrl !== undefined) {
      sets.push("live_view_url = ?");
      binds.push(patch.liveViewUrl);
    }
    if (patch.sessionId !== undefined) {
      sets.push("session_id = ?");
      binds.push(patch.sessionId);
    }
    if (patch.replayUrl !== undefined) {
      sets.push("replay_url = ?");
      binds.push(patch.replayUrl);
    }
    if (sets.length > 0) {
      statements.push(db.prepare(`UPDATE personas SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id));
    }
  }
  if (statements.length > 0) await db.batch(statements);
  const touched = new Set(patches.map((p) => p.personaId));
  return (await getPersonas(db, runId)).filter((p) => touched.has(p.personaId));
}

/* ------------------------------------------------------------------ events */

export async function countEvents(db: D1Database, runId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM events WHERE run_id = ?").bind(runId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** REPLAY: every event of a run, ordered by ts (row id breaks ties). */
export async function getEvents(db: D1Database, runId: string): Promise<RunEvent[]> {
  const { results } = await db
    .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY ts ASC, id ASC")
    .bind(runId)
    .all<EventRow>();
  return results.map(toEvent).filter((e): e is RunEvent => e !== null);
}

/** LIVE: events stored after a row id, in insertion order. */
export async function getEventsAfter(
  db: D1Database,
  runId: string,
  afterRowId: number,
  limit = 500,
): Promise<StoredEvent[]> {
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
}

/**
 * Stores validated events and applies their side effects:
 *   friction      -> findings row
 *   step          -> personas.step_count
 *   status / done -> personas.state
 *   first event   -> runs.status = running; every persona done -> completed
 * (run, persona, seq) is unique, so re-posting an event is a harmless no-op.
 */
export async function insertEvents(db: D1Database, runId: string, events: readonly RunEvent[]): Promise<InsertResult> {
  if (events.length === 0) return { inserted: [], duplicates: 0 };

  const results = await db.batch(
    events.map((e) =>
      db
        .prepare("INSERT OR IGNORE INTO events (run_id, persona_id, seq, ts, type, payload) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(runId, e.personaId, e.seq, e.ts, e.type, JSON.stringify(e.payload)),
    ),
  );

  const inserted: StoredEvent[] = [];
  results.forEach((result, index) => {
    const event = events[index];
    if (event && result.meta.changes > 0) inserted.push({ rowId: result.meta.last_row_id, event });
  });
  const duplicates = events.length - inserted.length;
  if (inserted.length === 0) return { inserted, duplicates };

  const effects: D1PreparedStatement[] = [
    db.prepare("UPDATE runs SET status = 'running' WHERE id = ? AND status = 'pending'").bind(runId),
  ];

  // Latest state-bearing event per persona in this batch.
  const nextState = new Map<PersonaId, { seq: number; state: PersonaState }>();
  const touched = new Set<PersonaId>();
  let sawDone = false;

  for (const { event } of inserted) {
    touched.add(event.personaId);
    if (event.type === "friction") {
      const p = event.payload;
      effects.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO findings (run_id, persona_id, category, severity, evidence_seq, recommendation, confidence, summary, why_it_matters) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            runId,
            event.personaId,
            p.category,
            p.severity,
            p.evidenceSeq,
            p.recommendation,
            p.confidence,
            p.summary ?? null,
            p.whyItMatters ?? null,
          ),
      );
    }
    let state: PersonaState | null = null;
    if (event.type === "status") state = event.payload.state;
    if (event.type === "done") {
      state = stateForOutcome(event.payload.outcome);
      sawDone = true;
    }
    if (state) {
      const current = nextState.get(event.personaId);
      if (!current || event.seq >= current.seq) nextState.set(event.personaId, { seq: event.seq, state });
    }
  }

  for (const personaId of touched) {
    const id = `${runId}:${personaId}`;
    const state = nextState.get(personaId)?.state ?? null;
    // A terminal state is final: a late or re-ordered status event never reopens a persona.
    effects.push(
      db
        .prepare(
          `UPDATE personas SET
             step_count = (SELECT COUNT(*) FROM events WHERE run_id = ?1 AND persona_id = ?2 AND type = 'step'),
             state = CASE
               WHEN ?3 IS NULL THEN state
               WHEN state IN ('succeeded', 'failed', 'timeout') THEN state
               ELSE ?3
             END
           WHERE id = ?4`,
        )
        .bind(runId, personaId, state, id),
    );
  }

  if (sawDone) {
    effects.push(
      db
        .prepare(
          `UPDATE runs SET status = 'completed', completed_at = ?1
           WHERE id = ?2 AND status != 'completed'
             AND (SELECT COUNT(DISTINCT persona_id) FROM events WHERE run_id = ?2 AND type = 'done') >= ?3`,
        )
        .bind(Date.now(), runId, PERSONA_IDS.length),
    );
  }

  await db.batch(effects);
  return { inserted, duplicates };
}

/* ------------------------------------------------------------------ report */

interface FindingJoinRow {
  id: number;
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

export interface ReportRows {
  findings: FindingInput[];
  /** The joined evidence steps plus every done event. */
  events: RunEvent[];
}

/** Findings ranked by severity then confidence, each joined to its evidence step. */
export async function getReportRows(db: D1Database, runId: string): Promise<ReportRows> {
  const [joined, dones] = await db.batch<FindingJoinRow | EventRow>([
    db
      .prepare(
        `SELECT f.id, f.persona_id, f.category, f.severity, f.evidence_seq, f.recommendation,
                f.confidence, f.summary, f.why_it_matters,
                e.seq AS e_seq, e.ts AS e_ts, e.payload AS e_payload
         FROM findings f
         LEFT JOIN events e
           ON e.run_id = f.run_id AND e.persona_id = f.persona_id
          AND e.seq = f.evidence_seq AND e.type = 'step'
         WHERE f.run_id = ?
         ORDER BY f.severity DESC, f.confidence DESC, f.id ASC`,
      )
      .bind(runId),
    db.prepare("SELECT * FROM events WHERE run_id = ? AND type = 'done'").bind(runId),
  ]);

  const findings: FindingInput[] = [];
  const events: RunEvent[] = [];

  for (const row of (joined?.results ?? []) as FindingJoinRow[]) {
    findings.push({
      id: String(row.id),
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
      const step = toEvent({
        run_id: runId,
        persona_id: row.persona_id,
        seq: row.e_seq,
        ts: row.e_ts,
        type: "step",
        payload: row.e_payload,
      });
      if (step) events.push(step);
    }
  }
  for (const row of (dones?.results ?? []) as EventRow[]) {
    const done = toEvent(row);
    if (done) events.push(done);
  }
  return { findings, events };
}
