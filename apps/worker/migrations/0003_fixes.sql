-- Fix verification and pull requests.
--
-- One row per (run, finding): the proposed fix and its verification. patch_js
-- is what gets injected with addInitScript into Friction's own fresh browser
-- session; it never touches the user's site. new_file_content is the complete
-- replacement of source_file in the user's repository, held for the draft PR
-- the user may choose to open.
--
-- Beyond the spec's columns: source_sha (the blob new_file_content was generated
-- from, so a PR never overwrites a file that has since changed), the verify
-- session's links (the PR body needs its replay), a note explaining the
-- verdict, and updated_at.

CREATE TABLE IF NOT EXISTS fixes (
  id                    TEXT PRIMARY KEY,
  run_id                TEXT NOT NULL,
  finding_id            TEXT NOT NULL,
  stage                 TEXT NOT NULL,
  summary               TEXT NOT NULL,
  patch_js              TEXT NOT NULL,
  source_file           TEXT,
  new_file_content      TEXT,
  source_sha            TEXT,
  before_json           TEXT,
  after_json            TEXT,
  pr_url                TEXT,
  created_at            INTEGER NOT NULL,
  category              TEXT,
  note                  TEXT,
  verify_live_view_url  TEXT,
  verify_replay_url     TEXT,
  updated_at            INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fixes_finding ON fixes(run_id, finding_id);

-- Verify-lane events carry the fix they belong to (envelope fixId).
ALTER TABLE events ADD COLUMN fix_id TEXT;
