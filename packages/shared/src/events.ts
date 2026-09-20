/**
 * The event contract. Every producer (orchestrator, fixture replayer) and every
 * consumer (Worker, control room, friction detectors) speaks exactly this.
 *
 * Envelope:  { runId, lane, seq, ts, type, payload }
 *   lane "primary" is the original run; "verify" is a re-run of the same task
 *        with a proposed fix injected. Both carry exactly the same schema, so
 *        one component can render either.
 *   seq  is monotonic per lane across ALL event types, so (lane, seq) uniquely
 *        identifies an event within a run.
 *   ts   is epoch milliseconds.
 *   fixId  (extension) on lane "verify": the finding whose fix this event
 *        belongs to. One run may verify several fixes, one after another, in
 *        the verify lane; fixId tells their events apart.
 *
 * type "fix" tracks a proposed fix through its stages (proposed -> verifying
 * -> verified | rejected -> pr_opened). Fix events live in the verify lane and
 * are written by the Worker (POST /api/runs/:id/fixes), which assigns their
 * seq, so they never collide with a verify run's own events.
 *
 * Fields marked "extension" are optional additions to the original spec. They
 * exist because the friction detectors need observations (focus, modals, error
 * text) that the base step payload cannot express. Consumers must tolerate
 * their absence.
 */
import { z } from "zod";
import { AnchorSchema } from "./anchor";

/* ------------------------------------------------------------------ enums */

export const LANES = ["primary", "verify"] as const;
export const LaneSchema = z.enum(LANES);
export type Lane = (typeof LANES)[number];

export const EVENT_TYPES = ["status", "step", "friction", "done", "fix"] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * "press" is an extension: the agent may choose to use the keyboard, and the
 * keyboard_trap detector only fires when it did.
 */
export const ACTION_TYPES = [
  "click",
  "type",
  "scroll",
  "select",
  "navigate",
  "wait",
  "press",
] as const;
export const ActionTypeSchema = z.enum(ACTION_TYPES);
export type ActionType = (typeof ACTION_TYPES)[number];

export const AGENT_STATES = ["idle", "running", "succeeded", "failed", "timeout"] as const;
export const AgentStateSchema = z.enum(AGENT_STATES);
export type AgentState = (typeof AGENT_STATES)[number];

export const OUTCOMES = ["success", "failure", "timeout"] as const;
export const OutcomeSchema = z.enum(OUTCOMES);
export type Outcome = (typeof OUTCOMES)[number];

export const FRICTION_CATEGORIES = [
  "dead_click",
  "loop",
  "retry",
  "step_budget",
  "error_text",
  "modal_interrupt",
  "long_wait",
  "keyboard_trap",
  "ambiguous_label",
] as const;
export const FrictionCategorySchema = z.enum(FRICTION_CATEGORIES);
export type FrictionCategory = (typeof FRICTION_CATEGORIES)[number];

export const SeveritySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type Severity = z.infer<typeof SeveritySchema>;

/* --------------------------------------------------------------- payloads */

/** CSS pixels, relative to the top-left of the viewport at screenshot time. */
export const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
});
export type BBox = z.infer<typeof BBoxSchema>;

export const ViewportSchema = z.object({
  w: z.number().positive(),
  h: z.number().positive(),
});
export type Viewport = z.infer<typeof ViewportSchema>;

/** Used to scale a bbox onto a screenshot when a step carries no viewport. */
export const DEFAULT_VIEWPORT: Viewport = { w: 1280, h: 720 };

/**
 * Extension. Deterministic observations captured around an action. These are
 * the raw inputs of the friction detectors; none of them is a judgement.
 */
