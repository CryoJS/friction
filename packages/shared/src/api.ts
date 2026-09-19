/**
 * HTTP + SSE contracts between the Worker, the orchestrator and the control
 * room. JSON on the wire is camelCase; D1 columns are snake_case and are mapped
 * at the Worker boundary.
 */
import { z } from "zod";
import {
  PersonaIdSchema,
  PersonaStateSchema,
  RunEventSchema,
  type ActionType,
  type BBox,
  type FrictionCategory,
  type Outcome,
  type PersonaId,
  type PersonaState,
  type Severity,
  type Viewport,
} from "./events";

/* -------------------------------------------------------------------- runs */

export const RUN_STATUSES = ["pending", "running", "completed"] as const;
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

export const RunRecordSchema = z.object({
  id: z.string().min(1),
  url: z.string(),
  task: z.string(),
  status: RunStatusSchema,
  createdAt: z.number(),
  completedAt: z.number().nullable(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const PersonaRecordSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  personaId: PersonaIdSchema,
  state: PersonaStateSchema,
  stepCount: z.number().int().nonnegative(),
  liveViewUrl: z.string().nullable(),
  sessionId: z.string().nullable(),
  replayUrl: z.string().nullable(),
});
export type PersonaRecord = z.infer<typeof PersonaRecordSchema>;

/** PATCH /api/runs/:id/personas — one patch or an array of them. */
export const PersonaPatchSchema = z.object({
  personaId: PersonaIdSchema,
  liveViewUrl: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  replayUrl: z.string().nullable().optional(),
});
export type PersonaPatch = z.infer<typeof PersonaPatchSchema>;
export const PersonaPatchBodySchema = z.union([PersonaPatchSchema, z.array(PersonaPatchSchema)]);

/** "fixture" means the data came from fixtures/golden-run.json, not a real producer. */
export const DataSourceSchema = z.enum(["live", "fixture"]);
export type DataSource = z.infer<typeof DataSourceSchema>;

/**
 * GET /api/runs/:id — everything needed to replay a run with no live network.
 * fixtures/golden-run.json has exactly this shape.
 */
export const RunSnapshotSchema = z.object({
  run: RunRecordSchema,
  personas: z.array(PersonaRecordSchema),
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

/* --------------------------------------------------------------------- SSE */

/**
 * GET /api/runs/:id/stream — named SSE events.
 *   hello      StreamHello   first message on every (re)connection
 *   event      RunEvent      one envelope
 *   persona    PersonaRecord live view / replay URLs arrived or changed
 *   reconnect  {}            server is recycling the connection; reconnect now with ?after=<last id>
 *   end        StreamEnd     every persona is done; do not reconnect
 */
export const SSE = {
  hello: "hello",
  event: "event",
  persona: "persona",
  reconnect: "reconnect",
  end: "end",
} as const;

export interface StreamHello {
  runId: string;
  mode: DataSource;
  run: RunRecord | null;
  personas: PersonaRecord[];
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
  id: string;
  personaId: PersonaId;
  category: FrictionCategory;
  severity: Severity;
  confidence: number;
  recommendation: string;
  summary: string | null;
  whyItMatters: string | null;
  evidenceSeq: number;
  /** The joined evidence step; null only if the step event never arrived. */
  evidence: ReportEvidence | null;
  /** Browserbase session replay for the persona that hit this. */
  replayUrl: string | null;
}

export interface ReportPersonaSection {
  personaId: PersonaId;
  displayName: string;
  state: PersonaState;
  outcome: Outcome | null;
  stepCount: number;
  durationMs: number | null;
  sessionId: string | null;
  replayUrl: string | null;
  /** Sorted by severity desc, then confidence desc. */
  findings: ReportFinding[];
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
  /** All findings, ranked by severity desc, then confidence desc. */
  findings: ReportFinding[];
  /** The same findings grouped by persona, in PERSONAS order. */
  personas: ReportPersonaSection[];
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
