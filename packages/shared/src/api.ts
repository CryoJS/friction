/**
 * HTTP + SSE contracts between the Worker, the orchestrator and the control
 * room. JSON on the wire is camelCase; D1 columns are snake_case and are mapped
 * at the Worker boundary.
 */
import { z } from "zod";
import {
  AgentStateSchema,
  FixPayloadSchema,
  OutcomeSchema,
  RunEventSchema,
  type ActionType,
  type FixEvent,
  type AgentState,
  type BBox,
  type FrictionCategory,
  type Outcome,
  type Severity,
  type Viewport,
} from "./events";

/* -------------------------------------------------------------------- runs */

/**
 * pending    created, nothing produced yet
 * running    the primary lane is running
 * verifying  the primary lane is done; fixes are being verified
 * completed  nothing more will be produced for this run
 */
export const RUN_STATUSES = ["pending", "running", "verifying", "completed"] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Reserved run id that always resolves to fixtures/golden-run.json. */
export const GOLDEN_RUN_ID = "golden";

export const CreateRunRequestSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  task: z.string().trim().min(1).max(500),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export interface CreateRunResponse {
  runId: string;
}

/**
 * One row per run. The primary lane's session and outcome live here: there is
 * exactly one primary agent per run. Verify-lane sessions live on their fix.
 */
export const RunRecordSchema = z.object({
  id: z.string().min(1),
  url: z.string(),
  task: z.string(),
  status: RunStatusSchema,
  createdAt: z.number(),
  completedAt: z.number().nullable(),
  /** Primary lane state, driven by its status and done events. */
  state: AgentStateSchema,
  /** From the primary lane's done event; null until it arrives. */
  outcome: OutcomeSchema.nullable(),
  totalSteps: z.number().int().nonnegative().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  /** Primary lane Browserbase session. */
  liveViewUrl: z.string().nullable(),
  sessionId: z.string().nullable(),
  replayUrl: z.string().nullable(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

/** PATCH /api/runs/:id — the primary session coming up, or the run's lifecycle. */
export const RunPatchSchema = z.object({
  liveViewUrl: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  replayUrl: z.string().nullable().optional(),
  /** Only the orchestrator's end-of-pipeline transitions. */
  status: z.enum(["verifying", "completed"]).optional(),
});
export type RunPatch = z.infer<typeof RunPatchSchema>;

/** "fixture" means the data came from fixtures/golden-run.json, not a real producer. */
export const DataSourceSchema = z.enum(["live", "fixture"]);
export type DataSource = z.infer<typeof DataSourceSchema>;

/**
 * GET /api/runs/:id — everything needed to replay a run with no live network.
 * fixtures/golden-run.json has exactly this shape.
 */
export const RunSnapshotSchema = z.object({
  run: RunRecordSchema,
  events: z.array(RunEventSchema),
  source: DataSourceSchema,
});
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

export interface RunListResponse {
  runs: RunRecord[];
}

export interface PostEventsResponse {
  accepted: number;
  duplicates: number;
  rejected: Array<{ index: number; error: string }>;
}

/* ------------------------------------------------------------------- fixes */

/**
 * POST /api/runs/:id/fixes — upsert the fix for one finding (keyed by run +
 * findingId). The Worker stores the row, records a `fix` event in the verify
 * lane (it assigns the seq), and broadcasts it over SSE.
 */
export const FixUpsertSchema = FixPayloadSchema.extend({
  /**
   * The complete replacement content of sourceFile (never a diff). Held on the
   * row for the PR; too large to travel in events, so it never does.
   */
  newFileContent: z.string().nullable().optional(),
  /** Blob sha of sourceFile that newFileContent was generated from. Sent with it. */
  sourceSha: z.string().nullable().optional(),
});
export type FixUpsert = z.infer<typeof FixUpsertSchema>;

/** One row of the fixes table. */
export const FixRecordSchema = FixPayloadSchema.extend({
  id: z.string().min(1),
  runId: z.string().min(1),
  newFileContent: z.string().nullable(),
  sourceSha: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type FixRecord = z.infer<typeof FixRecordSchema>;

export interface PostFixResponse {
  fix: FixRecord;
  /** The fix event as stored, with the seq the Worker assigned. */
  event: FixEvent;
}

/** GET /api/runs/:id/fixes */
export interface FixListResponse {
  fixes: FixRecord[];
}

/** POST <orchestrator>/runs/:id/fixes/:findingId/pull-request — the user's click, never automatic. */
export interface OpenPullRequestResponse {
  prUrl: string;
}

/* --------------------------------------------------------------------- SSE */

/**
 * GET /api/runs/:id/stream — named SSE events.
 *   hello      StreamHello   first message on every (re)connection
 *   event      RunEvent      one envelope
 *   run        RunRecord     the run row changed (session URLs, status)
 *   reconnect  {}            server is recycling the connection; reconnect now with ?after=<last id>
 *   end        StreamEnd     the run is completed; do not reconnect
 */
export const SSE = {
  hello: "hello",
  event: "event",
  run: "run",
  reconnect: "reconnect",
  end: "end",
} as const;

export interface StreamHello {
  runId: string;
  mode: DataSource;
  run: RunRecord | null;
}

export interface StreamEnd {
  reason: "complete";
}

/* ------------------------------------------------------------------ report */

export interface ReportEvidence {
  seq: number;
  ts: number;
  url: string;
  actionType: ActionType;
  targetLabel: string;
  selector: string;
  rationale: string;
  screenshotKey: string;
  bbox: BBox | null;
  viewport: Viewport;
  durationMs: number;
  value: string | null;
}

export interface ReportFinding {
  /** Stable, URL- and branch-safe id: "f" + the seq of the finding's first friction event. */
  id: string;
  /** category + selector: the dedupe identity. */
  findingKey: string;
  category: FrictionCategory;
  severity: Severity;
  confidence: number;
  recommendation: string;
  summary: string | null;
  whyItMatters: string | null;
  /** Step that first evidenced it. */
  evidenceSeq: number;
  /** Times the agent hit it in this run: the repetition signal. */
  hitCount: number;
  /** Selector of the element involved ("" when there is none). */
  selector: string;
  /** The joined evidence step; null only if the step event never arrived. */
  evidence: ReportEvidence | null;
  /** Browserbase session replay of the primary run. */
  replayUrl: string | null;
}

export interface ReportLaneSummary {
  state: AgentState;
  outcome: Outcome | null;
  stepCount: number;
  durationMs: number | null;
  sessionId: string | null;
  replayUrl: string | null;
}

export interface ReportResponse {
  run: RunRecord;
  source: DataSource;
  generatedAt: number;
  totals: {
    findings: number;
    bySeverity: Record<Severity, number>;
    byCategory: Partial<Record<FrictionCategory, number>>;
  };
  /** Primary-lane findings, deduplicated, ranked by severity desc, then confidence desc. */
  findings: ReportFinding[];
  /** How the primary run went. */
  primary: ReportLaneSummary;
}

/* ------------------------------------------------------------ orchestrator */

export const SuggestTasksRequestSchema = z.object({
  url: z.string().trim().min(1).max(2000),
});
export type SuggestTasksRequest = z.infer<typeof SuggestTasksRequestSchema>;

export interface SuggestTasksResponse {
  tasks: string[];
  /** "model" = read from the live landing page; "fallback" = generic suggestions. */
  source: "model" | "fallback";
}

export interface OrchestratorHealth {
  ok: true;
  /** "mock" replays the golden run through the real pipeline; no API keys needed. */
  mode: "live" | "mock";
  missingEnv: string[];
}