export const StepSignalsSchema = z.object({
  /** Page URL after the action settled (payload.url is the URL it was performed on). */
  urlAfter: z.string().optional(),
  /** The action could not be executed at all (target not found, driver threw). */
  actionFailed: z.boolean().optional(),
  actionError: z.string().optional(),
  /** Error / validation strings visible in the a11y tree after the action. */
  errorTexts: z.array(z.string()).optional(),
  /** A dialog or overlay that was not there before the action is now covering the page. */
  modalAppeared: z.boolean().optional(),
  modalLabel: z.string().optional(),
  /** Keys pressed, in order (a press action, or Enter after typing). */
  keysPressed: z.array(z.string()).optional(),
  /** Whether document.activeElement changed as a result of the key presses. */
  focusMoved: z.boolean().optional(),
  /** Accessible name of the focused element after the action. */
  focusLabel: z.string().optional(),
  /** How many visible interactive elements share the target's accessible name. */
  sameLabelCount: z.number().int().nonnegative().optional(),
});
export type StepSignals = z.infer<typeof StepSignalsSchema>;

export const StepPayloadSchema = z.object({
  /** URL the action was performed on. For "navigate" it is the destination. */
  url: z.string().min(1),
  actionType: ActionTypeSchema,
  /** Accessible name of the target element ("" when the action has no target). */
  targetLabel: z.string(),
  selector: z.string(),
  /** One sentence, in the agent's voice. Shown prominently in the UI. */
  rationale: z.string(),
  /** R2 key of the evidence screenshot ("" if the capture failed). */
  screenshotKey: z.string(),
  bbox: BBoxSchema.nullable(),
  /** Time for the action to execute and the page to settle. Excludes model latency. */
  durationMs: z.number().nonnegative(),
  domChanged: z.boolean(),
  /** extension: text typed / option selected / keys pressed / scroll direction */
  value: z.string().optional(),
  /** extension: viewport the bbox is relative to */
  viewport: ViewportSchema.optional(),
  /** extension: detector inputs */
  signals: StepSignalsSchema.optional(),
  /** extension: how to find this element again later (the annotation overlay) */
  anchor: AnchorSchema.optional(),
  /** extension: R2 key of the HTML snapshot of this page, for the embedded viewer ("" / absent when not captured) */
  snapshotKey: z.string().optional(),
});
export type StepPayload = z.infer<typeof StepPayloadSchema>;

export const FrictionPayloadSchema = z.object({
  category: FrictionCategorySchema,
  severity: SeveritySchema,
  /** seq of the step event (same lane) that evidences this finding: its FIRST occurrence. */
  evidenceSeq: z.number().int().nonnegative(),
  recommendation: z.string(),
  confidence: z.number().min(0).max(1),
  /** extension: deterministic one-line description of what the detector saw */
  summary: z.string().optional(),
  /** extension: the model's judgement of user impact */
  whyItMatters: z.string().optional(),
  /** extension: "model" when OpenAI wrote the judgement, "heuristic" on fallback */
  judgedBy: z.enum(["model", "heuristic"]).optional(),
  /**
   * extension: stable id of the deduplicated finding ("f" + the seq of its first
   * friction event). Repeat hits re-emit the finding under the same id.
   */
  findingId: z.string().optional(),
  /** extension: category + selector, the dedupe identity within a lane */
  findingKey: z.string().optional(),
  /** extension: selector of the element involved ("" when there is none) */
  selector: z.string().optional(),
  /** extension: how many times the agent hit this finding so far (1 on first sight) */
  hitCount: z.number().int().positive().optional(),
  /** extension: seq of the most recent step that hit it */
  lastSeq: z.number().int().nonnegative().optional(),
  /** extension: the evidence step's anchor, copied here so the overlay needs one payload */
  anchor: AnchorSchema.optional(),
});
export type FrictionPayload = z.infer<typeof FrictionPayloadSchema>;

export const StatusPayloadSchema = z.object({
  state: AgentStateSchema,
  currentSeq: z.number().int().nonnegative(),
  /** extension: human-readable detail, e.g. why the agent failed */
  message: z.string().optional(),
  /**
   * extension: the lane's browser session, on the "running" status. How a
   * verify lane's live view reaches the UI without touching the fix mid-run.
   */
  session: z.object({ liveViewUrl: z.string().nullable(), replayUrl: z.string().nullable() }).optional(),
});
export type StatusPayload = z.infer<typeof StatusPayloadSchema>;

