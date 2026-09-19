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
