-- Personas -> lanes. One agent per run: lane 'primary' is the run itself,
-- lane 'verify' is a re-run with a proposed fix injected.
--
-- Not idempotent (ALTER TABLE). wrangler applies it once; the Worker's own
-- bootstrap (src/db.ts ensureSchema) only runs it when events has no lane
-- column, and records it in d1_migrations so wrangler will not run it again.
--
-- Old three-persona runs cannot keep all three timelines: (lane, seq) is
-- unique and every persona started at seq 1. Their "cautious" persona (the
-- closest to the new neutral first-time visitor) becomes the primary lane;
-- the other two personas' events are dropped.

ALTER TABLE runs ADD COLUMN state TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE runs ADD COLUMN outcome TEXT;
ALTER TABLE runs ADD COLUMN total_steps INTEGER;
ALTER TABLE runs ADD COLUMN duration_ms INTEGER;
ALTER TABLE runs ADD COLUMN live_view_url TEXT;
ALTER TABLE runs ADD COLUMN session_id TEXT;
ALTER TABLE runs ADD COLUMN replay_url TEXT;

UPDATE runs SET
  state         = COALESCE((SELECT p.state FROM personas p WHERE p.run_id = runs.id AND p.persona_id = 'cautious'), 'idle'),
  live_view_url = (SELECT p.live_view_url FROM personas p WHERE p.run_id = runs.id AND p.persona_id = 'cautious'),
  session_id    = (SELECT p.session_id FROM personas p WHERE p.run_id = runs.id AND p.persona_id = 'cautious'),
  replay_url    = (SELECT p.replay_url FROM personas p WHERE p.run_id = runs.id AND p.persona_id = 'cautious');

DROP TABLE personas;

CREATE TABLE events_lanes (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL,
  lane    TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  ts      INTEGER NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL
);

INSERT INTO events_lanes (run_id, lane, seq, ts, type, payload)
  SELECT run_id, 'primary', seq, ts, type, payload FROM events WHERE persona_id = 'cautious' ORDER BY id;

DROP TABLE events;
ALTER TABLE events_lanes RENAME TO events;

CREATE INDEX idx_events_run_ts ON events(run_id, ts);
-- (lane, seq) identifies an event within a run. Makes POST /events idempotent.
CREATE UNIQUE INDEX idx_events_identity ON events(run_id, lane, seq);

-- Primary-lane findings, deduplicated by category + selector. id is the
-- finding id ("f" + the seq of its first friction event); hit_count is how
-- many times the agent ran into it.
CREATE TABLE findings_lanes (
  id             TEXT NOT NULL,
  run_id         TEXT NOT NULL,
  finding_key    TEXT NOT NULL,
  category       TEXT NOT NULL,
  severity       INTEGER NOT NULL,
  evidence_seq   INTEGER NOT NULL,
  recommendation TEXT NOT NULL,
  confidence     REAL NOT NULL,
  summary        TEXT,
  why_it_matters TEXT,
  selector       TEXT NOT NULL DEFAULT '',
  hit_count      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (run_id, id)
);

INSERT INTO findings_lanes (id, run_id, finding_key, category, severity, evidence_seq, recommendation, confidence, summary, why_it_matters)
  SELECT 'legacy' || id, run_id, category || ':legacy' || id, category, severity, evidence_seq, recommendation, confidence, summary, why_it_matters
  FROM findings WHERE persona_id = 'cautious';

DROP TABLE findings;
ALTER TABLE findings_lanes RENAME TO findings;

CREATE INDEX idx_findings_run ON findings(run_id, severity, confidence);
