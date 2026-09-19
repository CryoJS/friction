/**
 * The event contract. Every producer (orchestrator, fixture replayer) and every
 * consumer (Worker, control room, friction detectors) speaks exactly this.
 *
 * Envelope:  { runId, personaId, seq, ts, type, payload }
 *   seq  is monotonic per persona across ALL event types, so (personaId, seq)
 *        uniquely identifies an event within a run.
 *   ts   is epoch milliseconds.
 *
 * Fields marked "extension" are optional additions to the original spec. They
 * exist because the friction detectors need observations (focus, modals, error
 * text) that the base step payload cannot express. Consumers must tolerate
 * their absence.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ enums */

export const PERSONA_IDS = ["impatient", "cautious", "keyboard"] as const;
export const PersonaIdSchema = z.enum(PERSONA_IDS);
export type PersonaId = (typeof PERSONA_IDS)[number];

export const EVENT_TYPES = ["status", "step", "friction", "done"] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * "press" is an extension: the keyboard persona can only press keys, and the
 * keyboard_trap detector has to know a key press happened.
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

export const PERSONA_STATES = ["idle", "running", "succeeded", "failed", "timeout"] as const;
export const PersonaStateSchema = z.enum(PERSONA_STATES);
export type PersonaState = (typeof PERSONA_STATES)[number];

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
  /** Keys pressed, in order (keyboard persona, or Enter after typing). */
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
  /** One sentence, in the persona's voice. Shown prominently in the UI. */
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
});
export type StepPayload = z.infer<typeof StepPayloadSchema>;

export const FrictionPayloadSchema = z.object({
  category: FrictionCategorySchema,
  severity: SeveritySchema,
  /** seq of the step event (same persona) that evidences this finding. */
  evidenceSeq: z.number().int().nonnegative(),
  recommendation: z.string(),
  confidence: z.number().min(0).max(1),
  /** extension: deterministic one-line description of what the detector saw */
  summary: z.string().optional(),
  /** extension: the model's judgement of user impact */
  whyItMatters: z.string().optional(),
  /** extension: "model" when OpenAI wrote the judgement, "heuristic" on fallback */
  judgedBy: z.enum(["model", "heuristic"]).optional(),
});
export type FrictionPayload = z.infer<typeof FrictionPayloadSchema>;

export const StatusPayloadSchema = z.object({
  state: PersonaStateSchema,
  currentSeq: z.number().int().nonnegative(),
  /** extension: human-readable detail, e.g. why a persona failed */
  message: z.string().optional(),
});
export type StatusPayload = z.infer<typeof StatusPayloadSchema>;

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
  personaId: PersonaIdSchema,
  seq: z.number().int().nonnegative(),
  ts: z.number().int().positive(),
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

export type StatusEvent = z.infer<typeof StatusEventSchema>;
export type StepEvent = z.infer<typeof StepEventSchema>;
export type FrictionEvent = z.infer<typeof FrictionEventSchema>;
export type DoneEvent = z.infer<typeof DoneEventSchema>;

/** The discriminated union over `type`. */
export const RunEventSchema = z.discriminatedUnion("type", [
  StatusEventSchema,
  StepEventSchema,
  FrictionEventSchema,
  DoneEventSchema,
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

/** Unique identity of an event within a run. Use it to de-duplicate. */
export function eventKey(e: Pick<RunEvent, "personaId" | "seq">): string {
  return `${e.personaId}:${e.seq}`;
}

/** Stable replay order: by timestamp, then persona, then seq. */
export function compareEvents(a: RunEvent, b: RunEvent): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  if (a.personaId !== b.personaId) return a.personaId < b.personaId ? -1 : 1;
  return a.seq - b.seq;
}

/** Persona state implied by a done outcome. */
export function stateForOutcome(outcome: Outcome): PersonaState {
  if (outcome === "success") return "succeeded";
  if (outcome === "timeout") return "timeout";
  return "failed";
}

export function isTerminalState(state: PersonaState): boolean {
  return state === "succeeded" || state === "failed" || state === "timeout";
}

/** R2 key for a step's evidence screenshot. */
export function evidenceKey(
  runId: string,
  personaId: PersonaId,
  seq: number,
  ext: "jpg" | "png" | "svg" = "jpg",
): string {
  return `runs/${runId}/${personaId}/${String(seq).padStart(4, "0")}.${ext}`;
}