/* -------------------------------------------------------------------- fixes */

export const FIX_STAGES = ["proposed", "verifying", "verified", "rejected", "pr_opened"] as const;
export const FixStageSchema = z.enum(FIX_STAGES);
export type FixStage = (typeof FIX_STAGES)[number];

/** How one lane's run of the task went: the numbers compared before and after a fix. */
export const LaneResultSchema = z.object({
  outcome: OutcomeSchema,
  steps: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type LaneResult = z.infer<typeof LaneResultSchema>;

/**
 * A fix for one finding. patchJs is injected with page.addInitScript() into a
 * FRESH browser session that Friction owns: it changes that session's DOM
 * only, never the user's site, server or repository. sourceFile and the PR
 * are the separate, repository-side path.
 */
export const FixPayloadSchema = z.object({
  findingId: z.string().min(1),
  stage: FixStageSchema,
  /** One sentence: what the fix does. */
  summary: z.string(),
  /** Self-contained JS installed via addInitScript before first navigation. */
  patchJs: z.string(),
  /** Repository path of the mapped source file; null until one is found and a fix generated for it. */
  sourceFile: z.string().nullable(),
  /** The primary run. */
  before: LaneResultSchema.nullable(),
  /** The verify run, with the fix installed. */
  after: LaneResultSchema.nullable(),
  prUrl: z.string().nullable(),
  /** extension: the finding's category, so the verdict can be explained without a join */
  category: FrictionCategorySchema.optional(),
  /** extension: one line on why the verdict went the way it did, or what failed */
  note: z.string().optional(),
  /** extension: the verify session's Browserbase live view and replay */
  liveViewUrl: z.string().nullable().optional(),
  replayUrl: z.string().nullable().optional(),
  /** extension: symptom findings of the same run that no longer fired in this fix's verify run; credited to it, never fixed separately */
  alsoResolved: z.array(z.object({ findingId: z.string().min(1), category: FrictionCategorySchema })).max(20).optional(),
  /** extension: how the source file was found, or what was searched for when none was */
  mappingNote: z.string().max(500).optional(),
  /** extension: verifications this fix has had; 2 = retried once with the rejection as feedback */
  attempts: z.number().int().positive().optional(),
  /**
   * extension: the Playwright spec a pull request for this fix adds (prTest.ts). Only ever set once Friction has seen its
   * steps fail against the site as it is and pass with this fix's patch installed.
   */
  testSpec: z.string().max(20_000).optional(),
  /** extension: what became of the regression test: proven, or why there is none */
  testNote: z.string().max(500).optional(),
});
export type FixPayload = z.infer<typeof FixPayloadSchema>;

export const DonePayloadSchema = z.object({
  outcome: OutcomeSchema,
  totalSteps: z.number().int().nonnegative(),
  frictionCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  /** extension: one-line wrap-up for the UI */
  summary: z.string().optional(),
});
export type DonePayload = z.infer<typeof DonePayloadSchema>;

/* --------------------------------------------------------------- envelope */

const envelope = {
  runId: z.string().min(1),
  lane: LaneSchema,
  seq: z.number().int().nonnegative(),
  ts: z.number().int().positive(),
  /** extension: on lane "verify", the finding whose fix is being verified */
  fixId: z.string().min(1).optional(),
};

export const StatusEventSchema = z.object({
  ...envelope,
  type: z.literal("status"),
  payload: StatusPayloadSchema,
});
export const StepEventSchema = z.object({
  ...envelope,
  type: z.literal("step"),
  payload: StepPayloadSchema,
});
export const FrictionEventSchema = z.object({
  ...envelope,
  type: z.literal("friction"),
  payload: FrictionPayloadSchema,
});
export const DoneEventSchema = z.object({
  ...envelope,
  type: z.literal("done"),
  payload: DonePayloadSchema,
});
export const FixEventSchema = z.object({
  ...envelope,
  type: z.literal("fix"),
  payload: FixPayloadSchema,
});

export type StatusEvent = z.infer<typeof StatusEventSchema>;
export type StepEvent = z.infer<typeof StepEventSchema>;
export type FrictionEvent = z.infer<typeof FrictionEventSchema>;
export type DoneEvent = z.infer<typeof DoneEventSchema>;
export type FixEvent = z.infer<typeof FixEventSchema>;

/** The discriminated union over `type`. */
export const RunEventSchema = z.discriminatedUnion("type", [
  StatusEventSchema,
  StepEventSchema,
  FrictionEventSchema,
  DoneEventSchema,
  FixEventSchema,
]);
export type RunEvent = z.infer<typeof RunEventSchema>;

/* ---------------------------------------------------------------- parsers */

/** Parse one event. Throws a ZodError on invalid input. */
export function parseEvent(input: unknown): RunEvent {
  return RunEventSchema.parse(input);
}

export type SafeParsedEvent =
  | { success: true; data: RunEvent }
  | { success: false; error: string };

/** Parse one event without throwing. */
export function safeParseEvent(input: unknown): SafeParsedEvent {
  const result = RunEventSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: formatIssues(result.error.issues) };
}

export interface ParsedEventBatch {
  events: RunEvent[];
  rejected: Array<{ index: number; error: string }>;
}

/**
 * Parse a single event or an array of events. Each element is validated on its
 * own so one malformed event never discards the rest of a batch.
 */
export function parseEventBatch(input: unknown): ParsedEventBatch {
  const items = Array.isArray(input) ? input : [input];
  const events: RunEvent[] = [];
  const rejected: ParsedEventBatch["rejected"] = [];
  items.forEach((item, index) => {
    const parsed = safeParseEvent(item);
    if (parsed.success) events.push(parsed.data);
    else rejected.push({ index, error: parsed.error });
  });
  return { events, rejected };
}

export function formatIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string {
  return issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/* ---------------------------------------------------------------- helpers */

export const isStatusEvent = (e: RunEvent): e is StatusEvent => e.type === "status";
export const isStepEvent = (e: RunEvent): e is StepEvent => e.type === "step";
export const isFrictionEvent = (e: RunEvent): e is FrictionEvent => e.type === "friction";
export const isDoneEvent = (e: RunEvent): e is DoneEvent => e.type === "done";
export const isFixEvent = (e: RunEvent): e is FixEvent => e.type === "fix";

/** Terminal verdicts: the verify run is over. */
export function isVerdictStage(stage: FixStage): boolean {
  return stage === "verified" || stage === "rejected" || stage === "pr_opened";
}

/** Unique identity of an event within a run. Use it to de-duplicate. */
export function eventKey(e: Pick<RunEvent, "lane" | "seq">): string {
  return `${e.lane}:${e.seq}`;
}

/** Stable replay order: by timestamp, then lane, then seq. */
export function compareEvents(a: RunEvent, b: RunEvent): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  if (a.lane !== b.lane) return a.lane < b.lane ? -1 : 1;
  return a.seq - b.seq;
}

/** Agent state implied by a done outcome. */
export function stateForOutcome(outcome: Outcome): AgentState {
  if (outcome === "success") return "succeeded";
  if (outcome === "timeout") return "timeout";
  return "failed";
}

export function isTerminalState(state: AgentState): boolean {
  return state === "succeeded" || state === "failed" || state === "timeout";
}

/** R2 key for a step's evidence screenshot. */
export function evidenceKey(
  runId: string,
  lane: Lane,
  seq: number,
  ext: "jpg" | "png" | "svg" | "html" = "jpg",
): string {
  return `runs/${runId}/${lane}/${String(seq).padStart(4, "0")}.${ext}`;
}
