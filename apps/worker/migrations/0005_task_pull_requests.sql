-- Scan pull requests: one draft PR per task.
--
-- One row per (scan, run): what happened to that task's pull request. The
-- whole TaskPullRequest travels as JSON (not_fixed, finding_ids, preview), so
-- an upsert replaces it; the columns beside it are the ones SQL reads.
-- scans.repo is the "owner/name" the scan was started with, scans.auto_pr
-- whether it opens its pull requests by itself; both NULL on older scans.
--
-- The Worker runs this file itself when task_pull_requests is missing
-- (src/db.ts ensureSchema), which is what makes the ALTERs safe to meet twice.

CREATE TABLE IF NOT EXISTS task_pull_requests (
  scan_id     TEXT NOT NULL,
  run_id      TEXT NOT NULL,
  task_index  INTEGER NOT NULL,
  status      TEXT NOT NULL,
  pr_url      TEXT,
  body_json   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (scan_id, run_id)
);

ALTER TABLE scans ADD COLUMN repo TEXT;
ALTER TABLE scans ADD COLUMN auto_pr INTEGER;
