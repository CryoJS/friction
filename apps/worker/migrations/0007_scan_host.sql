-- The annotations endpoint answers "is there a scan for this hostname?", and
-- SQLite cannot parse a URL, so the normalized host is stored alongside it.
-- Existing rows are backfilled in JS by ensureSchema (src/db.ts): the value
-- comes from normalizeHost(), which has no SQL equivalent.

ALTER TABLE scans ADD COLUMN host TEXT;

CREATE INDEX IF NOT EXISTS idx_scans_host ON scans(host, created_at);
