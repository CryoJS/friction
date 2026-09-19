-- Friction data plane.
-- Every statement is idempotent (IF NOT EXISTS) because the Worker also runs
-- this file itself when it finds an empty database (src/db.ts ensureSchema).

CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  task         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS personas (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  persona_id    TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'idle',
  step_count    INTEGER NOT NULL DEFAULT 0,
  live_view_url TEXT,
  session_id    TEXT,
  replay_url    TEXT
);

CREATE INDEX IF NOT EXISTS idx_personas_run ON personas(run_id);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_run_ts ON events(run_id, ts);

-- (persona, seq) identifies an event within a run. Makes POST /events idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_identity ON events(run_id, persona_id, seq);

CREATE TABLE IF NOT EXISTS findings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL,
  persona_id     TEXT NOT NULL,
  category       TEXT NOT NULL,
  severity       INTEGER NOT NULL,
  evidence_seq   INTEGER NOT NULL,
  recommendation TEXT NOT NULL,
  confidence     REAL NOT NULL,
  summary        TEXT,
  why_it_matters TEXT
);

CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id, severity, confidence);

CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_identity ON findings(run_id, persona_id, category, evidence_seq);
